import { expect, test } from "@playwright/test";
import { register } from "./helpers";

test("AI output stays editable and is saved only after explicit confirmation", async ({ page }) => {
  await register(page);
  let checkInWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname.startsWith("/api/checkins/")) {
      checkInWrites += 1;
    }
  });
  const jobId = "10000000-0000-4000-8000-000000000001";
  let polls = 0;
  await page.route("**/api/ai/generations**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/ai/generations" && request.method() === "POST") {
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
          },
          requestId: "e2e-ai-create",
        }),
      });
      return;
    }
    if (url.pathname === `/api/ai/generations/${jobId}` && request.method() === "GET") {
      polls += 1;
      const data = polls === 1
        ? { jobId, status: "generating", stage: "generating" }
        : {
          jobId,
          status: "succeeded",
          stage: "complete",
          result: {
            attention: "确定性 AI 标题",
            summary: "确定性 AI 知识小结",
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
  await page.getByRole("button", { name: "生成知识小结" }).click();
  await expect(page.getByText("任务已排队，马上开始读取资料")).toBeVisible();
  await expect(page.getByText("DeepSeek 正在思考并生成小结…")).toBeVisible();
  await expect(page.getByLabel("attention")).toHaveValue("确定性 AI 标题");
  await expect(page.getByText("AI 小结已生成，请审阅后手动保存")).toBeVisible();

  const summary = page.getByLabel(/学习知识点小结/);
  await summary.fill("我审阅并修改后的知识小结");
  expect(checkInWrites).toBe(0);

  const saveResponse = page.waitForResponse((response) => (
    response.request().method() === "PUT"
    && new URL(response.url()).pathname.startsWith("/api/checkins/")
  ));
  await page.getByRole("button", { name: /完成打卡/ }).click();
  const afterSave = await saveResponse;
  expect(afterSave.status()).toBe(200);
  const saved = await afterSave.json() as { data?: { summary?: string } };
  expect(saved.data?.summary).toBe("我审阅并修改后的知识小结");
  expect(checkInWrites).toBe(1);
});
