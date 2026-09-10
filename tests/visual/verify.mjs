import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const output = process.env.ATTENTION_VISUAL_OUTPUT || "/tmp/attention-eclipse-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const profile = { id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true };
const titles = {
  "2026-09-02": "重新理解注意力",
  "2026-09-04": "让知识走向行动",
  "2026-09-07": "深度工作的节奏",
  "2026-09-08": "学习之后主动回想",
  "2026-09-09": "把想法变成一次小实践",
};
function record(date, attention) {
  return { id: `visual-${date}`, date, attention, sourceUrl: "https://example.com", summary: "把理解转化为行动，在实践中检验自己的想法。", inspiration: "明天尝试一个更专注的晨间时段。", imagePath: null, imageUrl: null, imageName: "", version: 1, createdAt: `${date}T02:00:00Z`, updatedAt: `${date}T02:00:00Z` };
}
const records = Object.fromEntries(Object.entries(titles).map(([date, title]) => [date, record(date, title)]));
// Existing-image fixture: local artwork only, no signed URLs or user storage.
records["2026-09-08"].imagePath = "test-only/note.png";
records["2026-09-08"].imageUrl = "http://127.0.0.1:4300/visuals/attention-eclipse.png";
records["2026-09-08"].imageName = "学习脑图.png";

async function pageFor(viewport, reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, reducedMotion, timezoneId: "Asia/Shanghai" });
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  await page.clock.setFixedTime(new Date("2026-09-10T02:00:00Z"));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== "http://127.0.0.1:4300") {
      failures.push(`Blocked unexpected external request: ${url.origin}`);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    if (route.request().method() !== "GET") {
      failures.push(`Blocked unexpected write: ${url.pathname}`);
      return route.abort();
    }
    let data;
    if (url.pathname === "/api/me") data = { profile };
    else if (url.pathname === "/api/checkins/stats") data = { totalCount: 5, currentStreak: 3, hasTodayRecord: false };
    else if (url.pathname === "/api/checkins") data = Object.values(records).filter(r => r.date.startsWith(url.searchParams.get("month"))).map(r => ({ date: r.date, attention: r.attention, version: r.version, updatedAt: r.updatedAt, hasImage: !!r.imagePath }));
    else if (url.pathname.startsWith("/api/checkins/")) data = records[url.pathname.split("/").pop()] ?? null;
    else { failures.push(`Unhandled test request: ${url.pathname}`); return route.abort(); }
    return route.fulfill({ json: { ok: true, data, requestId: "isolated-visual-qa" } });
  });
  await page.goto("http://127.0.0.1:4300/", { waitUntil: "networkidle" });
  await expect(page.getByRole("textbox", { name: "我的注意力", exact: true })).toBeEnabled();
  return page;
}

async function fillReferenceDraft(page) {
  await page.getByRole("textbox", { name: "我的注意力", exact: true }).fill("让知识不止停留在收藏夹");
  await page.locator("#summary").fill("今天阅读了一篇关于深度工作的文章，重新思考了注意力的分配方式。\n真正的成长，来自于把感兴趣的内容，转化为可实践的行动。");
  await page.locator("#source-url").fill("https://example.com");
  await page.locator("#inspiration").fill("或许可以尝试一个更专注的晨间时段，减少不必要的信息输入。");
  await page.locator("#inspiration").blur();
  await page.mouse.move(10, 10);
  await expect(page.getByRole("button", { name: "保存记录，完成打卡" })).toBeEnabled();
}

async function capture(page, name, fullPage = true) {
  // Let short color/focus transitions settle; behavioral assertions use web-first waits.
  await page.waitForTimeout(240);
  await page.screenshot({ path: path.join(output, name), fullPage });
}

async function checkFullImage(page, name) {
  const trigger = page.getByRole("button", { name: /查看完整图片：/ });
  await trigger.scrollIntoViewIfNeeded();
  const scrollBefore = await page.evaluate(() => scrollY);
  const source = await trigger.locator("img").getAttribute("src");
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "图片笔记" });
  await expect(dialog).toBeVisible();
  const image = dialog.getByRole("img");
  await expect(image).toHaveAttribute("src", source);
  await expect.poll(() => image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await expect(image).toHaveCSS("object-fit", "contain");
  const close = page.getByRole("button", { name: "关闭图片预览" });
  await expect(close).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(close).toBeFocused();
  expect(await page.locator("#root").evaluate(el => el.inert)).toBe(true);
  expect(await image.evaluate(el => {
    const box = el.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight;
  }), "Full image stays inside the viewport").toBe(true);
  await image.click();
  await expect(dialog).toBeVisible();
  await capture(page, name, false);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.locator("#root").evaluate(el => el.inert)).toBe(false);
  expect(Math.abs(await page.evaluate(() => scrollY) - scrollBefore)).toBeLessThan(2);
  await trigger.click();
  await close.click();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await page.locator(".image-lightbox-backdrop").click({ position: { x: 3, y: 3 } });
  await expect(dialog).toHaveCount(0);
}

