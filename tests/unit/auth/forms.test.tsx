import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("renders an accessible phone field, five avatars, and a return-login link", () => {
    render(<RegisterForm onRegistered={vi.fn()} />);
    const phone = screen.getByLabelText("手机号");

    expect(phone).toHaveAttribute("inputmode", "numeric");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("maxlength", "11");
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio", { name: /头像/ })).toHaveLength(5);
    expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login");
  });

  it("submits a digit-only phone registration payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: {
        profile: { id: "profile-1", displayName: "Attention_001", avatarKey: 1 },
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RegisterForm onRegistered={vi.fn()} />);

    await user.type(screen.getByLabelText("手机号"), "138 0013 8000");
    await user.click(screen.getByRole("radio", { name: "头像 1" }));
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "注册并进入" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        body: JSON.stringify({ phone: "13800138000", password: "password123", avatarKey: 1 }),
      }),
    );
  });

  it("uses a phone field error ID and preserves the entered phone", async () => {
    const user = userEvent.setup();
    const phoneTakenResponse = authFailure({ code: "phone_exists" }, "request-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(phoneTakenResponse));
    render(<RegisterForm onRegistered={vi.fn()} />);
    const phone = screen.getByLabelText("手机号");
    await user.type(phone, "13800138000");
    await user.click(screen.getByRole("radio", { name: "头像 1" }));
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "注册并进入" }));

    const error = await screen.findByText("该手机号已注册");
    expect(phone).toHaveValue("13800138000");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(error.id).toBe("register-phone-error");
    expect(phone).toHaveAttribute("aria-describedby", error.id);
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

    const phone = screen.getByLabelText("手机号");
    await user.type(phone, "13800138000");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(phone).toHaveAttribute("inputmode", "numeric");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveValue("13800138000");
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  it("unlocks the registration form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<RegisterForm onRegistered={vi.fn()} />);

    await user.type(screen.getByLabelText("手机号"), "13800138000");
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

    const phone = screen.getByLabelText("手机号");
    await user.type(phone, "13800138000");
    await user.type(screen.getByLabelText("恢复码"), "01234-56789-ABCDE-FGHJK-MNPQRS");
    await user.type(screen.getByLabelText("新密码"), "new-password123");
    await user.type(screen.getByLabelText("确认新密码"), "new-password123");
    await user.click(screen.getByRole("button", { name: "重设密码" }));

    expect(phone).toHaveAttribute("inputmode", "numeric");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveValue("13800138000");
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "重设密码" })).toBeEnabled();
  });
});

describe("recovery UI", () => {
  it("preserves the recovery response profile display name", async () => {
    const onRecovered = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: {
        profile: { id: "profile-1", displayName: "Attention_001", avatarKey: 1 },
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      },
    })));
    const user = userEvent.setup();
    render(<RecoverForm onRecovered={onRecovered} />);

    await user.type(screen.getByLabelText("手机号"), "13800138000");
    await user.type(screen.getByLabelText("恢复码"), "01234-56789-ABCDE-FGHJK-MNPQRS");
    await user.type(screen.getByLabelText("新密码"), "new-password123");
    await user.type(screen.getByLabelText("确认新密码"), "new-password123");
    await user.click(screen.getByRole("button", { name: "重设密码" }));

    await waitFor(() => {
      expect(onRecovered).toHaveBeenCalledWith({
        displayName: "Attention_001",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      });
    });
  });
});
