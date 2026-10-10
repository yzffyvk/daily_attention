// Isolated browser fixtures only. Every API is intercepted; no account or production writes.
import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const origin = "http://127.0.0.1:4300";
const managementOnly = process.env.KNOWLEDGE_VISUAL_MANAGEMENT_ONLY === "1";
const widths = process.env.KNOWLEDGE_VISUAL_WIDTHS ? process.env.KNOWLEDGE_VISUAL_WIDTHS.split(",").map(Number) : [1440, 390, 320];
const output = process.env.KNOWLEDGE_VISUAL_OUTPUT || "/tmp/knowledge-narratives-qa";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const failures = [];
const profile = { id: "visual-fixture", email: "visual@example.invalid", displayName: "学习者", avatarKey: 1, onboardingCompleted: true };
const dates = ["2026-08-31", "2026-09-02", "2026-09-07"];
const sources = dates.map((date, index) => ({ date, attention: ["认识检索增强生成", "理解文档切分的取舍", "用一次问答检验检索链路"][index], summary: ["先从资料中找到可靠证据，再让模型围绕证据组织答案。", "切分过细会丢失语境，切分过长又会混入噪音。", "从真实问题出发，同时检查召回内容和最终答案。"][index], inspiration: "把理解落实到一次小规模实验。", version: 1, sourceUrl: "https://example.invalid/learning", hasImage: false }));
const result = {
  title: "从找到资料，到回答问题", overview: "这三次学习围绕同一个问题逐渐展开：如何让回答有所依据？从认识检索增强生成，到理解文档切分，再到用真实问题检验，知识逐渐形成一条可实践的路径。",
  nodes: sources.map((source, index) => ({ date: source.date, label: ["先找到可靠的证据", "让内容保留合适的语境", "在真实问题中检验"][index], takeaway: source.summary })),
  connections: [{ fromDate: dates[0], toDate: dates[1], relation: "递进", explanation: "在理解检索的作用后，进一步讨论怎样准备可被检索的内容。" }, { fromDate: dates[1], toDate: dates[2], relation: "应用", explanation: "把切分的取舍带入问答实践，观察证据是否足以支持回答。" }],
  sections: [{ title: "从答案回到证据", body: "检索增强生成把回答过程拆成寻找证据和组织表达两个环节。学习重点因此从“模型会不会回答”，转向“模型依据什么回答”。\n\n这是后续讨论文档切分和效果验证的共同起点。", sourceDates: [dates[0]] }, { title: "切分是一种对语境的取舍", body: "文档切分并非把长文本机械地变短。片段需要足够聚焦，也需要保留理解当前问题所需的上下文。\n\n用真实问题检验这一取舍，可以发现片段是否完整、噪音是否过多，以及答案是否忠于证据。", sourceDates: [dates[1], dates[2]] }],
  framework: [{ title: "准备内容 → 寻找证据 → 验证回答", body: "先明确问题，再检查被召回的资料，最后判断答案能否由资料支持。三个环节可以分别观察和改进。", sourceDates: dates }],
  gaps: ["还没有形成稳定的检索评估标准，需要区分召回问题与回答问题。"], nextSteps: ["选取五个真实问题，记录每个问题的检索结果、最终答案和一条改进建议。"],
};

