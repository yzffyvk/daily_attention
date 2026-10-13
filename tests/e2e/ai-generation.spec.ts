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

  await page.getByRole("button", { name: /AI 提炼/ }).click();
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
  await expect(page.getByText("AI 小结已生成，请审阅后手动保存")).toBeVisible();
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
  await page.reload();
  // Reopen the saved day explicitly, including when the run crosses midnight.
  await page.getByRole("button", { name: /已保存：确定性 AI 标题/ }).click();
  await page.getByRole("button", { name: /AI 提炼/ }).click();
  await expect(requirements).toHaveValue("下次请面向初学者解释。");
  await page.locator(".ai-prompt-history summary").click();
  await expect(page.locator(".ai-prompt-history")).toContainText(generationContext.userPrompt);
});
