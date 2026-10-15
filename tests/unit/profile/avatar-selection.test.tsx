import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OnboardingForm } from "@/features/auth/onboarding-form";
import { AppHeader } from "@/features/profile/app-header";
import { TestQueryProvider } from "@/tests/helpers/test-query-provider";

const options = [
  { key: 1, name: "白日梦家", description: "让想象先走一步" },
  { key: 2, name: "学者", description: "把好奇读成理解" },
  { key: 3, name: "技术发烧友", description: "想明白，也要跑起来" },
  { key: 4, name: "摸鱼家", description: "休息也是一种蓄力" },
  { key: 5, name: "行动派", description: "把学到的，变成做到的" },
];

function installApi(avatarKey = 1) {
  let profile = { id: "avatar-test", email: "test@example.invalid", displayName: "学习者", avatarKey, onboardingCompleted: true };
  const writes: Array<{ path: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (init?.method === "PATCH" || init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      writes.push({ path, method: init.method, body });
      profile = { ...profile, ...body };
    }
    const data = path.startsWith("/api/checkins/stats")
      ? { totalCount: 0, currentStreak: 0, hasTodayRecord: false }
      : { profile };
    return Response.json({ ok: true, requestId: "avatar-test", data });
  }));
  return { profile, writes };
}

async function openProfile(avatarKey: number) {
  const api = installApi(avatarKey);
  render(<TestQueryProvider><AppHeader initialProfile={api.profile} isCelebrating={false} isMuted={false}
    onRequestLogout={vi.fn()} onSelectToday={vi.fn()} onToggleMuted={vi.fn()} today="2026-09-10" /></TestQueryProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
  await user.click(screen.getByRole("menuitem", { name: "编辑资料" }));
  return { ...api, user };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Aura persona selection preserves the five numeric avatar keys", () => {
  it("locks persona choices while an onboarding save is pending", async () => {
    let complete!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { complete = resolve; })));
    const onCompleted = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingForm onCompleted={onCompleted} />);
    await user.type(screen.getByLabelText("名称"), "学习者");
    await user.click(screen.getByRole("radio", { name: "学者" }));
    await user.click(screen.getByRole("button", { name: "进入学习空间" }));
    for (const choice of screen.getAllByRole("radio")) expect(choice).toBeDisabled();
    complete(Response.json({ ok: true, data: {}, requestId: "pending-test" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
  });

  it.each(options)("onboarding sends key $key when choosing $name", async ({ key, name, description }) => {
    const { writes } = installApi();
    const onCompleted = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingForm onCompleted={onCompleted} />);
    const field = screen.getByRole("group", { name: "选择头像" });
    expect(within(field).getAllByRole("radio")).toHaveLength(5);
    const choice = within(field).getByRole("radio", { name });
    expect(choice).toHaveAccessibleDescription(description);
    await user.type(screen.getByLabelText("名称"), "学习者");
    await user.click(choice);
    expect(choice).toBeChecked();
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "进入学习空间" }));
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce());
    expect(writes).toEqual([{ path: "/api/onboarding", method: "POST", body: { displayName: "学习者", avatarKey: key } }]);
  });

  it.each(options)("preserves an existing key $key as $name without rewriting a profile", async ({ key, name }) => {
    const { writes, user } = await openProfile(key);
    expect(screen.getByRole("radio", { name })).toBeChecked();
    await user.click(screen.getByRole("button", { name: "保存资料" }));
    expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument();
    expect(writes).toEqual([]);
  });

  it("keeps the account portrait synchronized without a duplicate large header persona", async () => {
    const { writes, user } = await openProfile(2);
    const account = screen.getByRole("button", { name: "打开账户菜单" });
    expect(screen.queryByRole("button", { name: /更换学习形象，当前为/ })).not.toBeInTheDocument();
    expect(account).toHaveTextContent("学习者");
    const portrait = within(account).getByAltText("");
    const priorSource = portrait.getAttribute("src");
    await user.click(screen.getByRole("radio", { name: "行动派" }));
    expect(portrait).toHaveAttribute("src", priorSource);
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "保存资料" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "编辑资料" })).not.toBeInTheDocument());
    expect(writes).toEqual([{ path: "/api/me", method: "PATCH", body: { displayName: "学习者", avatarKey: 5 } }]);
    expect(portrait).toHaveAttribute("src", "/avatars/aura-doer.png");
  });

  it("cancelling a persona choice leaves the existing avatar unchanged", async () => {
    const { writes, user } = await openProfile(5);
    await user.click(screen.getByRole("radio", { name: "学者" }));
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(writes).toEqual([]);
    await user.click(screen.getByRole("button", { name: "打开账户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "编辑资料" }));
    expect(screen.getByRole("radio", { name: "行动派" })).toBeChecked();
  });
});
