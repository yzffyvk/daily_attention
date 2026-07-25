import { expect, test } from "@playwright/test";
import { logout, password, register, waitForClient } from "./helpers";

test("registers, rotates its recovery code, logs in, and recovers", async ({ page }) => {
  const { code: originalCode, phone } = await register(page);

  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "更新恢复码" }).click();
  await expect(page.getByRole("dialog", { name: "更新恢复码" })).toBeVisible();
  await page.getByLabel("当前密码").fill(password);
  await page.getByRole("button", { name: "生成新的恢复码" }).click();
  const rotatedCodeOutput = page.locator('output[aria-label="恢复码"]');
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  const rotatedCode = (await rotatedCodeOutput.textContent())?.trim();
  if (!rotatedCode) throw new Error("Recovery-code rotation did not show the new code");
  await page.getByRole("button", { name: "我已保存" }).click();

  await logout(page);
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

  await logout(page);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await waitForClient(page);
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("恢复码").fill(originalCode);
  await page.getByRole("textbox", { name: "新密码", exact: true }).fill("new-password123");
  await page.getByLabel("确认新密码").fill("new-password123");
  await page.getByRole("button", { name: "重设密码" }).click();
  await expect(page.getByRole("alert")).toHaveText("手机号或恢复码不正确");

  await page.getByLabel("恢复码").fill(rotatedCode);
  await page.getByRole("button", { name: "重设密码" }).click();
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

  await logout(page);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await waitForClient(page);
  await page.getByLabel("手机号").fill(phone);
  await page.getByLabel("恢复码").fill(rotatedCode);
  await page.getByRole("textbox", { name: "新密码", exact: true }).fill("another-password123");
  await page.getByLabel("确认新密码").fill("another-password123");
  await page.getByRole("button", { name: "重设密码" }).click();
  await expect(page.getByRole("alert")).toHaveText("手机号或恢复码不正确");
});
