import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { checkInInputSchema } from "@/lib/domain/checkin";
import type { Database } from "@/lib/supabase/database.types";
import { createCheckInRepository } from "@/server/checkins/repository";

function setup() {
  const rows = ["manual", "ai"].map((mode) => ({
    id: `${mode}-id`, user_id: "owner", checkin_date: "2026-09-16", entry_mode: mode,
    attention: `${mode} title`, source_url: null, summary: `${mode} summary`, inspiration: "",
    image_path: null, image_name: "", version: 1,
    created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z",
  }));
  const requests: { url: URL; method: string; body: Record<string, unknown> | null }[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    const selected = rows.filter((row) =>
      [...url.searchParams].every(([key, filter]) => {
        if (!filter.startsWith("eq.")) return true;
        return String(row[key as keyof typeof row]) === filter.slice(3);
      }));
    if (method === "PATCH") selected.forEach((row) => Object.assign(row, body));
    if (method === "POST") {
      const created = { ...rows[0], ...body, id: "created-id" };
      rows.push(created);
      return Response.json(created);
    }
    return Response.json(selected);
  };
  const client = createClient<Database>("https://database.test", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: crypto.randomUUID() },
    global: { fetch: fetchImpl },
  });
  return { repository: createCheckInRepository(client), rows, requests };
}

