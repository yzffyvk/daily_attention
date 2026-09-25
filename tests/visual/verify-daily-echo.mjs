// Runs the real workspace and export code with synthetic API data only.
import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:4300";
const output = "/tmp/aura-daily-echo-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const report = [];
try {
  for (const [width, height, theme] of [[1440, 1000, "light"], [390, 844, "dark"], [320, 568, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height }, timezoneId: "Asia/Shanghai", reducedMotion: "reduce", acceptDownloads: true });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date("2026-09-19T04:00:00Z"));
    page.on("pageerror", error => failures.push(error.message));
    const records = new Map();
    let rejectArtwork = false;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { failures.push(`Unexpected network request: ${url.origin}`); return route.abort(); }
      if (rejectArtwork && url.pathname === "/visuals/daily-echo-garden.png") return route.fulfill({ status: 503, body: "unavailable" });
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let data = null;
      const date = url.pathname.split("/").at(-1);
      const mode = url.searchParams.get("mode") ?? "manual";
      if (route.request().method() === "PUT") {
        const body = route.request().postDataJSON();
        data = { id: `${date}-${body.entryMode}`, date, ...body, imageUrl: null, version: (body.version ?? 0) + 1, createdAt: `${date}T00:00:00Z`, updatedAt: `${date}T00:00:00Z` };
        records.set(`${date}:${body.entryMode}`, data);
      } else if (url.pathname === "/api/me") data = { profile: { id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true } };
      else if (url.pathname === "/api/checkins/stats") data = { totalCount: records.size, currentStreak: records.size ? 1 : 0, hasTodayRecord: records.size > 0 };
      else if (url.pathname === "/api/checkins") data = [...records.values()].map(r => ({ ...r, hasImage: false }));
      else data = records.get(`${date}:${mode}`) ?? null;
      return route.fulfill({ json: { ok: true, data, requestId: "echo-visual" } });
    });
    await page.goto(`${origin}/?fixture=1&theme=${theme}`, { waitUntil: "networkidle" });
    await page.getByLabel("今日知识主题").fill("今天理解了一点点注意力机制");
    await page.getByRole("button", { name: "保存记录，完成打卡" }).click();
    const dialog = page.getByRole("dialog", { name: "今日回响" });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button", { name: "关闭纪念卡" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "收下这份鼓励" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "关闭纪念卡" })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const box = await dialog.boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `${output}/dialog-${width}-${theme}.png` });
    if (width === 1440) {
      rejectArtwork = true;
      await page.getByRole("button", { name: "保存图片", exact: true }).click();
      await expect(page.getByRole("alert")).toHaveText("图片暂时未生成，请重试保存。");
      rejectArtwork = false;
    }
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "保存图片", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("知序-今日回响-2026-09-19.png");
    const savedPath = `${output}/keepsake-${width}.png`;
    await download.saveAs(savedPath);
    const png = await readFile(savedPath);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1440);
    expect(png.readUInt32BE(20)).toBe(1920);
    await expect(dialog.locator("img.daily-echo-card")).toBeVisible();
    expect(await dialog.locator("img.daily-echo-card").evaluate(image => image.naturalWidth)).toBe(1440);
    await page.getByRole("button", { name: "收下这份鼓励" }).click();
    await expect(dialog).toHaveCount(0);
    await page.getByRole("button", { name: "查看打卡纪念卡" }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "查看打卡纪念卡" })).toBeFocused();
    await page.getByLabel("今日知识主题").fill("保存新的理解");
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator(".editor-state")).toHaveText("已保存");
    await expect(dialog).toHaveCount(0);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByRole("button", { name: "查看打卡纪念卡" })).toBeVisible();
    await expect(dialog).toHaveCount(0);
    report.push({ width, height, theme, png: `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, bytes: png.length, result: "PASS" });
    await context.close();
  }
  expect(failures).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: "PASS", report, output }));
} finally { await browser.close(); }
