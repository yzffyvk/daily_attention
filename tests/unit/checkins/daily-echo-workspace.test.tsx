import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckInWorkspace } from "@/features/checkins/checkin-workspace";
import { getTodayKey } from "@/features/checkins/dates";
import type { CheckInRecord } from "@/features/checkins/types";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

const today = getTodayKey();
function record(date = today, entryMode: "manual" | "ai" = "manual"): CheckInRecord {
  return { id: `${date}-${entryMode}`, date, entryMode, attention: "理解注意力机制", sourceUrl: "", summary: "", inspiration: "", imagePath: null, imageName: "", imageUrl: null, version: 1, createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z` };
}

function setup({ existing = [] as CheckInRecord[], date = today, failSave = false, accountId = "echo-user" } = {}) {
  const records = new Map(existing.map(item => [`${item.date}:${item.entryMode}`, item]));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const ok = (data: unknown) => new Response(JSON.stringify({ ok: true, data, requestId: "echo-test" }));
    if (url.pathname === "/api/me") return ok({ profile: null });
    if (url.pathname === "/api/checkins/stats") return ok({ totalCount: new Set([...records.values()].map(r => r.date)).size, currentStreak: 0, hasTodayRecord: [...records.values()].some(r => r.date === today) });
    if (url.pathname === "/api/checkins") return ok([...records.values()].map(r => ({ ...r, hasImage: false })));
    const key = `${url.pathname.split("/").at(-1)}:${url.searchParams.get("mode") ?? "manual"}`;
    if (init?.method === "PUT") {
      if (failSave) return new Response(JSON.stringify({ ok: false, error: { code: "UNAVAILABLE", message: "请稍后重试" }, requestId: "failed-save" }), { status: 503 });
      const body = JSON.parse(String(init.body));
      const saved = { ...record(date, body.entryMode), ...body, version: (body.version ?? 0) + 1 };
      records.set(`${date}:${body.entryMode}`, saved);
      return ok(saved);
    }
    return ok(records.get(key) ?? null);
  }));
  render(<TestQueryProvider><CheckInWorkspace initialDate={date} initialToday={today} initialProfile={{ id: accountId, email: "echo@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true }} /></TestQueryProvider>);
  return userEvent.setup();
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  const input = await screen.findByLabelText("今日知识主题");
  await waitFor(() => expect(input).toBeEnabled());
  await user.clear(input);
  await user.type(input, "今天弄懂了一点点");
  await user.click(screen.getByRole("button", { name: /保存记录，完成打卡|保存修改/ }));
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("daily echo keepsake", () => {
  it("opens only after the first successful daily save, closes, and can be reopened", async () => {
    const user = setup();
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
    await save(user);
    const dialog = await screen.findByRole("dialog", { name: "今日回响" });
    expect(within(dialog).getByRole("button", { name: "保存图片" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "收下这份鼓励" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看打卡纪念卡" }));
    expect(screen.getByRole("dialog", { name: "今日回响" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not celebrate a failed save or offer an unsaved card", async () => {
    const user = setup({ failSave: true });
    await save(user);
    await screen.findByText("请稍后重试");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看打卡纪念卡" })).not.toBeInTheDocument();
  });

  it("opens on the first successful save even when today's record already exists", async () => {
    const user = setup({ existing: [record()] });
    await save(user);
    expect(await screen.findByRole("dialog", { name: "今日回响" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "查看打卡纪念卡" })).toBeInTheDocument();
  });

  it("does not mistake an existing record in the other mode for a previously shown card", async () => {
    const user = setup({ existing: [record(today, "ai")] });
    await save(user);
    expect(await screen.findByRole("dialog", { name: "今日回响" })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
  });

  it("offers historical keepsakes without automatically interrupting a backfill", async () => {
    const user = setup({ date: "2026-01-01" });
    await save(user);
    await waitFor(() => expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled());
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看打卡纪念卡" }));
    expect(screen.getByRole("dialog", { name: "今日回响" })).toHaveTextContent("2026.01.01");
  });

  it("remembers the shown card across page remounts without suppressing another account", async () => {
    let user = setup({ existing: [record()], accountId: "first-user" });
    await save(user);
    await screen.findByRole("dialog", { name: "今日回响" });
    cleanup();
    user = setup({ existing: [record()], accountId: "first-user" });
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
    cleanup();
    user = setup({ existing: [record()], accountId: "second-user" });
    await save(user);
    expect(await screen.findByRole("dialog", { name: "今日回响" })).toBeInTheDocument();
  });

  it("keeps the card available after a failed save", async () => {
    let user = setup({ existing: [record()], failSave: true });
    await save(user);
    await screen.findByText("请稍后重试");
    cleanup();
    user = setup({ existing: [record()] });
    await save(user);
    await screen.findByRole("dialog", { name: "今日回响" });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "查看打卡纪念卡" }));
    await screen.findByRole("dialog", { name: "今日回响" });
    await user.keyboard("{Escape}");
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
  });

  it("counts a manually viewed card before the first save", async () => {
    const user = setup({ existing: [record()] });
    const reopen = await screen.findByRole("button", { name: "查看打卡纪念卡" });
    await waitFor(() => expect(reopen).toBeEnabled());
    await user.click(reopen);
    await screen.findByRole("dialog", { name: "今日回响" });
    await user.keyboard("{Escape}");
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
  });

  it("still shows only once per workspace when browser storage is unavailable", async () => {
    vi.stubGlobal("localStorage", { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } });
    const user = setup({ existing: [record()] });
    await save(user);
    await screen.findByRole("dialog", { name: "今日回响" });
    await user.keyboard("{Escape}");
    await save(user);
    await screen.findByText("修改已保存到云端");
    expect(screen.queryByRole("dialog", { name: "今日回响" })).not.toBeInTheDocument();
  });
});
