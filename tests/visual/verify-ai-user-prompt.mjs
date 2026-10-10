// Exercises the real UI with synthetic demo responses; never calls a model or production API.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = "http://127.0.0.1:4300";
const output = "/tmp/aura-user-prompt-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      errors.push(`Unexpected network request: ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/?demo=1&scenario=ai&theme=light`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /AI 提炼/ }).click();
  const toggle = page.getByRole("button", { name: /提炼要求/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  const prompt = page.getByRole("textbox", { name: "提炼要求", exact: true });
  await prompt.fill("我是产品经理，重点解释用户访谈的提问方式与适用边界；先说明为什么，再解释怎么做。");
  await page.locator("#source-url").fill("https://example.com/learning/user-interviews");
  await page.getByRole("button", { name: /手动记录/ }).click();
  await expect(prompt).toHaveCount(0);
  await page.getByRole("button", { name: /AI 提炼/ }).click();
  await expect(prompt).toHaveValue(/我是产品经理/);
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(prompt).toBeDisabled();
  await expect(page.getByRole("region", { name: "知识结构图" })).toBeVisible({ timeout: 18000 });
  await expect(prompt).toBeEnabled();
  await page.locator(".ai-prompt-history summary").click();
  await expect(page.locator(".ai-prompt-history")).toContainText("我是产品经理");
  await prompt.fill("下次请重点解释如何验证访谈结论。");
  await expect(page.getByText(/修改后重新提炼生效/)).toBeVisible();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".editor-state")).toContainText("已保存");
  await page.reload({ waitUntil: "networkidle" });
  await expect(prompt).toHaveValue("下次请重点解释如何验证访谈结论。");
  await page.locator(".ai-prompt-history summary").click();
  await expect(page.locator(".ai-prompt-history")).toContainText("我是产品经理");
  for (const theme of ["light", "dark"]) {
    if (theme === "dark") await page.getByRole("button", { name: /切换.*深色/ }).click();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1100 });
      await prompt.scrollIntoViewIfNeeded();
      await expect(prompt).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `${output}/${theme}-${width}.png`, fullPage: true });
    }
  }
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: "PASS", checked: "optional requirements; mode isolation; task lock; immutable result context; save/reload; light/dark desktop/mobile", screenshots: output }));
} finally {
  await browser.close();
}
