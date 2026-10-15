import { expect, test, type Page } from "@playwright/test";
import { register } from "./helpers";
import { serializeQuestionSummary } from "../../lib/domain/knowledge-questions";
import { questionSummaryFixture } from "../helpers/knowledge-questions-fixture";
import type { LearningRecord } from "../../lib/domain/learning-record";

// These scenarios exercise the browser against the record contract. SQL tests
// independently verify ownership, atomic completion and actual persistence.
async function recordBackend(page: Page) {
  const records = new Map<string, LearningRecord>();
  const saves: string[] = [];
  await page.route("**/api/records**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const id = url.pathname.split("/")[3];
    const reply = (data: unknown) => route.fulfill({ json: { ok: true, data, requestId: "records-e2e" } });
    if (request.method() === "GET") {
      if (id) return reply(records.get(id));
      return reply({ records: [...records.values()].filter(record =>
        (!url.searchParams.has("date") || record.date === url.searchParams.get("date")) &&
        (!url.searchParams.has("sourceUrl") || record.sourceUrl === url.searchParams.get("sourceUrl")) &&
        (!url.searchParams.has("pending") || record.status === "pending" || record.aiCandidate !== null)), nextCursor: null });
    }
    const input = request.postDataJSON() as Partial<LearningRecord> & { id: string; candidateJobId?: string };
    if (request.method() === "POST" && !id) {
      const record: LearningRecord = {
        id: input.id, date: input.date!, entryMode: input.entryMode ?? "manual",
        attention: input.attention || new URL(input.sourceUrl!).hostname,
        sourceUrl: input.sourceUrl ?? "", summary: input.summary ?? "", inspiration: input.inspiration ?? "",
        userPrompt: input.userPrompt ?? "", aiGenerationContext: null,
        imagePath: null, imageName: "", imageUrl: null, version: 1,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        albumId: null, status: input.status ?? "pending", completedAt: null,
        aiCandidate: null, activeAiJobId: null, aiStatus: null, aiError: null,
      };
      records.set(record.id, record);
      return reply(record);
    }
    if (request.method() === "PATCH" && id) {
      const current = records.get(id)!;
      expect(input.version).toBe(current.version);
      const candidate = input.candidateJobId ? current.aiCandidate : null;
      if (input.candidateJobId) {
        expect(candidate?.jobId).toBe(input.candidateJobId);
        expect(candidate?.baseVersion).toBe(current.version);
        expect(["pending", "completed"]).toContain(input.status);
        saves.push(id);
      }
      const saved: LearningRecord = {
        ...current, ...input,
        ...(candidate ? { aiCandidate: null, aiGenerationContext: candidate.generationContext } : {}),
        version: current.version + 1, updatedAt: new Date().toISOString(),
        completedAt: input.status === "completed" ? new Date().toISOString() : current.completedAt,
      };
      records.set(id, saved);
      return reply(saved);
    }
    return route.fallback();
  });
  return { records, saves };
}

async function createAiDraft(page: Page, title: string, sourceUrl: string) {
  await page.getByRole("button", { name: "新增记录", exact: true }).first().click();
  await expect(page.getByRole("dialog", { name: "新增学习记录" })).toHaveCount(0);
  await page.getByRole("button", { name: "AI 提炼", exact: true }).click();
  await page.getByLabel("资料链接", { exact: true }).fill(sourceUrl);
  await page.getByLabel("学习主题", { exact: true }).fill(title);
  await expect(page.getByRole("button", { name: "AI 提炼", exact: true })).toHaveAttribute("aria-pressed", "true");
}