try {
  const page = await pageFor({ width: 1487, height: 1058 });
  await expect(page.locator(".aura-brand")).toContainText("Aura");
  await expect(page.locator(".aura-brand")).toContainText("知序");
  expect(await page.locator(".aura-brand img").evaluate(el => el.complete && el.naturalWidth === 64)).toBe(true);
  await expect(page.getByRole("button", { name: /9月9日，已保存/ }).locator("small")).toHaveCSS("color", "rgb(216, 188, 131)");
  await fillReferenceDraft(page);
  await capture(page, "desktop.png", false);
  await capture(page, "desktop-full.png");
  await page.getByRole("button", { name: /9月9日，已保存/ }).hover();
  await expect(page.getByRole("tooltip")).toContainText(/把想法变成一次小实践/);
  // DOM visibility alone misses overflow clipping. Hit-test the painted tooltip.
  expect(await page.getByRole("tooltip").evaluate(el => {
    const box = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
  }), "Full title is painted outside the day cell").toBe(true);
  await capture(page, "calendar-hover.png");
  await page.getByRole("button", { name: /9月9日，已保存/ }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await page.getByRole("button", { name: /9月9日，已保存/ }).click();
  await expect(page.getByRole("dialog", { name: "尚未保存" })).toBeVisible();
  await capture(page, "dirty-dialog.png", false);
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "我的注意力", exact: true })).toHaveValue("把想法变成一次小实践");
  await page.getByRole("button", { name: "AI 提炼" }).click();
  await expect(page.getByRole("button", { name: "生成知识小结" })).toBeEnabled();
  await capture(page, "ai-mode.png");
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "编辑资料" }).click();
  await expect(page.getByRole("dialog", { name: "编辑资料" })).toBeVisible();
  expect(await page.getByLabel("名称").evaluate(el => getComputedStyle(el).backgroundColor)).toBe("rgb(8, 10, 13)");
  await capture(page, "profile-dialog.png", false);
  await page.getByRole("button", { name: "关闭资料设置" }).click();
  await page.getByRole("button", { name: "手动记录" }).click();
  await page.getByLabel("添加图片笔记").focus();
  expect(await page.locator(".upload-dropzone").evaluate(el => getComputedStyle(el).outlineStyle), "Upload field has a visible keyboard focus outline").not.toBe("none");
  await page.getByRole("button", { name: "回到今天", exact: true }).click();
  await expect(page.getByRole("button", { name: /9月10日，暂无记录，当前选中/ })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "上个月", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026年8月" })).toBeVisible();
  await page.getByRole("button", { name: "回到今天", exact: true }).click();
  await expect(page.getByRole("heading", { name: "2026年9月" })).toBeVisible();
  await page.getByRole("button", { name: /9月8日，已保存/ }).click();
  await expect(page.getByRole("button", { name: /查看完整图片：/ })).toBeVisible();
  await checkFullImage(page, "image-saved-desktop.png");
  await page.close();

  for (const width of [1440, 1280, 1024, 900, 768, 390, 320]) {
    const mobile = await pageFor({ width, height: 844 });
    await fillReferenceDraft(mobile);
    const noOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
    expect(noOverflow, `No horizontal overflow at ${width}px`).toBe(true);
    await capture(mobile, `responsive-${width}.png`);
    if (width === 390 || width === 320) {
      // Exercises the real client-side file preparation + local blob preview.
      if (width === 390) {
        // A tall synthetic test image catches clipping that a landscape image misses.
        const portrait = await mobile.evaluate(() => {
          const canvas = document.createElement("canvas");
          canvas.width = 480;
          canvas.height = 2400;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "#e7e3d9";
          ctx.fillRect(0, 0, 480, 2400);
          ctx.fillStyle = "#1c2927";
          ctx.fillRect(0, 0, 480, 140);
          ctx.fillRect(0, 2260, 480, 140);
          ctx.fillStyle = "#d8bc83";
          ctx.font = "48px sans-serif";
          ctx.fillText("TOP", 180, 88);
          ctx.fillText("BOTTOM", 130, 2350);
          ctx.fillStyle = "#535d5b";
          for (let y = 260; y < 2200; y += 200) ctx.fillRect(50, y, 380, 12);
          return canvas.toDataURL("image/png").split(",")[1];
        });
        await mobile.getByLabel("添加图片笔记").setInputFiles({ name: "长图笔记.png", mimeType: "image/png", buffer: Buffer.from(portrait, "base64") });
      } else {
        await mobile.getByLabel("添加图片笔记").setInputFiles("public/visuals/attention-eclipse.png");
      }
      await expect(mobile.getByRole("button", { name: /查看完整图片：/ })).toBeVisible();
      expect(await mobile.getByRole("button", { name: /查看完整图片：/ }).locator("img").getAttribute("src")).toMatch(/^blob:/);
      await checkFullImage(mobile, `image-local-${width}.png`);
    }
    await mobile.close();
  }
  const reduced = await pageFor({ width: 1487, height: 1058 }, "reduce");
  await reduced.mouse.move(450, 180);
  await expect(reduced.getByTestId("attention-atmosphere")).toHaveAttribute("data-motion", "off");
  expect(await reduced.locator(".attention-eclipse").evaluate(el => getComputedStyle(el).animationName)).toBe("none");
  await reduced.close();
  expect(failures).toEqual([]);
  console.log(JSON.stringify({ result: "passed", screenshots: output, consoleErrors: failures.length, writes: 0, externalRequests: 0 }));
} finally {
  await browser.close();
}
