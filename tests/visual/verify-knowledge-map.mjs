// Synthetic fixtures; all business APIs are intercepted, with no account writes.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { knowledgeMapFixture, knowledgeMapSourcesFixture, mapDates, sourceRecordsFixture } from "../helpers/knowledge-map-fixtures.ts";

const origin = process.env.KNOWLEDGE_VISUAL_ORIGIN || "http://127.0.0.1:4300";
const output = process.env.KNOWLEDGE_VISUAL_OUTPUT || "/tmp/knowledge-map-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const reports = [];
try {
  for (const width of [1440, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 960 }, reducedMotion: "reduce", timezoneId: "Asia/Shanghai" });
    page.on("pageerror", error => failures.push(error.message));
    page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
    let map = { id: "concept-fixture", title: knowledgeMapFixture().title, result: knowledgeMapFixture(), dates: mapDates, question: "", status: "succeeded", sources: knowledgeMapSourcesFixture(), changedDates: [], error: null, createdAt: "2026-09-17T10:00:00Z", updatedAt: "2026-09-17T10:00:00Z" };
    const records = { ...structuredClone(map), id: "records-fixture", title: "不同主题的原始记录", result: { ...sourceRecordsFixture(), title: "不同主题的原始记录" }, sources: knowledgeMapSourcesFixture().map((item, index) => ({ ...item, attention: ["咖啡萃取", "宋词意象", "周末徒步"][index], summary: ["原始咖啡笔记\n保留原有换行。", "原始宋词笔记 <script>不执行</script>", "原始徒步记录。"][index] })) };
    let edits = 0;
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) { failures.push(`Unexpected request: ${url.origin}`); return route.abort(); }
      if (!url.pathname.startsWith("/api/")) return route.continue();
      let data;
      if (url.pathname === "/api/me") data = { profile: { id: "visual-fixture", displayName: "学习者", email: "visual@example.invalid", avatarKey: 1, onboardingCompleted: true } };
      else if (url.pathname === "/api/checkins/stats") data = { totalCount: 3, currentStreak: 0, hasTodayRecord: false };
      else if (url.pathname === "/api/checkins") data = [];
      else if (url.pathname.startsWith("/api/checkins/")) data = null;
      else if (url.pathname === "/api/knowledge-narratives") data = [map, records];
      else if (url.pathname.endsWith("/concept-fixture")) {
        if (route.request().method() === "PATCH") {
          const body = route.request().postDataJSON();
          expect(body.expectedUpdatedAt).toBe(map.updatedAt);
          expect(body.result.concepts.map(item => ({ id: item.id, origin: item.origin, sourceDates: item.sourceDates }))).toEqual(map.result.concepts.map(item => ({ id: item.id, origin: item.origin, sourceDates: item.sourceDates })));
          expect(body.result.connections).toEqual(map.result.connections);
          edits++;
          map = { ...map, title: body.result.title, result: body.result, updatedAt: "2026-09-17T11:00:00Z" };
        }
        data = map;
      } else if (url.pathname.endsWith("/records-fixture")) data = records;
      else { failures.push(`Unhandled API: ${url.pathname}`); return route.abort(); }
      return route.fulfill({ status: 200, json: { ok: true, data, requestId: "concept-map-visual" } });
    });
    await page.goto(`${origin}/?fixture=1`, { waitUntil: "networkidle" });
    await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "串联知识", exact: true }).click();
    await page.getByRole("button", { name: `打开知识脉络 ${map.title}，已保存` }).click();
    const graph = page.getByRole("region", { name: "概念关系图" });
    await expect(graph).toBeVisible();
    await graph.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/map-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const supplement = graph.getByRole("button", { name: "查看概念 需求假设", exact: true });
    await supplement.focus(); await page.keyboard.press("Enter");
    const detail = page.getByRole("region", { name: "概念详情" });
    await expect(detail).toContainText("为什么补充这个概念");
    await expect(detail).toContainText("AI 补充");
    await expect(detail.getByRole("button", { name: /^查看来源/ })).toHaveCount(0);
    if (width <= 800) await expect(detail).toBeFocused();
    await page.screenshot({ path: `${output}/supplement-${width}.png` });
    const citation = page.getByRole("group", { name: "全部来源日期" }).getByRole("button", { name: "查看来源 2026-09-01" });
    await citation.focus(); await page.keyboard.press("Enter");
    const snapshot = page.getByRole("region", { name: "来源快照 2026-09-01" });
    await expect(snapshot).toBeFocused();
    await expect(snapshot).toContainText("通过具体经历了解问题发生的情境。");
    const secondCitation = page.getByRole("region", { name: "关系说明" }).getByRole("button", { name: "查看来源 2026-09-01" }).first();
    await secondCitation.scrollIntoViewIfNeeded();
    await secondCitation.focus(); await page.keyboard.press("Enter");
    await expect(snapshot).toBeFocused();
    await expect.poll(() => snapshot.evaluate(element => { const rect = element.getBoundingClientRect(); return rect.top < innerHeight && rect.bottom > 0; })).toBe(true);
    await snapshot.getByRole("button", { name: "收起来源" }).click();
    await expect(secondCitation).toBeFocused();
    await page.getByRole("region", { name: "讲述提纲" }).getByRole("button", { name: "查看概念 原型测试", exact: true }).click();
    await expect(detail).toBeFocused(); await expect(detail).toContainText("观察目标用户完成任务的过程");
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await page.getByLabel("概念 1 解释", { exact: true }).fill("我的理解：从用户具体经历出发。");
    await page.getByLabel("表达步骤 2 内容", { exact: true }).fill("先提出假设，再用测试结果解释如何修正判断。");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/editor-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.getByRole("region", { name: "概念详情" })).toContainText("我的理解：从用户具体经历出发。");
    expect(edits).toBe(1);
    await page.reload();
    await page.getByRole("button", { name: "串联知识", exact: true }).click();
    await page.getByRole("button", { name: `打开知识脉络 ${map.title}，已保存` }).click();
    await expect(page.getByRole("region", { name: "概念详情" })).toContainText("我的理解：从用户具体经历出发。");
    await page.getByRole("button", { name: "返回脉络列表", exact: true }).click();
    await page.getByRole("button", { name: "打开知识脉络 不同主题的原始记录，已保存" }).click();
    await expect(page.getByRole("region", { name: "概念关系图" })).toHaveCount(0);
    const originals = page.getByRole("article", { name: "原始学习记录" });
    await expect(originals).toContainText("原始宋词笔记 <script>不执行</script>");
    for (const source of records.sources) await expect(originals.getByRole("region", { name: `来源快照 ${source.date}` })).toContainText(source.summary);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${output}/source-records-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(page.getByRole("form", { name: "编辑知识脉络" }).getByRole("textbox")).toHaveCount(1);
    await page.goto(`${origin}/?view=knowledge-map&fixture=1`, { waitUntil: "networkidle" });
    await expect(page.getByRole("region", { name: "概念关系图" })).toBeVisible();
    await page.screenshot({ path: `${output}/preview-${width}.png`, fullPage: true });
    await page.getByRole("link", { name: "原始记录展示" }).click();
    await expect(page.getByRole("article", { name: "原始学习记录" })).toContainText("今天对比了两种研磨粗细");
    reports.push({ width, passed: true, edits, overflow: false });
    await page.close();
  }
  expect(failures).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify({ reports, failures }, null, 2));
  console.log(JSON.stringify({ reports, failures, output }, null, 2));
} finally { await browser.close(); }