test("AI output opens directly, survives refresh and uses the ordinary draft and confirm actions", async ({ page }) => {
  const backend = await recordBackend(page);
  await register(page);
  const jobId = "10000000-0000-4000-8000-000000000001";
  const questionResult = questionSummaryFixture();
  const generationContext = { userPrompt: "我已有基础，请重点解释边界与适用条件。", promptVersion: "knowledge-questions-v1" };
  const result = { attention: "确定性 AI 标题", summary: serializeQuestionSummary(questionResult), inspiration: "AI 建议不覆盖个人理解", sourceTitle: "E2E 公开资料", warnings: [] };
  let recordId = "";
  let polls = 0;
  await page.route("**/api/ai/generations**", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      const input = request.postDataJSON();
      recordId = input.recordId;
      const record = backend.records.get(recordId)!;
      expect(record.sourceUrl).toBe(input.sourceUrl);
      expect(record.userPrompt).toBe(generationContext.userPrompt);
      expect(record.entryMode).toBe("ai");
      record.activeAiJobId = jobId;
      record.aiStatus = "queued";
      return route.fulfill({ status: 202, json: { ok: true, requestId: "ai-create", data: {
        jobId, recordId, baseVersion: record.version, status: "queued", pollAfterMs: 500,
        quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 }, generationContext,
      } } });
    }
    polls += 1;
    const record = backend.records.get(recordId)!;
    if (polls < 3) return route.fulfill({ json: { ok: true, requestId: "ai-progress", data: {
      jobId, recordId, status: "generating", stage: "generating", attemptCount: 1,
      progress: { phase: polls === 1 ? "writing" : "validating", preview: "正在生成的正文", updatedAt: new Date().toISOString() },
    } } });
    record.activeAiJobId = null;
    record.aiStatus = "succeeded";
    record.aiCandidate = { jobId, sourceUrl: record.sourceUrl, userPrompt: generationContext.userPrompt,
      baseVersion: record.version, generationContext, result, createdAt: new Date().toISOString() };
    return route.fulfill({ json: { ok: true, requestId: "ai-success", data: { jobId, recordId, status: "succeeded", stage: "complete", result, generationContext } } });
  });

  await createAiDraft(page, "阅读中的资料", "https://example.com/public-learning-article");
  await page.getByRole("button", { name: /提炼要求/ }).click();
  await page.getByRole("textbox", { name: "提炼要求", exact: true }).fill(generationContext.userPrompt);
  await page.locator("#inspiration").fill("这是我自己的理解");
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(page.getByRole("region", { name: "正在生成的知识小结" })).toContainText("正在生成的正文");
  await expect(page.getByRole("heading", { name: questionResult.thesis, exact: true })).toBeVisible();
  expect(backend.records.get(recordId)?.status).toBe("pending");
  expect(backend.records.get(recordId)?.summary).toBe("");
  expect(backend.saves).toEqual([]);

  await page.reload();
  await page.getByRole("button", { name: "打开记录 阅读中的资料", exact: true }).click();
  await expect(page.getByRole("heading", { name: questionResult.thesis, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "审阅新结果", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: questionResult.thesis, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "展开核心部分：验证行动", exact: true }).click();
  await expect(page.locator(".question-direct-answer")).toHaveText(questionResult.structure.questions[1].answer);
  await page.getByRole("button", { name: "查看简图", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看关系：检查 → 计划（验证并改进）", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "计划", exact: true }).click();
  await expect(page.getByRole("region", { name: "节点解释" })).toContainText("列出下一步行动。");
  await page.getByRole("button", { name: "收起详情", exact: true }).click();
  await page.getByRole("button", { name: "编辑小结", exact: true }).click();
  await page.locator("#summary").fill("我修改后的知识小结");
  await expect(page.locator("#inspiration")).toHaveValue("这是我自己的理解");
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expect.poll(() => backend.saves).toEqual([recordId]);
  expect(backend.records.get(recordId)).toMatchObject({ status: "pending", summary: "我修改后的知识小结", aiGenerationContext: generationContext, aiCandidate: null });
  await page.reload();
  await page.getByRole("button", { name: "打开记录 确定性 AI 标题", exact: true }).click();
  await expect(page.getByText("我修改后的知识小结", { exact: true }).last()).toBeVisible();
  await expect(page.locator("#inspiration")).toHaveValue("这是我自己的理解");
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => backend.records.get(recordId)?.status).toBe("completed");

});

