import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RegisterForm } from "@/features/auth/register-form";
import { RecoveryCodeDialog } from "@/features/auth/recovery-code-dialog";

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
});
