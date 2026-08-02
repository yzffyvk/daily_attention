import { describe, expect, it, vi } from "vitest";
import {
  createDeepSeekProvider,
  DeepSeekProviderError,
} from "@/supabase/functions/_shared/ai/deepseek";

const anonymousUserId = "ab".repeat(32);
const sourceText = "注意力机制通过查询、键和值计算相关性。".repeat(20);

function successResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "completion-1",
    model: "deepseek-v4-pro-20260801",
    system_fingerprint: "fp-1",
    choices: [{
      finish_reason: "stop",
      message: {
        content: JSON.stringify({
          attention: "理解注意力机制",
          summary: "结构化知识小结",
          inspiration: "继续比较不同架构",
          sourceTitle: "示例资料",
          warnings: ["资料可能不完整"],
        }),
        reasoning_content: "private chain of thought",
      },
    }],
    usage: {
      prompt_tokens: 100,
      prompt_cache_hit_tokens: 20,
      prompt_cache_miss_tokens: 80,
      completion_tokens: 50,
      completion_tokens_details: { reasoning_tokens: 10 },
    },
    ...overrides,
  };
}

function providerFor(response: Response) {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  return {
    provider: createDeepSeekProvider({ apiKey: "deepseek-test-api-key", fetchImpl }),
    fetchImpl,
  };
}

describe("DeepSeek V4 Pro provider", () => {
  it("sends the fixed thinking request and maps only validated output", async () => {
    const { provider, fetchImpl } = providerFor(new Response(
      JSON.stringify(successResponse()),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ));

    const generated = await provider.generate({
      sourceTitle: "示例资料",
      sourceText,
      anonymousUserId,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    const request = JSON.parse(init.body as string);
    expect(request).toMatchObject({
      model: "deepseek-v4-pro",
      thinking: { type: "enabled" },
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      max_tokens: 8192,
      stream: false,
      user_id: anonymousUserId,
    });
    expect(request).not.toHaveProperty("temperature");
    expect(request).not.toHaveProperty("top_p");
    expect(request).not.toHaveProperty("presence_penalty");
    expect(request).not.toHaveProperty("frequency_penalty");
    expect(request).not.toHaveProperty("user");
    expect(request.messages[0].content).toContain("不可信数据");
    expect(request.messages[0].content).toContain("JSON");
    expect(request.messages[1].content).toContain(sourceText);
    expect(JSON.stringify(request)).not.toContain("user@example.com");
    expect(JSON.stringify(request)).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(JSON.stringify(request)).not.toContain("https://example.com");

    expect(generated).toEqual({
      result: {
        attention: "理解注意力机制",
        summary: "结构化知识小结",
        inspiration: "继续比较不同架构",
        sourceTitle: "示例资料",
        warnings: ["资料可能不完整"],
      },
      usage: {
        promptTokens: 100,
        promptCacheHitTokens: 20,
        promptCacheMissTokens: 80,
        completionTokens: 50,
        reasoningTokens: 10,
      },
      providerCallCount: 1,
      model: "deepseek-v4-pro-20260801",
      systemFingerprint: "fp-1",
    });
    expect(JSON.stringify(generated)).not.toContain("private chain of thought");
    expect(generated).not.toHaveProperty("reasoning_content");
  });

  it.each([
    ["empty content", { choices: [{ finish_reason: "stop", message: { content: "" } }] }, "MODEL_OUTPUT_INVALID", true],
    ["truncated output", { choices: [{ finish_reason: "length", message: { content: "{}" } }] }, "MODEL_OUTPUT_INVALID", true],
    ["content filter", { choices: [{ finish_reason: "content_filter", message: { content: "" } }] }, "CONTENT_BLOCKED", false],
    ["insufficient resources", { choices: [{ finish_reason: "insufficient_system_resource", message: { content: "" } }] }, "MODEL_SERVICE_ERROR", true],
  ] as const)("maps %s", async (_label, overrides, code, retryable) => {
    const { provider } = providerFor(new Response(
      JSON.stringify(successResponse(overrides)),
      { status: 200 },
    ));

    const failure = await provider.generate({
      sourceTitle: "资料",
      sourceText,
      anonymousUserId,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeepSeekProviderError);
    expect(failure).toMatchObject({ code, retryable });
  });

  it.each([
    [429, {}, "MODEL_RATE_LIMITED"],
    [500, {}, "MODEL_SERVICE_ERROR"],
    [400, { error: { code: "insufficient_system_resource" } }, "MODEL_SERVICE_ERROR"],
  ] as const)("maps HTTP %i to %s", async (status, body, code) => {
    const { provider } = providerFor(new Response(JSON.stringify(body), { status }));

    const failure = await provider.generate({
      sourceTitle: "资料",
      sourceText,
      anonymousUserId,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code, retryable: true });
  });

  it.each([
    ["invalid JSON", "not-json"],
    ["schema overflow", JSON.stringify({
      attention: "a".repeat(121),
      summary: "summary",
      inspiration: "inspiration",
      sourceTitle: "title",
      warnings: [],
    })],
  ])("rejects %s as retryable invalid output", async (_label, content) => {
    const { provider } = providerFor(new Response(JSON.stringify(successResponse({
      choices: [{ finish_reason: "stop", message: { content } }],
    })), { status: 200 }));

    const failure = await provider.generate({
      sourceTitle: "资料",
      sourceText,
      anonymousUserId,
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "MODEL_OUTPUT_INVALID", retryable: true });
  });
});
