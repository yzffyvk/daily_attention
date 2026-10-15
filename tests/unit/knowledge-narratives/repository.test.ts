import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { createNarrativeRepository } from "@/server/knowledge-narratives/repository";
import { narrativeDates, narrativeResultFixture, narrativeSourcesFixture } from "../../helpers/narrative-fixtures";

function setup(dates: string[] | null = narrativeDates) {
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query);query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: dates ? { dates } : null, error: null });
  const rpc = vi.fn().mockResolvedValue({ error: { message: "NARRATIVE_EDIT_CONFLICT" }, data: null });
  const client = { from: vi.fn().mockReturnValue(query), rpc };
  return {query,rpc,repository:createNarrativeRepository(client as unknown as SupabaseClient<Database>)};
}
describe("narrative edit persistence boundary",()=>{
  it("rejects ambiguous date-only creation before calling a database function", async () => {
    const { repository, rpc } = setup();
    await expect(repository.create("owner", { dates: narrativeDates, question: "", idempotencyKey: "00000000-0000-4000-8000-000000000001", entryMode: "ai" })).rejects.toThrow("CLIENT_UPGRADE_REQUIRED");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("compares source record IDs when the same date contains another mode", async () => {
    const sources = narrativeSourcesFixture().map((source, index) => ({
      ...source, id: `00000000-0000-4000-8000-00000000000${index + 1}`, entryMode: "manual",
    }));
    const row = { id: "narrative", title: "脉络", dates: narrativeDates, question: "", status: "succeeded",
      source_snapshot: sources, result: narrativeResultFixture(), error_code: null,
      created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" };
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), maybeSingle: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: row, error: null });
    query.in.mockResolvedValue({ data: [
      ...sources.map(source => ({ id: source.id, checkin_date: source.date, entry_mode: "manual", version: 1 })),
      { id: "other-mode", checkin_date: narrativeDates[0], entry_mode: "ai", version: 9 },
    ], error: null });
    const client = { from: vi.fn().mockReturnValue(query) };
    const repository = createNarrativeRepository(client as unknown as SupabaseClient<Database>);
    expect((await repository.get("owner", "narrative")).changedDates).toEqual([]);
    expect(query.in).toHaveBeenCalledWith("id", sources.map(source => source.id));
  });

  it("matches legacy date-only sources to manual instead of same-day AI versions", async () => {
    const row = { id: "narrative", title: "脉络", dates: narrativeDates, question: "", status: "succeeded",
      source_snapshot: narrativeSourcesFixture(), result: narrativeResultFixture(), error_code: null,
      created_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z" };
    const query = { select: vi.fn(), eq: vi.fn(), in: vi.fn(), maybeSingle: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
    query.maybeSingle.mockResolvedValue({ data: row, error: null });
    query.in.mockResolvedValue({ data: [
      ...narrativeDates.map(date => ({ id: date, checkin_date: date, entry_mode: "manual", version: 1 })),
      { id: "other-mode", checkin_date: narrativeDates[0], entry_mode: "ai", version: 9 },
    ], error: null });
    const repository = createNarrativeRepository({ from: vi.fn().mockReturnValue(query) } as unknown as SupabaseClient<Database>);
    expect((await repository.get("owner", "narrative")).changedDates).toEqual([]);
  });
  it("validates citations against the owned record, never dates supplied in result",async()=>{
    const {repository,rpc,query}=setup();const result=narrativeResultFixture();
    result.nodes[1].date="2026-09-03";
    await expect(repository.update("owner","id",{result,expectedUpdatedAt:"2026-09-10T00:00:00Z"})).rejects.toThrow("NARRATIVE_EDIT_INVALID");
    expect(query.eq).toHaveBeenCalledWith("user_id","owner");expect(query.eq).toHaveBeenCalledWith("id","id");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("rejects a foreign or deleted source before any update",async()=>{
    const {repository,rpc}=setup(null);
    await expect(repository.update("owner","id",{result:narrativeResultFixture(),expectedUpdatedAt:"2026-09-10T00:00:00Z"})).rejects.toThrow("NARRATIVE_NOT_FOUND");
    expect(rpc).not.toHaveBeenCalled();
  });
  it("passes the original revision to the atomic update and preserves conflicts",async()=>{
    const {repository,rpc}=setup();const result=narrativeResultFixture();const revision="2026-09-10T00:00:00.123456+00:00";
    await expect(repository.update("owner","id",{result,expectedUpdatedAt:revision})).rejects.toEqual({message:"NARRATIVE_EDIT_CONFLICT"});
    expect(rpc).toHaveBeenCalledWith("update_knowledge_narrative",{target_user_id:"owner",target_id:"id",target_result:result,target_expected_updated_at:revision});
  });
});
