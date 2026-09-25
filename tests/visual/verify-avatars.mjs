// Isolated browser checks of real UI components. All APIs are intercepted;
// profile/onboarding writes are simulated in memory, never sent to a server.
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const output = process.env.ATTENTION_VISUAL_OUTPUT || "/tmp/aura-avatar-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const names = ["白日梦家", "学者", "技术发烧友", "摸鱼家", "行动派"];
const files = ["dreamer", "scholar", "technophile", "lounger", "doer"];
const origin = "http://127.0.0.1:4300";
const theme = process.env.AURA_VISUAL_THEME === "light" ? "light" : "dark";
const assetSuffix = theme === "light" ? "-light" : "";

async function fixture(width, view, avatarKey = 5, height = 900, reducedMotion = "no-preference") {
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion, timezoneId: "Asia/Shanghai" });
  await page.addInitScript(theme => localStorage.setItem("aura-color-theme", theme), theme);
  let profile = { id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey, onboardingCompleted: true };
  const writes = [];
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  await page.clock.setFixedTime(new Date("2026-09-10T02:00:00Z"));
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      failures.push(`Blocked external request: ${url.origin}`);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data;
    if (request.method() === "GET") {
      if (url.pathname === "/api/me") data = { profile };
      else if (url.pathname === "/api/checkins/stats") data = { totalCount: 0, currentStreak: 0, hasTodayRecord: false };
      else if (url.pathname === "/api/checkins") data = [];
      else if (url.pathname.startsWith("/api/checkins/")) data = null;
    } else if ((request.method() === "PATCH" && url.pathname === "/api/me") || (request.method() === "POST" && url.pathname === "/api/onboarding")) {
      const body = request.postDataJSON();
      writes.push({ method: request.method(), path: url.pathname, body });
      profile = { ...profile, ...body };
      data = { profile };
    }
    if (data === undefined) {
      failures.push(`Blocked unexpected API: ${request.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.fulfill({ json: { ok: true, data, requestId: "avatar-isolated-qa" } });
  });
  await page.goto(`${origin}/?view=${view}&fixture=1`, { waitUntil: "networkidle" });
  if (view !== "onboarding") await expect(page.locator(".current-account img")).toHaveAttribute("src", `/avatars/aura-${files[avatarKey - 1]}${assetSuffix}.png`);
  return { page, writes };
}

async function openProfile(page) {
  await page.getByRole("button", { name: "打开账户菜单" }).click();
  await page.getByRole("menuitem", { name: "编辑资料" }).click();
  await expect(page.getByRole("dialog", { name: "编辑资料" })).toBeVisible();
  await expect(page.getByLabel("名称")).toBeFocused();
}

async function inspectChoices(page, width) {
  await expect(page.getByRole("radio")).toHaveCount(5);
  for (const [index, name] of names.entries()) {
    const radio = page.getByRole("radio", { name, exact: true });
    await expect(radio).toHaveValue(String(index + 1));
    const card = page.locator(".aura-avatar-card").nth(index);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator("img")).toHaveAttribute("src", `/avatars/aura-${files[index]}${assetSuffix}.png`);
    await expect.poll(() => card.locator("img").evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    expect(await card.evaluate(el => el.scrollWidth <= el.clientWidth), `${name} card has no clipped text`).toBe(true);
    const target = await card.boundingBox();
    expect(target.width).toBeGreaterThan(44);
    expect(target.height).toBeGreaterThan(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px has no horizontal overflow`).toBe(true);
  const boxes = await page.locator(".aura-avatar-card").evaluateAll(els => els.map(el => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width };
  }));
  const rows = width <= 560 ? [[0, 1], [2, 3], [4]] : [[0, 1, 2], [3, 4]];
  for (const row of rows) for (const i of row) expect(Math.abs(boxes[i].y - boxes[row[0]].y)).toBeLessThan(1);
  for (let i = 1; i < rows.length; i++) expect(boxes[rows[i][0]].y).toBeGreaterThan(boxes[rows[i - 1][0]].y);
  const grid = await page.locator(".aura-avatar-grid").boundingBox();
  const lastRow = rows.at(-1);
  const midpoint = (boxes[lastRow[0]].x + boxes[lastRow.at(-1)].x + boxes[lastRow.at(-1)].width) / 2;
  expect(Math.abs(midpoint - (grid.x + grid.width / 2)), "Last row is centered").toBeLessThan(2);
}

