// Synthetic demo only: mixed features and different source dates use one daily quota.
import { chromium, expect } from "@playwright/test";
const origin = "http://127.0.0.1:4300";
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) return route.abort();
    return route.continue();
  });
  await page.goto(`${origin}/?demo=1&scenario=ai&theme=light`, { waitUntil: "networkidle" });
  const results = await page.evaluate(async () => {
    const today = new Date();
    const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    // The demo's relative example dates may span two months.
    const previous = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const previousMonth = `${previous.getFullYear()}-${String(previous.getMonth() + 1).padStart(2, "0")}`;
    const records = (await Promise.all([month, previousMonth].map(async key => (await (await fetch(`/api/checkins?month=${key}`)).json()).data))).flat();
    const aiDates = records.filter(record => record.entryMode === "ai").map(record => record.date).sort().slice(0, 2);
    const manualDates = records.filter(record => record.entryMode === "manual").map(record => record.date).sort().slice(0, 2);
    const post = async (path, body) => {
      const response = await fetch(path, { method: "POST", body: JSON.stringify({ ...body, idempotencyKey: crypto.randomUUID() }) });
      return { status: response.status, ...(await response.json()) };
    };
    const outcomes = [];
    outcomes.push(await post("/api/ai/generations", { targetDate: "2026-01-01", sourceUrl: "https://example.com/one" }));
    outcomes.push(await post("/api/knowledge-narratives", { dates: aiDates, entryMode: "ai", question: "" }));
    outcomes.push(await post("/api/ai/generations", { targetDate: "2026-02-02", sourceUrl: "https://example.com/two" }));
    outcomes.push(await post("/api/knowledge-narratives", { dates: manualDates, entryMode: "manual", question: "" }));
    outcomes.push(await post("/api/ai/generations", { targetDate: "2026-03-03", sourceUrl: "https://example.com/three" }));
    return outcomes;
  });
  expect(results.map(result => result.status)).toEqual([202, 202, 202, 202, 202]);
  expect([results[0], results[2], results[4]].map(result => result.data.quota.remaining)).toEqual([4, 2, 0]);
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本账号今天的 5 次 AI 生成机会已用完");
  await expect(page.getByRole("alert")).toContainText("知识提炼与知识串联共用额度");
  await page.screenshot({ path: "/tmp/aura-shared-quota-extraction.png", fullPage: true });
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await page.getByRole("button", { name: "新增串联知识", exact: true }).click();
  await page.locator(".calendar-cell.recorded").nth(0).click();
  await page.locator(".calendar-cell.recorded").nth(1).click();
  await page.getByRole("button", { name: "生成知识脉络", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本账号今天的 5 次 AI 生成机会已用完");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("本账号今天的 5 次 AI 生成机会已用完");
  expect(errors).toEqual([]);
  console.log("PASS: 3 extractions across 3 calendar dates + 2 narratives exhaust one shared quota; both UI entry points reject the sixth request; reload does not reset quota; no live API calls.");
} finally { await browser.close(); }
