import { expect, test } from "@playwright/test";
import { otherDateLabel, register, saveCheckIn } from "./helpers";

const image = {
  name: "note.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL7WAAAAABJRU5ErkJggg==",
    "base64",
  ),
};

test("covers check-in persistence, switching, images, and offline drafts", async ({ page, context }) => {
  await register(page);
  const attention = "E2E first attention";
  await saveCheckIn(page, attention);
  const dailyEcho = page.getByRole("dialog", { name: "今日回响" });
  await expect(dailyEcho).toBeVisible();
  await dailyEcho.getByRole("button", { name: "关闭纪念卡" }).click();
  await expect(page.getByTestId("checkin-actions")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue(attention);
  await page.getByRole("button", { name: new RegExp(otherDateLabel()) }).click();
  await page.getByRole("button", { name: /今天/ }).first().click();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue(attention);

  await page.getByRole("textbox", { name: "今日知识主题", exact: true }).fill("E2E edited attention");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("修改已保存到云端")).toBeVisible();
  await expect(dailyEcho).not.toBeVisible();

  await page.getByRole("textbox", { name: "今日知识主题", exact: true }).fill("cancel draft");
  await page.getByRole("button", { name: new RegExp(otherDateLabel()) }).click();
  const dialog = page.getByRole("dialog", { name: "尚未保存" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue("cancel draft");

  await page.getByRole("button", { name: new RegExp(otherDateLabel()) }).click();
  await dialog.getByRole("button", { name: "放弃修改" }).click();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue("");

  await page.getByRole("textbox", { name: "今日知识主题", exact: true }).fill("save before switch");
  await page.getByRole("button", { name: /今天/ }).first().click();
  await dialog.getByRole("button", { name: "保存并切换" }).click();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue("E2E edited attention");

  await page.getByLabel("添加图片笔记").setInputFiles(image);
  await expect(page.getByRole("button", { name: "移除图片" })).toBeVisible();
  await expect(page.locator(".image-preview img")).toBeVisible();

  await page.getByLabel("替换图片").setInputFiles({ ...image, name: "replacement.png" });
  await expect(page.getByText("replacement.png", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "移除图片" }).click();
  await expect(page.getByLabel("添加图片笔记")).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("textbox", { name: "今日知识主题", exact: true }).fill("offline draft");
  await expect(page.getByText("离线，内容已保存在此浏览器")).toBeVisible();
  await page.waitForTimeout(600);

  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue("offline draft");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("offline draft", { exact: true }).first()).toBeVisible();
});
