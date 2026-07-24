import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postAuth } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { RecoverForm } from "@/features/auth/recover-form";
import { RegisterForm } from "@/features/auth/register-form";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";
import { authFailure } from "@/server/auth/response";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)} type="button">打开恢复码</button>
      <RecoveryCodeDialog open={open} recoveryCode="01234-56789-ABCDE-FGHJK-MNPQRS" onClose={() => setOpen(false)} />
    </>
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("registration UI", () => {
  it("requires a name, avatar, and matching password", async () => {
    render(<RegisterForm onRegistered={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "注册并进入" }));
    expect(await screen.findByText("名称需要填写 1-20 个字符")).toBeVisible();
    expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(5);
  });

  it("labels recovery code as one-time information", () => {
    render(
      <RecoveryCodeDialog
        open
        recoveryCode="01234-56789-ABCDE-FGHJK-MNPQRS"
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("恢复码只显示这一次")).toBeVisible();
    expect(screen.getByRole("button", { name: "复制恢复码" })).toBeEnabled();
  });

  it("moves focus into the dialog, traps Tab, closes on Escape, and restores prior focus", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DialogHarness />
      </>,
    );
    const priorFocus = screen.getByRole("button", { name: "打开恢复码" });
    await user.click(priorFocus);
    const primaryAction = screen.getByRole("button", { name: "我已保存" });
    expect(primaryAction).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "关闭恢复码" })).toHaveFocus();
    await user.tab({ shift: true });
    expect(primaryAction).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(priorFocus).toHaveFocus();
  });

  it("restores prior focus when an open recovery-code dialog unmounts", () => {
    const priorFocus = document.createElement("button");
    priorFocus.textContent = "此前焦点";
    document.body.append(priorFocus);
    priorFocus.focus();
    const view = render(<RecoveryCodeDialog open={false} recoveryCode="01234-56789-ABCDE-FGHJK-MNPQRS" onClose={vi.fn()} />);
    view.rerender(
      <RecoveryCodeDialog open recoveryCode="01234-56789-ABCDE-FGHJK-MNPQRS" onClose={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "我已保存" })).toHaveFocus();
    view.unmount();
    expect(priorFocus).toHaveFocus();
    priorFocus.remove();
  });

  it("uses server field details for accessible field errors while retaining values", async () => {
    const user = userEvent.setup();
    const duplicateNameResponse = authFailure({ code: "23505" }, "request-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(duplicateNameResponse));
    render(<RegisterForm onRegistered={vi.fn()} />);
    const name = screen.getByPlaceholderText("输入一个好记的名称");
    await user.type(name, "学习者");
    await user.click(screen.getByRole("radio", { name: "头像 1" }));
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "注册并进入" }));

    const error = await screen.findByText("这个名称已经被使用");
    expect(name).toHaveValue("学习者");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAttribute("aria-describedby", error.id);
  });
});

describe("authentication network failures", () => {
  it("turns a rejected auth request into a friendly failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(postAuth("/api/auth/login", {})).resolves.toEqual({
      ok: false,
      error: { message: "网络连接失败，请检查网络后重试" },
    });
  });

  it("unlocks the login form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<LoginForm onLoggedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("名称"), "学习者");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  it("unlocks the registration form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<RegisterForm onRegistered={vi.fn()} />);

    await user.type(screen.getByPlaceholderText("输入一个好记的名称"), "学习者");
    await user.click(screen.getByRole("radio", { name: "头像 1" }));
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "注册并进入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "注册并进入" })).toBeEnabled();
  });

  it("unlocks the recovery form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<RecoverForm onRecovered={vi.fn()} />);

    await user.type(screen.getByLabelText("名称"), "学习者");
    await user.type(screen.getByLabelText("恢复码"), "01234-56789-ABCDE-FGHJK-MNPQRS");
    await user.type(screen.getByLabelText("新密码"), "new-password123");
    await user.type(screen.getByLabelText("确认新密码"), "new-password123");
    await user.click(screen.getByRole("button", { name: "重设密码" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "重设密码" })).toBeEnabled();
  });
});
