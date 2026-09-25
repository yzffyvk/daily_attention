// Exercises the real frontend against the opt-in demo. No extra API mocks.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const origin = "http://127.0.0.1:4300";
const output = "/tmp/aura-demo-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
  page.on("pageerror", e => failures.push(e.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) {
      failures.push(`Unexpected network request: ${url.pathname}`);
      return route.abort();
    }
    return route.continue();
  });
  await page.goto(`${origin}/?demo=1&scenario=ai&theme=light`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: /AI 提炼/ }).click();
  await page.locator("#source-url").fill("https://example.com/learning/user-interviews");
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(page.getByRole("region", { name: "知识结构图" })).toBeVisible({ timeout: 18000 });
  await page.getByRole("button", { name: "具体经历", exact: true }).click();
  await expect(page.getByRole("region", { name: "节点解释" })).toContainText("上一次");
  await page.screenshot({ path: `${output}/ai-result-1440.png`, fullPage: true });
  await page.locator("#inspiration").fill("访谈时先问用户上一次怎么做，再问为什么。不能把用户想要的功能直接当成需求。");
  await page.getByRole("button", { name: "AI 润色", exact: true }).click();
  await expect(page.getByRole("region", { name: "AI 润色建议" })).toBeVisible();
  await page.getByRole("button", { name: "采纳建议", exact: true }).click();
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator(".editor-state")).toContainText("已保存");
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("region", { name: "知识结构图" })).toBeVisible();
  await page.getByRole("link", { name: "同主题串联", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await page.getByRole("button", { name: "新增串联知识", exact: true }).click();
  for (const topic of ["用户访谈", "需求优先级", "原型测试"]) await page.locator(".calendar-cell.recorded").filter({ hasText: topic }).first().click();
  await page.getByLabel("想探索的问题（可选）").fill("如何从用户反馈走到可验证的方案？");
  await page.getByRole("button", { name: "生成知识脉络", exact: true }).click();
  await expect(page.locator(".knowledge-constellation")).toBeVisible();
  await page.screenshot({ path: `${output}/map-generating-1440.png`, fullPage: true });
  await expect(page.getByRole("region", { name: "概念关系图" })).toBeVisible({ timeout: 18000 });
  await page.getByRole("region", { name: "概念关系图" }).getByRole("button", { name: "查看概念 需求假设", exact: true }).click();
  await expect(page.getByRole("region", { name: "概念详情" })).toContainText("为什么补充这个概念");
  await page.screenshot({ path: `${output}/map-result-1440.png`, fullPage: true });
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await page.getByLabel("概念 1 解释", { exact: true }).fill("验收修改：从用户的具体经历发现问题。");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("region", { name: "概念详情" })).toContainText("验收修改");
  await page.getByRole("link", { name: "多主题展示", exact: true }).click();
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await page.getByRole("button", { name: "新增串联知识", exact: true }).click();
  for (const topic of ["手冲咖啡", "宋词", "徒步"]) await page.locator(".calendar-cell.recorded").filter({ hasText: topic }).first().click();
  await page.getByRole("button", { name: "生成知识脉络", exact: true }).click();
  await expect(page.getByRole("article", { name: "原始学习记录" })).toBeVisible({ timeout: 18000 });
  await expect(page.getByRole("region", { name: "概念关系图" })).toHaveCount(0);
  await page.screenshot({ path: `${output}/mixed-result-1440.png`, fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/mixed-result-${width}.png`, fullPage: true });
  }
  expect(failures).toEqual([]);
  console.log(JSON.stringify({ result: "PASS", checked: "AI generation/detail/polish/save/reload; graph create/progress/supplement/edit; mixed records; no real API calls", screenshots: output }));
} finally { await browser.close(); }