async function capture(page, name) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, name), fullPage: true });
}

try {
  for (const width of [1440, 768, 390, 320]) {
    const { page, writes } = await fixture(width, "onboarding");
    await inspectChoices(page, width);
    await expect(page.locator('input[type="radio"]:checked')).toHaveCount(0);
    await page.getByRole("textbox", { name: "名称" }).fill("学习者");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("radio", { name: names[0], exact: true })).toBeFocused();
    await expect(page.locator(".aura-avatar-card").first()).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: names[1], exact: true })).toBeChecked();
    await page.locator(".aura-avatar-card").last().click();
    await expect(page.getByRole("radio", { name: "行动派", exact: true })).toBeChecked();
    expect(writes).toHaveLength(0);
    await capture(page, `onboarding-${width}.png`);
    await page.getByRole("button", { name: "进入学习空间", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-onboarding-completed", "true");
    expect(writes).toEqual([{ method: "POST", path: "/api/onboarding", body: { displayName: "学习者", avatarKey: 5 } }]);
    await page.close();

    const profile = await fixture(width, "workspace");
    await openProfile(profile.page);
    await inspectChoices(profile.page, width);
    await expect(profile.page.getByRole("radio", { name: "行动派", exact: true })).toBeChecked();
    await capture(profile.page, `profile-${width}.png`);
    await profile.page.locator(".aura-avatar-card").nth(1).click();
    await profile.page.getByRole("button", { name: "取消", exact: true }).click();
    expect(profile.writes).toHaveLength(0);
    await openProfile(profile.page);
    await expect(profile.page.getByRole("radio", { name: "行动派", exact: true })).toBeChecked();
    await profile.page.locator(".aura-avatar-card").nth(1).click();
    await profile.page.getByRole("button", { name: "保存资料", exact: true }).click();
    await expect(profile.page.getByRole("dialog", { name: "编辑资料" })).toHaveCount(0);
    await expect(profile.page.locator(".current-account img")).toHaveAttribute("src", `/avatars/aura-scholar${assetSuffix}.png`);
    expect(profile.writes).toEqual([{ method: "PATCH", path: "/api/me", body: { displayName: "学习者", avatarKey: 2 } }]);
    await openProfile(profile.page);
    await expect(profile.page.getByRole("radio", { name: "学者", exact: true })).toBeChecked();
    await profile.page.close();
  }

  const { page } = await fixture(1024, "workspace", 3, 600, "reduce");
  await openProfile(page);
  await inspectChoices(page, 1024);
  const card = page.locator(".aura-avatar-card").last();
  await card.hover();
  await expect(card).toHaveCSS("transition-duration", "0s");
  await page.getByRole("button", { name: "保存资料", exact: true }).focus();
  await expect(page.getByRole("button", { name: "保存资料", exact: true })).toBeInViewport();
  await capture(page, "profile-short-reduced-motion.png");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "打开账户菜单" })).toBeFocused();
  await page.close();
  expect(failures).toEqual([]);
  console.log(JSON.stringify({ result: "PASS", theme, viewports: [1440, 768, 390, 320], shortViewport: "1024×600", verified: "five assets/IDs, centered rows, no overflow, keyboard/focus, cancel, simulated save, existing avatar persistence, reduced motion", realApiWrites: 0, screenshots: output }, null, 2));
} finally {
  await browser.close();
}