test("two free cancellations preserve the saved record and a third requires quota confirmation", async ({ page }) => {
  const backend = await recordBackend(page);
  await register(page);
  let creates = 0;
  let freeRemaining = 2;
  let jobId = "";
  let recordId = "";
  const cancelConsents: boolean[] = [];
  const quota = (cancelled = false, charged = false) => ({ used: cancelled && !charged ? 0 : 1, reserved: cancelled ? 0 : 1, consumed: cancelled && charged ? 1 : 0, limit: 5, remaining: cancelled && !charged ? 5 : 4 });
  await page.route("**/api/ai/generations**", async route => {
    const request = route.request();
    if (request.method() === "POST") {
      creates += 1;
      jobId = `10000000-0000-4000-8000-${String(creates).padStart(12, "0")}`;
      recordId = request.postDataJSON().recordId;
      Object.assign(backend.records.get(recordId)!, { activeAiJobId: jobId, aiStatus: "queued" });
      return route.fulfill({ status: 202, json: { ok: true, requestId: "cancel-create", data: { jobId, recordId, status: "queued", pollAfterMs: 50, quota: quota() } } });
    }
    if (request.method() === "DELETE") {
      const confirmed = request.postDataJSON().confirmQuotaConsumption === true;
      cancelConsents.push(confirmed);
      const charged = freeRemaining === 0;
      if (charged && !confirmed) return route.fulfill({ status: 409, json: { ok: false, requestId: "cancel-confirmation", error: { code: "CANCELLATION_CONFIRMATION_REQUIRED", message: "取消需要确认额度" } } });
      if (!charged) freeRemaining -= 1;
      await new Promise(resolve => setTimeout(resolve, 350));
      Object.assign(backend.records.get(recordId)!, { activeAiJobId: null, aiStatus: "cancelled" });
      return route.fulfill({ json: { ok: true, requestId: "cancel-complete", data: { jobId, recordId, status: "cancelled", stage: "complete", quota: quota(true, charged), cancellation: { freeRemaining, requiresConfirmation: false, charged } } } });
    }
    return route.fulfill({ json: { ok: true, requestId: "cancel-poll", data: { jobId, recordId, status: "generating", stage: "generating", attemptCount: 1, quota: quota(), progress: { phase: "writing", preview: `第 ${creates} 轮未完成预览`, updatedAt: new Date().toISOString() }, cancellation: { freeRemaining, requiresConfirmation: freeRemaining === 0, charged: null } } } });
  });
  await createAiDraft(page, "已有知识主题", "https://example.com/cancellation-fixture");
  await page.locator("#summary").fill("此前审阅过的小结");
  await page.locator("#inspiration").fill("个人理解要保留");
  const preview = page.getByRole("region", { name: "正在生成的知识小结" });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByRole("button", { name: /^(生成知识小结|重新提炼)$/ }).click();
    await expect(preview).toContainText(`第 ${attempt} 轮未完成预览`);
    await page.getByRole("button", { name: "取消任务", exact: true }).click();
    await expect(page.getByRole("button", { name: "正在取消…", exact: true })).toBeDisabled();
    await expect(page.getByText(/任务已取消.*额度已退回/)).toContainText(`今日免费取消剩余 ${2 - attempt} 次`);
    await expect(page.getByText("今日共享额度剩余 5 次", { exact: true })).toBeVisible();
    await expect(page.locator("#inspiration")).toHaveValue("个人理解要保留");
    expect(backend.records.get(recordId)?.summary).toBe("此前审阅过的小结");
  }
  expect(cancelConsents).toEqual([false, false]);
  await page.getByRole("button", { name: "重新提炼", exact: true }).click();
  await expect(preview).toContainText("第 3 轮未完成预览");
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "取消将消耗 1 次额度" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "继续生成", exact: true })).toBeFocused();
  expect(cancelConsents).toEqual([false, false]);
  await dialog.getByRole("button", { name: "继续生成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toContainText("第 3 轮未完成预览");
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await dialog.getByRole("button", { name: "确认取消并消耗 1 次额度" }).click();
  await expect(dialog.getByRole("button", { name: "正在取消…", exact: true })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(page.getByText(/任务已取消.*保留扣除 1 次额度/)).toBeVisible();
  await expect(page.getByText("今日共享额度剩余 4 次", { exact: true })).toBeVisible();
  expect(cancelConsents).toEqual([false, false, true]);
  expect(backend.records.get(recordId)?.summary).toBe("此前审阅过的小结");
  expect(backend.saves).toEqual([]);
  await page.reload();
  await page.getByRole("button", { name: "打开记录 已有知识主题", exact: true }).click();
  await expect(page.locator("#inspiration")).toHaveValue("个人理解要保留");
});
