import { expect, test } from "@playwright/test";
import { register } from "./helpers";
import { serializeQuestionSummary } from "../../lib/domain/knowledge-questions";
import { questionSummaryFixture } from "../helpers/knowledge-questions-fixture";

test("AI output stays editable and is saved only after explicit confirmation", async ({ page }) => {
  await register(page);
  let checkInWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.startsWith("/api/checkins/")) {
      checkInWrites += 1;
    }
  });
  const jobId = "10000000-0000-4000-8000-000000000001";
  const questionResult = questionSummaryFixture();
  const generationContext = { userPrompt: "我已有基础，请重点解释边界与适用条件。", promptVersion: "knowledge-skeleton-user-prompt-v1" };
  let polls = 0;
  await page.route("**/api/ai/generations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/generations" && request.method() === "POST") {
      expect(request.postDataJSON().userPrompt).toBe(generationContext.userPrompt);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            jobId,
            status: "queued",
            pollAfterMs: 500,
            quota: { used: 1, reserved: 1, consumed: 0, limit: 5, remaining: 4 },
            generationContext,
          },
          requestId: "e2e-ai-create",
        }),
      });
      return;
    }
    if (url.pathname === `/api/ai/generations/${jobId}` && request.method() === "GET") {
      polls += 1;
      const data = polls <= 2
        ? { jobId, status: "generating", stage: "generating", attemptCount: 1, progress: { phase: "writing", preview: polls === 1 ? "第一段正在生成" : "第一段正在生成\n第二段接着出现", updatedAt: new Date().toISOString() } }
        : polls === 3
          ? { jobId, status: "generating", stage: "generating", attemptCount: 1, progress: { phase: "validating", preview: "待校验的正文", updatedAt: new Date().toISOString() } }
        : polls === 4
          ? { jobId, status: "generating", stage: "generating", attemptCount: 1, progress: { phase: "repairing", preview: "正在修正的正文", updatedAt: new Date().toISOString() } }
        : polls === 5
          ? { jobId, status: "retryable", stage: "retrying", attemptCount: 1, retryMessage: "上一轮内容未通过校验，正在重新生成。" }
        : polls === 6
          ? { jobId, status: "generating", stage: "generating", attemptCount: 2, progress: { phase: "writing", preview: "新一轮正文", updatedAt: new Date().toISOString() } }
        : {
          jobId,
          status: "succeeded",
          stage: "complete",
          generationContext,
          result: {
            attention: "确定性 AI 标题",
            summary: serializeQuestionSummary(questionResult),
            inspiration: "继续补充自己的理解",
            sourceTitle: "E2E 公开资料",
            warnings: [],
          },
        };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, data, requestId: `e2e-ai-poll-${polls}` }),
      });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("button", { name: "AI 提炼", exact: true }).click();
  await page.getByLabel(/学习资料来源/).fill("https://example.com/public-learning-article");
  await page.getByRole("button", { name: /提炼要求/ }).click();
  const requirements = page.getByRole("textbox", { name: "提炼要求", exact: true });
  await requirements.fill(generationContext.userPrompt);
  await page.getByRole("button", { name: "生成知识小结" }).click();
  await expect(requirements).toBeDisabled();
  await expect(page.getByText("已排队，等待开始")).toBeVisible();
  const preview = page.getByRole("region", { name: "正在生成的知识小结" });
  await expect(preview).toContainText("第一段正在生成");
  expect(checkInWrites).toBe(0);
  await expect(page.getByRole("textbox", { name: "今日知识主题", exact: true })).toHaveValue("");
  await expect(preview).toContainText("第二段接着出现");
  await expect(page.getByText(/需要修正时会继续生成/)).toBeVisible();
  await expect(page.getByText(/修正时会重新输出正文/)).toBeVisible();
  await expect(page.getByText(/准备第 2 轮尝试/)).toBeVisible();
  await expect(preview).toHaveCount(0);
  await expect(page.getByText(/^第 2 轮尝试。上一轮内容未通过校验/)).toBeVisible({ timeout: 8000 });
  await expect(preview).toContainText("新一轮正文");
  await expect(page.getByRole("heading", { name: "确定性 AI 标题", exact: true })).toBeVisible();
  const successBanner = page.getByRole("status", { name: "AI 提炼成功" });
  await expect(successBanner).toContainText("AI 提炼成功，请审阅后保存。");
  await expect(page.locator(".light-toast")).toContainText("AI 提炼成功，请审阅后保存。");
  await expect(preview).toHaveCount(0);

  await expect(page.getByRole("heading", { name: questionResult.thesis, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "展开核心部分：明确行动", exact: true })).toBeVisible();
  await expect(page.locator(".question-direct-answer")).toHaveCount(0);
  await expect(page.getByRole("group", { name: "骨架节点" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "节点解释" })).toHaveCount(0);
  await page.getByRole("button", { name: "展开核心部分：验证行动", exact: true }).click();
  await expect(page.locator(".question-direct-answer")).toHaveText(questionResult.structure.questions[1].answer);
  await expect(page.getByText(questionResult.structure.questions[1].title, { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "查看简图", exact: true }).click();
  await expect(page.getByRole("button", { name: "查看关系：检查 → 计划（验证并改进）", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "计划", exact: true }).click();
  await expect(page.getByRole("region", { name: "节点解释" })).toContainText("列出下一步行动。");
  await expect(page.getByText("它属于什么", { exact: true })).toHaveCount(0);
  await expect(page.getByText("与其他问题的联系", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "收起详情", exact: true }).click();
  await page.getByRole("button", { name: "编辑总结", exact: true }).click();
  const summary = page.getByRole("textbox", { name: "知识小结", exact: true });
  await summary.fill("我审阅并修改后的知识小结");
  await requirements.fill("下次请面向初学者解释。");
  await expect(page.getByText(/修改后重新提炼生效/)).toBeVisible();
  expect(checkInWrites).toBe(0);

  const saveResponse = page.waitForResponse((response) => (
    response.request().method() === "PUT"
    && new URL(response.url()).pathname.startsWith("/api/checkins/")
  ));
  await page.getByRole("button", { name: /完成打卡/ }).click();
  const afterSave = await saveResponse;
  expect(afterSave.status()).toBe(200);
  const saved = await afterSave.json() as { data?: { summary?: string; userPrompt?: string; aiGenerationContext?: typeof generationContext } };
  expect(saved.data?.summary).toBe("我审阅并修改后的知识小结");
  expect(saved.data?.userPrompt).toBe("下次请面向初学者解释。");
  expect(saved.data?.aiGenerationContext).toEqual(generationContext);
  expect(checkInWrites).toBe(1);
  await expect(successBanner).toContainText("AI 提炼成功，内容已保存。");
  await page.reload();
  // Reopen the saved day explicitly, including when the run crosses midnight.
  await page.getByRole("button", { name: /已保存：确定性 AI 标题/ }).click();
  await page.getByRole("button", { name: "AI 提炼", exact: true }).click();
  await expect(requirements).toHaveValue("下次请面向初学者解释。");
  await page.locator(".ai-prompt-history summary").click();
  await expect(page.locator(".ai-prompt-history")).toContainText(generationContext.userPrompt);
});

