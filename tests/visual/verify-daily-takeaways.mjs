import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = "work/daily-takeaways-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport, theme] of [
    ["desktop", { width: 1440, height: 1000 }, "dark"],
    ["mobile", { width: 390, height: 844 }, "light"],
    ["narrow", { width: 320, height: 740 }, "dark"],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:4300/?demo=1&theme=${theme}`);
    await expect(page.getByRole("button", { name: "读今日新知" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: `${output}/${name}-home.png`, fullPage: true });
    await page.getByRole("button", { name: "读今日新知" }).click();
    const dialog = page.getByRole("dialog", { name: "每日新知" });
    await expect(dialog).toBeVisible();
    await page.screenshot({ path: `${output}/${name}-reader.png` });
    await dialog.getByText("做一道小判断").click();
    await dialog.getByRole("radio").nth(1).check();
    await expect(dialog.getByText("再看一眼这个细节")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "收下今日新知" })).toBeEnabled();
    await dialog.getByRole("button", { name: "收下今日新知" }).click();
    await expect(dialog.getByText("今天带走了")).toBeVisible();
    await page.screenshot({ path: `${output}/${name}-received.png` });
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.getByRole("button", { name: "回看今日收获" })).toBeVisible();
    await expect(page.getByRole("button", { name: "读今日新知" })).toHaveCount(0);
    await page.getByRole("button", { name: /我的新知/ }).click();
    await expect(page.getByRole("dialog")).toContainText("一场网球比赛怎样从一分走到胜负");
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth > innerWidth + 1,
      dialog: (() => { const item = document.querySelector(".takeaway-dialog"); return item.scrollWidth > item.clientWidth + 1; })(),
    }));
    expect(overflow).toEqual({ page: false, dialog: false });
    expect(errors).toEqual([]);
    await context.close();
    console.log(`${name}: reading, optional quiz, collect, refresh, history, layout passed`);
  }

  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.goto("http://127.0.0.1:4300/?demo=1&takeaway=milestone");
  await page.getByRole("button", { name: "读今日新知" }).click();
  await page.getByRole("button", { name: "收下今日新知" }).click();
  await expect(page.getByText("7 条新知，回看这一路的收获")).toBeVisible();
  await page.getByText("7 条新知，回看这一路的收获").click();
  await page.screenshot({ path: `${output}/milestone.png` });

  await page.goto("http://127.0.0.1:4300/?demo=1&takeaway=history");
  await page.getByRole("button", { name: /我的新知/ }).click();
  await page.getByLabel("按主题筛选").selectOption("technique");
  await page.screenshot({ path: `${output}/history-filter.png` });
  await expect(page.locator(".takeaway-history-list li")).toHaveCount(3);
  await expect(page.locator(".takeaway-history-list .takeaway-history-date span")).toHaveText(["基础击球", "基础击球", "基础击球"]);

  await page.goto("http://127.0.0.1:4300/?demo=1&takeaway=save-error");
  await page.getByRole("button", { name: "读今日新知" }).click();
  await page.getByRole("button", { name: "收下今日新知" }).click();
  await expect(page.getByRole("alert")).toContainText("这次保存没有完成");
  await page.getByRole("button", { name: "收下今日新知" }).click();
  await expect(page.getByText("今天带走了")).toBeVisible();
  await page.goto("http://127.0.0.1:4300/?demo=1&takeaway=complete");
  await expect(page.getByText("本阶段已完成")).toBeVisible();
  console.log("milestone, topic filtering, save retry, exhaustion passed");
} finally {
  await browser.close();
}