async function createPage(width) {
  const page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : 844 }, reducedMotion: width === 1440 ? "no-preference" : "reduce", timezoneId: "Asia/Shanghai" });
  let expectedHttpFailures = 0;
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => {
    if (message.type() !== "error") return;
    if (expectedHttpFailures > 0 && message.text().includes("503")) { expectedHttpFailures--; return; }
    failures.push(message.text());
  });
  await page.clock.setFixedTime(new Date("2026-09-10T02:00:00Z"));
  let narrative = managementOnly ? { id: "visual-narrative", title: result.title, dates, question: "如何把几次学习串成检索流程？", sources, changedDates: [dates[0]], result: structuredClone(result), status: "succeeded", error: null, createdAt: "2026-09-10T02:00:00Z", updatedAt: "2026-09-10T02:00:00Z" } : null;
  let posts = 0;
  let edits = 0;
  let copies = [];
  let copyKeys = [];
  let deleteRequests = 0;
  let generationPhase = managementOnly ? "succeeded" : "queued";
  let holdDelete = false;
  let failNextDelete = true;
  let releaseDelete;
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) { failures.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data;
    if (url.pathname === "/api/me") data = { profile };
    else if (url.pathname === "/api/checkins/stats") data = { totalCount: 3, currentStreak: 0, hasTodayRecord: false };
    else if (url.pathname === "/api/checkins") data = sources.filter(source => source.date.startsWith(url.searchParams.get("month"))).map(source => ({ ...source, updatedAt: `${source.date}T02:00:00Z` }));
    else if (url.pathname.startsWith("/api/checkins/")) data = null;
    else if (url.pathname === "/api/knowledge-narratives" && request.method() === "POST") {
      const body = request.postDataJSON();
      expect(body.dates).toEqual(dates);
      expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
      posts++;
      narrative = { id: "visual-narrative", title: result.title, dates, question: body.question, sources, changedDates: [dates[0]], result: null, status: "queued", error: null, createdAt: "2026-09-10T02:00:00Z", updatedAt: "2026-09-10T02:00:00Z" };
      data = narrative;
    } else if (url.pathname === "/api/knowledge-narratives") data = [...copies, ...(narrative ? [narrative] : [])];
    else if (url.pathname.endsWith("/copy")) {
      const original = narrative;
      const { idempotencyKey } = request.postDataJSON();
      expect(copyKeys).not.toContain(idempotencyKey); copyKeys.push(idempotencyKey);
      const count = copies.length + 1;
      const title = `${original.title} ${count === 1 ? "" : `${count} `}cp`;
      data = { ...structuredClone(original), id: `visual-copy-${count}`, title, result: { ...structuredClone(original.result), title } };
      copies.unshift(data);
    } else if (request.method() === "DELETE") {
      deleteRequests++;
      if (holdDelete) await new Promise(resolve => { releaseDelete = resolve; });
      if (failNextDelete) {
        failNextDelete = false; expectedHttpFailures++;
        return route.fulfill({ status: 503, json: { ok: false, error: { code: "TEMPORARY_ERROR", message: "删除暂时失败，请重试" }, requestId: "expected-delete-failure" } });
      }
      const id = url.pathname.split("/").at(-1);
      copies = copies.filter(copy => copy.id !== id);
      if (narrative?.id === id) narrative = null;
      data = { id };
    } else if (url.pathname.startsWith("/api/knowledge-narratives/visual-copy-")) {
      const id = url.pathname.split("/").at(-1);
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); edits++;
        copies = copies.map(copy => copy.id === id ? { ...copy, title: body.result.title, result: body.result, updatedAt: "2026-09-10T03:00:00Z" } : copy);
      }
      data = copies.find(copy => copy.id === id);
    }
    else if (url.pathname === "/api/knowledge-narratives/visual-narrative") {
      if (request.method() === "PATCH") {
        const body = request.postDataJSON(); edits++;
        expect(body.expectedUpdatedAt).toBe(narrative.updatedAt);
        expect(body.result.nodes.map(node => node.date)).toEqual(dates);
        expect(body.result.sections.map(section => section.sourceDates)).toEqual(result.sections.map(section => section.sourceDates));
        narrative = { ...narrative, title: body.result.title, result: body.result, updatedAt: "2026-09-10T03:00:00Z" };
      } else narrative = { ...narrative, status: generationPhase, result: generationPhase === "succeeded" ? narrative.result ?? result : null };
      data = narrative;
    } else { failures.push(`Unhandled fixture request: ${url.pathname}`); return route.abort(); }
    return route.fulfill({ status: request.method() === "POST" ? url.pathname.endsWith("/copy") ? 201 : 202 : 200, json: { ok: true, data, requestId: "isolated-knowledge-qa" } });
  });
  await page.goto(`${origin}/?fixture=1`, { waitUntil: "networkidle" });
  const draft = page.getByRole("textbox", { name: "今日知识主题", exact: true });
  await expect(draft).toBeEnabled();
  await draft.fill("离开知识脉络后，这段草稿仍然在");
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await expect(page.locator(".workspace-grid")).toBeHidden();
  if (!managementOnly) {
  await expect(page.getByText("还没有知识脉络", { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(output, `empty-library-${width}.png`), fullPage: true });
  await page.getByRole("button", { name: "新增串联知识", exact: true }).click();
  await expect(page.getByRole("button", { name: "9月1日，暂无记录" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "生成知识脉络" })).toBeDisabled();
  await page.getByRole("button", { name: /9月2日，已保存/ }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: /9月7日，已保存/ }).click();
  await page.getByRole("button", { name: "上个月", exact: true }).click();
  await page.getByRole("button", { name: /8月31日，已保存/ }).click();
  await expect(page.getByLabel("已选日期").getByRole("button")).toHaveCount(3);
  await page.getByLabel("想探索的问题（可选）").fill("如何把几次零散的学习，转化为一条可以实践的检索流程？");
  await page.screenshot({ path: path.join(output, `selection-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "生成知识脉络" }).click();
  await expect(page.getByRole("heading", { name: "等待生成" })).toBeVisible();
  const animation = page.getByRole("region", { name: "知识星图生成中" });
  await expect(animation).toBeFocused();
  await expect.poll(() => animation.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 12 && rect.bottom <= innerHeight - 12 && Math.abs(rect.top + rect.height / 2 - innerHeight / 2) < 90;
  })).toBe(true).catch(async error => {
    await page.screenshot({ path: path.join(output, `generation-centering-failure-${width}.png`), fullPage: true });
    console.error(await animation.evaluate(element => ({ rect: element.getBoundingClientRect().toJSON(), scrollY, pageHeight: document.documentElement.scrollHeight, viewport: innerHeight })));
    throw error;
  });
  await page.screenshot({ path: path.join(output, `generation-centered-${width}.png`) });
  await page.screenshot({ path: path.join(output, `queued-${width}.png`), fullPage: true });
  // A user's subsequent scroll must not be overridden by status polling.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  generationPhase = "generating";
  await expect(page.getByRole("heading", { name: "正在生成", exact: true })).toBeVisible({ timeout: 6000 });
  expect(await page.evaluate(() => scrollY)).toBeLessThan(2);
  generationPhase = "succeeded";
  await expect(page.getByRole("article", { name: "叙事长卷" })).toBeVisible({ timeout: 12000 });
  await expect(page.getByText("在理解检索的作用后，进一步讨论怎样准备可被检索的内容。")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, `narrative-${width}.png`), fullPage: true });
  const citation = page.getByRole("button", { name: "查看来源 2026-08-31" }).first();
  await citation.focus(); await page.keyboard.press("Enter");
  const snapshot = page.getByRole("region", { name: "来源快照 2026-08-31" });
  await expect(snapshot).toBeVisible(); await expect(snapshot).toBeFocused();
  await expect(snapshot).toContainText("先从资料中找到可靠证据");
  await page.screenshot({ path: path.join(output, `source-${width}.png`), fullPage: true });
  } else {
    await page.getByRole("button", { name: `打开知识脉络 ${result.title}，已保存`, exact: true }).click();
    await expect(page.getByRole("article", { name: "叙事长卷" })).toBeVisible();
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await expect(page.getByRole("form", { name: "编辑知识脉络" })).toBeVisible();
  await page.getByLabel("总览", { exact: true }).fill("我的新理解：先找到证据，再组织答案。");
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByRole("region", { name: "已保存的脉络" })).toBeVisible();
  await page.getByRole("button", { name: `编辑 ${result.title}`, exact: true }).click();
  await page.getByLabel("总览", { exact: true }).fill("我的新理解：先找到证据，再组织答案。");
  await page.getByRole("button", { name: "开始今日打卡", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "放弃未保存的修改？" })).toBeVisible();
  await expect(page.getByRole("button", { name: "继续编辑", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByLabel("总览", { exact: true })).toHaveValue("我的新理解：先找到证据，再组织答案。");
  await page.getByRole("button", { name: "返回脉络列表", exact: true }).click();
  await page.screenshot({ path: path.join(output, `unsaved-${width}.png`) });
  await page.getByRole("button", { name: "继续编辑", exact: true }).click();
  await page.getByLabel("脉络名称").fill("我的检索实践地图");
  await expect.poll(() => page.getByLabel("脉络名称").evaluate(input => {
    const field = input.getBoundingClientRect();
    const toolbar = document.querySelector(".narrative-editor-footer").getBoundingClientRect();
    return field.top >= 0 && field.bottom <= toolbar.top;
  })).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(output, `editor-${width}.png`), fullPage: true });
  await page.screenshot({ path: path.join(output, `editor-viewport-${width}.png`) });
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByRole("heading", { name: "我的检索实践地图" })).toBeVisible();
  await expect(page.getByText("我的新理解：先找到证据，再组织答案。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回脉络列表", exact: true }).click();
  await page.getByRole("button", { name: "复制 我的检索实践地图", exact: true }).click();
  await expect(page.getByRole("button", { name: /打开知识脉络 我的检索实践地图 cp/ })).toBeVisible();
  await page.getByRole("button", { name: "复制 我的检索实践地图", exact: true }).click();
  await expect(page.getByRole("button", { name: /打开知识脉络 我的检索实践地图 2 cp/ })).toBeVisible();
  await page.screenshot({ path: path.join(output, `library-${width}.png`), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "编辑 我的检索实践地图 cp", exact: true }).click();
  await page.getByLabel("总览", { exact: true }).fill("这个改动只属于副本。");
  await page.getByRole("button", { name: "保存修改" }).click();
  await expect(page.getByText("这个改动只属于副本。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回脉络列表", exact: true }).click();
  await page.getByRole("button", { name: "打开知识脉络 我的检索实践地图，已保存", exact: true }).click();
  await expect(page.getByText("我的新理解：先找到证据，再组织答案。", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "返回脉络列表", exact: true }).click();
  await page.getByRole("button", { name: "删除 我的检索实践地图 2 cp", exact: true }).click();
  const deletion = page.getByRole("dialog", { name: "删除知识脉络？" });
  await expect(deletion).toContainText("删除后不可恢复");
  await expect(deletion.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(deletion.getByRole("button", { name: "确认删除", exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(output, `delete-${width}.png`) });
  await page.keyboard.press("Escape");
  expect(deleteRequests).toBe(0);
  await expect(page.getByRole("button", { name: "删除 我的检索实践地图 2 cp", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  holdDelete = true;
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("button", { name: "正在删除…", exact: true })).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(deletion).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(deletion).toBeVisible();
  await page.screenshot({ path: path.join(output, `delete-pending-${width}.png`) });
  releaseDelete();
  await expect(deletion.getByRole("alert")).toContainText("删除暂时失败，请重试");
  await expect(deletion.getByRole("button", { name: "取消", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(deletion.getByRole("button", { name: "确认删除", exact: true })).toBeFocused();
  await page.screenshot({ path: path.join(output, `delete-retry-${width}.png`) });
  holdDelete = false;
  await page.getByRole("button", { name: "确认删除", exact: true }).click();
  await expect(page.getByRole("button", { name: /打开知识脉络 我的检索实践地图 2 cp/ })).toHaveCount(0);
  expect(deleteRequests).toBe(2);
  await page.getByRole("button", { name: "返回学习记录" }).click();
  await expect(draft).toHaveValue("离开知识脉络后，这段草稿仍然在");
  await page.reload();
  await page.getByRole("button", { name: "串联知识", exact: true }).click();
  await page.getByRole("button", { name: "打开知识脉络 我的检索实践地图，已保存", exact: true }).click();
  await expect(page.getByRole("article", { name: "叙事长卷" })).toBeVisible();
  expect(posts).toBe(managementOnly ? 0 : 1);
  expect(edits).toBe(2);
  expect(copyKeys).toHaveLength(2);
  await page.close();
}

try {
  for (const width of widths) await createPage(width);
  expect(failures).toEqual([]);
  await writeFile(path.join(output, managementOnly ? "management-verification.json" : "verification.json"), JSON.stringify({ passed: true, widths, managementOnly, failures }, null, 2));
  console.log(`Knowledge narratives visual and interaction checks passed: ${output}`);
} finally { await browser.close(); }