test("two free cancellations preserve the draft and the third requires quota confirmation", async ({ page }) => {
  await register(page);
  let creates = 0;
  let freeRemaining = 2;
  let jobId = "";
  let polls = 0;
  let checkInWrites = 0;
  const cancelConsents: boolean[] = [];
  const quota = (cancelled = false, charged = false) => ({ used: cancelled && !charged ? 0 : 1, reserved: cancelled ? 0 : 1, consumed: cancelled && charged ? 1 : 0, limit: 5, remaining: cancelled && !charged ? 5 : 4 });
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.startsWith("/api/checkins/")) checkInWrites += 1;
  });
  await page.route("**/api/ai/generations**", async (route) => {
    const request = route.request();
    if (request.method() === "POST") {
      creates += 1;
      jobId = `10000000-0000-4000-8000-${String(creates).padStart(12, "0")}`;
      return route.fulfill({ json: { ok: true, requestId: "cancel-create", data: { jobId, status: "queued", pollAfterMs: 50, quota: quota() } } });
    }
    if (request.method() === "DELETE") {
      const confirmed = request.postDataJSON().confirmQuotaConsumption === true;
      cancelConsents.push(confirmed);
      const charged = freeRemaining === 0;
      if (charged && !confirmed) return route.fulfill({ status: 409, json: { ok: false, requestId: "cancel-confirmation", error: { code: "CANCELLATION_CONFIRMATION_REQUIRED", message: "取消需要确认额度" } } });
      if (!charged) freeRemaining -= 1;
      // Hold the response long enough to verify the disabled state and duplicate-click guard.
      await new Promise((resolve) => setTimeout(resolve, 350));
      return route.fulfill({ json: { ok: true, requestId: "cancel-complete", data: { jobId, status: "cancelled", stage: "complete", quota: quota(true, charged), cancellation: { freeRemaining, requiresConfirmation: false, charged } } } });
    }
    polls += 1;
    return route.fulfill({ json: { ok: true, requestId: "cancel-poll", data: { jobId, status: "generating", stage: "generating", attemptCount: 1, quota: quota(), progress: { phase: "writing", preview: `第 ${creates} 轮未完成预览`, updatedAt: new Date().toISOString() }, cancellation: { freeRemaining, requiresConfirmation: freeRemaining === 0, charged: null } } } });
  });
  await page.getByRole("group", { name: "选择打卡方式" }).getByRole("button", { name: /AI 提炼/ }).click();
  await page.getByLabel(/学习资料来源/).fill("https://example.com/cancellation-fixture");
  await page.getByRole("button", { name: "编辑总结", exact: true }).click();
  await page.getByRole("textbox", { name: "今日知识主题", exact: true }).fill("此前未保存的主题");
  await page.getByRole("textbox", { name: "知识小结", exact: true }).fill("此前审阅过的小结");
  await page.locator("#inspiration").fill("个人理解要保留");
  await page.getByRole("button", { name: "完成编辑", exact: true }).click();
  const preview = page.getByRole("region", { name: "正在生成的知识小结" });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
    await expect(preview).toContainText(`第 ${attempt} 轮未完成预览`);
    await page.getByRole("button", { name: "取消任务", exact: true }).click();
    await expect(page.getByRole("button", { name: "正在取消任务…" })).toBeDisabled();
    await expect(preview).toHaveCount(0);
    await expect(page.getByText(/任务已取消.*额度已退回/)).toContainText(`今日免费取消剩余 ${2 - attempt} 次`);
    await expect(page.getByText("今日共享额度剩余 5 次", { exact: true })).toBeVisible();
    await expect(page.getByText("此前审阅过的小结", { exact: true })).toBeVisible();
    await expect(page.locator("#inspiration")).toHaveValue("个人理解要保留");
  }
  expect(cancelConsents).toEqual([false, false]);
  await page.getByRole("button", { name: "生成知识小结", exact: true }).click();
  await expect(preview).toContainText("第 3 轮未完成预览");
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "取消将消耗 1 次额度" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "继续生成", exact: true })).toBeFocused();
  expect(cancelConsents).toEqual([false, false]);
  const pollsBeforeContinue = polls;
  await dialog.getByRole("button", { name: "继续生成", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toContainText("第 3 轮未完成预览");
  await expect.poll(() => polls).toBeGreaterThan(pollsBeforeContinue);
  await page.getByRole("button", { name: "取消任务", exact: true }).click();
  await dialog.getByRole("button", { name: "确认取消并消耗 1 次额度" }).click();
  await expect(dialog.getByRole("button", { name: "正在取消…" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "正在取消任务…" })).toBeDisabled();
  await expect(dialog).toHaveCount(0);
  await expect(preview).toHaveCount(0);
  await expect(page.getByText(/任务已取消.*保留扣除 1 次额度/)).toBeVisible();
  await expect(page.getByText("今日共享额度剩余 4 次", { exact: true })).toBeVisible();
  expect(cancelConsents).toEqual([false, false, true]);
  await expect(page.getByText("此前审阅过的小结", { exact: true })).toBeVisible();
  await expect(page.locator("#inspiration")).toHaveValue("个人理解要保留");
  expect(checkInWrites).toBe(0);
});
