import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postAuth } from "@/features/auth/auth-card";
import { LoginForm } from "@/features/auth/login-form";
import { OnboardingForm } from "@/features/auth/onboarding-form";
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
  it("renders credential fields and a return-login link without avatar selection", () => {
    render(<RegisterForm onRegistered={vi.fn()} />);
    const email = screen.getByLabelText("邮箱");

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(screen.queryByLabelText("名称")).not.toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回登录" })).toHaveAttribute("href", "/login");
  });

  it("submits the raw email registration payload", async () => {
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

    await user.type(screen.getByLabelText("邮箱"), "Student@Example.COM");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/register",
      expect.objectContaining({
        body: JSON.stringify({ email: "Student@Example.COM", password: "password123" }),
      }),
    );
  });

  it("uses an email field error ID and preserves the entered email", async () => {
    const user = userEvent.setup();
    const emailTakenResponse = authFailure({ code: "email_exists" }, "request-id");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(emailTakenResponse));
    render(<RegisterForm onRegistered={vi.fn()} />);
    const email = screen.getByLabelText("邮箱");
    await user.type(email, "student@example.com");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    const error = await screen.findByText("该邮箱已注册");
    expect(email).toHaveValue("student@example.com");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(error.id).toBe("register-email-error");
    expect(email).toHaveAttribute("aria-describedby", error.id);
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
  it("submits the raw email login payload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, data: {} }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<LoginForm onLoggedIn={vi.fn()} />);

    await user.type(screen.getByLabelText("邮箱"), "Student@Example.COM");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        body: JSON.stringify({ email: "Student@Example.COM", password: "password123" }),
      }),
    );
  });

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

    const email = screen.getByLabelText("邮箱");
    await user.type(email, "student@example.com");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.click(screen.getByRole("button", { name: "登录" }));

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveValue("student@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  it("unlocks the registration form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<RegisterForm onRegistered={vi.fn()} />);

    await user.type(screen.getByLabelText("邮箱"), "student@example.com");
    await user.type(screen.getByLabelText("密码"), "password123");
    await user.type(screen.getByLabelText("确认密码"), "password123");
    await user.click(screen.getByRole("button", { name: "创建账号" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "创建账号" })).toBeEnabled();
  });

  it("unlocks the recovery form and shows a friendly error after a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const user = userEvent.setup();
    render(<RecoverForm onRecovered={vi.fn()} />);

    const email = screen.getByLabelText("邮箱");
    await user.type(email, "student@example.com");
    await user.type(screen.getByLabelText("恢复码"), "01234-56789-ABCDE-FGHJK-MNPQRS");
    await user.type(screen.getByLabelText("新密码"), "new-password123");
    await user.type(screen.getByLabelText("确认新密码"), "new-password123");
    await user.click(screen.getByRole("button", { name: "重设密码" }));

    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "username");
    expect(email).toHaveValue("student@example.com");
    expect(await screen.findByRole("alert")).toHaveTextContent("网络连接失败，请检查网络后重试");
    expect(screen.getByRole("button", { name: "重设密码" })).toBeEnabled();
  });
});

describe("first-login onboarding UI", () => {
  it("requires a name and explicit avatar before entering the learning space", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);

    expect(screen.getByLabelText("名称")).toHaveValue("");
    expect(screen.getAllByRole("radio")).toHaveLength(5);
    expect(screen.getAllByRole("radio").every((radio) => !radio.hasAttribute("checked"))).toBe(true);

    await user.click(screen.getByRole("button", { name: "进入学习空间" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请填写名称");
  });

  it("submits only the selected name and avatar", async () => {
    const assign = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ok: true,
      requestId: "request-id",
      data: {
        profile: {
          id: "profile-1",
          email: "student@example.com",
          displayName: "学习者",
          avatarKey: 4,
          onboardingCompleted: true,
        },
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<OnboardingForm onCompleted={assign} />);

    await user.type(screen.getByLabelText("名称"), "  学习者  ");
    await user.click(screen.getByRole("radio", { name: "摸鱼家" }));
    await user.click(screen.getByRole("button", { name: "进入学习空间" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/onboarding",
      expect.objectContaining({
        body: JSON.stringify({ displayName: "学习者", avatarKey: 4 }),
      }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledOnce());
  });
});

describe("recovery UI", () => {
  it("preserves the recovery response profile display name", async () => {
    const onRecovered = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      ok: true,
      data: {
        profile: { id: "profile-1", displayName: "Attention_001", avatarKey: 1 },
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<RecoverForm onRecovered={onRecovered} />);

    await user.type(screen.getByLabelText("邮箱"), "student@example.com");
    await user.type(screen.getByLabelText("恢复码"), "01234-56789-ABCDE-FGHJK-MNPQRS");
    await user.type(screen.getByLabelText("新密码"), "new-password123");
    await user.type(screen.getByLabelText("确认新密码"), "new-password123");
    await user.click(screen.getByRole("button", { name: "重设密码" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/recover",
      expect.objectContaining({
        body: JSON.stringify({
          email: "student@example.com",
          recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
          newPassword: "new-password123",
        }),
      }),
    );

    await waitFor(() => {
      expect(onRecovered).toHaveBeenCalledWith({
        displayName: "Attention_001",
        recoveryCode: "01234-56789-ABCDE-FGHJK-MNPQRS",
      });
    });
  });
});
