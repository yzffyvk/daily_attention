// Isolated motion preview: no API credentials, real generations, or user records.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

const origin = "http://127.0.0.1:4300";
const output = "/tmp/knowledge-constellation-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "no-preference" });
    page.on("pageerror", error => failures.push(error.message));
    page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith("/api/")) {
        failures.push(`Unexpected request: ${url.origin}${url.pathname}`);
        return route.abort();
      }
      return route.continue();
    });
    await page.goto(`${origin}/?view=constellation&fixture=1`, { waitUntil: "networkidle" });
    const sky = page.getByRole("region", { name: "知识星图生成中" });
    await expect(sky).toBeVisible();
    await expect(page.getByRole("status")).toContainText("正在生成");
    await expect(page.getByRole("status")).not.toContainText(/\d+%/);
    expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
    const setTime = time => page.evaluate(time => {
        for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
      }, time);
    const isAssembled = () => page.locator(".constellation-star").evaluateAll(stars => stars.every(star => {
      const matrix = new DOMMatrix(getComputedStyle(star).transform);
      return Math.abs(matrix.e) < .01 && Math.abs(matrix.f) < .01;
    }));
    let gatheringBrightness;
    for (const [stage, milliseconds] of [["scattered", 1200], ["gathering", 6500], ["connected", 14500], ["illuminated", 18000]]) {
      await setTime(milliseconds);
      if (stage === "gathering") {
        expect(await isAssembled()).toBe(false);
        gatheringBrightness = await page.locator(".constellation-assembly").evaluate(element => Number(/brightness\(([\d.]+)\)/.exec(getComputedStyle(element).filter)[1]));
      }
      await sky.screenshot({ path: `${output}/${stage}-${width}.png`, animations: "allow" });
    }
    expect(await isAssembled()).toBe(true);
    const completeBrightness = await page.locator(".constellation-assembly").evaluate(element => Number(/brightness\(([\d.]+)\)/.exec(getComputedStyle(element).filter)[1]));
    expect(completeBrightness).toBeGreaterThan(gatheringBrightness * 1.5);
    expect(await page.locator(".constellation-monogram").evaluate(element => {
      const box = element.getBBox();
      return box.width / box.height;
    })).toBeGreaterThan(1.8);
    await setTime(26000);
    expect(await isAssembled()).toBe(false);
    await sky.screenshot({ path: `${output}/next-cycle-${width}.png`, animations: "allow" });
    await setTime(42000);
    expect(await isAssembled()).toBe(true);
    // Replay replaces the completed sky and its screenshot-only animation overrides.
    await page.getByRole("button", { name: "重新播放星图动效" }).click();
    expect(await page.locator(".constellation-star").evaluateAll(stars => stars.some(star => {
      const matrix = new DOMMatrix(getComputedStyle(star).transform);
      return Math.abs(matrix.e) > 20 || Math.abs(matrix.f) > 20;
    }))).toBe(true);
    const pause = page.getByRole("button", { name: "暂停星图动效" });
    await pause.focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "播放星图动效", exact: true })).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.getAnimations().every(animation => animation.playState === "paused"))).toBe(true);
    await page.getByRole("button", { name: "播放星图动效", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.getAnimations().every(animation => animation.playState === "running"))).toBe(true);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.getByText("静态星图", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "暂停星图动效" })).toHaveCount(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await sky.screenshot({ path: `${output}/reduced-${width}.png` });
    await page.goto(`${origin}/?view=constellation&stars=14&fixture=1`, { waitUntil: "networkidle" });
    await expect(page.getByText("来自 14 天的学习", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("region", { name: "知识星图生成中" }).screenshot({ path: `${output}/fourteen-${width}.png` });
    await page.close();
  }
  expect(failures).toEqual([]);
  await writeFile(`${output}/verification.json`, JSON.stringify({ passed: true, widths: [1440, 390, 320], checks: ["slower gathering", "brighter completed A", "wide perspective", "automatic repeat across two cycles", "replay", "keyboard pause and resume", "reduced motion", "14 dates", "no overflow", "no API calls"], failures }, null, 2));
  console.log(`Constellation motion checks passed: ${output}`);
} finally { await browser.close(); }