describe("check-in persistence mode isolation", () => {
  it("returns late-month calendar entries beyond the server row cap without loading full summaries", async () => {
    const rows = Array.from({ length: 1002 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      user_id: "owner", checkin_date: index === 1001 ? "2026-09-30" : "2026-09-16",
      entry_mode: "manual", attention: `Record ${index + 1}`, image_path: null,
      version: 1, learning_status: "completed", album_id: null,
      created_at: "2026-09-16T00:00:00Z", updated_at: "2026-09-16T00:00:00Z",
    }));
    const requests: URL[] = [];
    const client = createClient<Database>("https://database.test", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: crypto.randomUUID() },
      global: { fetch: async (input) => {
        const url = new URL(String(input));
        requests.push(url);
        // Emulate PostgREST's bounded pages, independently of the caller's chosen page size.
        const offset = Number(url.searchParams.get("offset") ?? 0);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 1000);
        return Response.json(rows.slice(offset, offset + limit));
      } },
    });
    const summaries = await createCheckInRepository(client).findByMonth("owner", "2026-09");
    expect(summaries).toHaveLength(1002);
    expect(new Set(summaries.map(record => record.id)).size).toBe(1002);
    expect(summaries.at(-1)).toMatchObject({ id: rows[1001].id, date: "2026-09-30", attention: "Record 1002" });
    expect(requests.length).toBeGreaterThan(1);
    for (const request of requests) {
      expect(request.searchParams.get("select")).not.toBe("*");
      expect(request.searchParams.get("select")).not.toMatch(/summary|ai_candidate/u);
      expect(request.searchParams.get("order")).toBe("checkin_date.asc,id.asc");
      expect(request.searchParams.get("user_id")).toBe("eq.owner");
    }
  });

  it("preserves omitted AI metadata while allowing each field to be explicitly cleared", async () => {
    const { repository } = setup();
    const aiGenerationContext = { userPrompt: "原有要求", promptVersion: "knowledge-skeleton-user-prompt-v1" };
    const legacyInput = checkInInputSchema.parse({ entryMode: "ai", attention: "AI", sourceUrl: "", summary: "已有小结", inspiration: "新反思", imagePath: null, imageName: "", version: null });
    await repository.insert("owner", "2026-09-17", { ...legacyInput, userPrompt: "当前要求", aiGenerationContext });
    expect(await repository.updateAtVersion("owner", "2026-09-17", 1, { ...legacyInput, version: 1 }))
      .toMatchObject({ userPrompt: "当前要求", aiGenerationContext, inspiration: "新反思", version: 2 });
    expect(await repository.updateAtVersion("owner", "2026-09-17", 2, { ...legacyInput, version: 2, userPrompt: "" }))
      .toMatchObject({ userPrompt: "", aiGenerationContext, version: 3 });
    expect(await repository.updateAtVersion("owner", "2026-09-17", 3, { ...legacyInput, version: 3, userPrompt: "替换要求" }))
      .toMatchObject({ userPrompt: "替换要求", aiGenerationContext, version: 4 });
    expect(await repository.updateAtVersion("owner", "2026-09-17", 4, { ...legacyInput, version: 4, aiGenerationContext: null }))
      .toMatchObject({ userPrompt: "替换要求", aiGenerationContext: null, version: 5 });
  });

  it("round-trips AI prompts separately from the prompt used for existing generated content", async () => {
    const { repository } = setup();
    const generationContext = { userPrompt: "原有要求", promptVersion: "knowledge-skeleton-user-prompt-v1" };
    const input = { entryMode: "ai" as const, attention: "AI", sourceUrl: "", summary: "", inspiration: "", imagePath: null, imageName: "", version: null,
      userPrompt: "新的要求", aiGenerationContext: generationContext };
    expect(await repository.insert("owner", "2026-09-17", input)).toMatchObject({ userPrompt: "新的要求", aiGenerationContext: generationContext });
    const updated = await repository.updateAtVersion("owner", "2026-09-17", 1, { ...input, version: 1, userPrompt: "第三个要求" });
    expect(updated).toMatchObject({ userPrompt: "第三个要求", aiGenerationContext: generationContext, version: 2 });
  });

  it("clears AI prompt metadata on manual writes and defaults legacy rows", async () => {
    const { repository } = setup();
    expect(await repository.findByDate("owner", "2026-09-16", "ai"))
      .toMatchObject({ userPrompt: "", aiGenerationContext: null });
    const input = { entryMode: "manual" as const, attention: "手写", sourceUrl: "", summary: "", inspiration: "", imagePath: null, imageName: "", version: 1,
      userPrompt: "忽略", aiGenerationContext: { userPrompt: "忽略", promptVersion: "ai-summary-v1" } };
    expect(await repository.updateAtVersion("owner", "2026-09-16", 1, input))
      .toMatchObject({ userPrompt: "", aiGenerationContext: null });
  });
  it("reads the requested mode and defaults legacy reads to manual", async () => {
    const { repository } = setup();
    expect(await repository.findByDate("owner", "2026-09-16", "ai")).toMatchObject({ id: "ai-id", entryMode: "ai" });
    expect(await repository.findByDate("owner", "2026-09-16")).toMatchObject({ id: "manual-id", entryMode: "manual" });
  });

  it("updates only the matching mode at the expected version", async () => {
    const { repository, rows } = setup();
    const input = checkInInputSchema.parse({ entryMode: "ai", attention: "new AI", sourceUrl: "", summary: "new AI summary", inspiration: "", imagePath: null, imageName: "", version: 1 });
    expect(await repository.updateAtVersion("owner", "2026-09-16", 1, input)).toMatchObject({ id: "ai-id", entryMode: "ai", version: 2 });
    expect(rows[0]).toMatchObject({ id: "manual-id", attention: "manual title", summary: "manual summary", version: 1 });
  });

  it("persists an explicit mode and lists both modes in the monthly result", async () => {
    const { repository, requests } = setup();
    expect(await repository.findByMonth("owner", "2026-09")).toEqual([
      expect.objectContaining({ date: "2026-09-16", entryMode: "manual" }),
      expect.objectContaining({ date: "2026-09-16", entryMode: "ai" }),
    ]);
    const input = checkInInputSchema.parse({ entryMode: "ai", attention: "AI", sourceUrl: "", summary: "", inspiration: "", imagePath: null, imageName: "", version: null });
    expect(await repository.insert("owner", "2026-09-17", input)).toMatchObject({ entryMode: "ai" });
    expect(requests.find((request) => request.method === "POST")?.body).toMatchObject({ user_id: "owner", checkin_date: "2026-09-17", entry_mode: "ai" });
    expect(requests[0].url.searchParams.get("select")).toContain("entry_mode");
  });
});
