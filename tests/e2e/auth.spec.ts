import { expect, test } from "@playwright/test";
import { logout, password, register, waitForClient } from "./helpers";

test("registers, logs in, recovers, and invalidates the old recovery code", async ({ page }) => {
  const { code, name } = await register(page);

  await logout(page);
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

  await logout(page);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await waitForClient(page);
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("恢复码").fill(code);
  await page.getByRole("textbox", { name: "新密码", exact: true }).fill("new-password123");
  await page.getByLabel("确认新密码").fill("new-password123");
  await page.getByRole("button", { name: "重设密码" }).click();
  await expect(page.getByRole("heading", { name: "恢复码只显示这一次" })).toBeVisible();
  await page.getByRole("button", { name: "我已保存" }).click();
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeVisible();

  await logout(page);
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page).toHaveURL(/\/recover$/);
  await waitForClient(page);
  await page.getByLabel("名称").fill(name);
  await page.getByLabel("恢复码").fill(code);
  await page.getByRole("textbox", { name: "新密码", exact: true }).fill("another-password123");
  await page.getByLabel("确认新密码").fill("another-password123");
  await page.getByRole("button", { name: "重设密码" }).click();
  await expect(page.getByRole("alert")).toHaveText("名称或恢复码不正确");
});
