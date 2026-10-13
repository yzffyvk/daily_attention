import { describe, expect, it, vi } from "vitest";
import { createSummaryProvider } from "@/supabase/functions/_shared/ai/deepseek";
import { questionSummaryFixture } from "../../helpers/knowledge-questions-fixture";
import { readChatStream } from "@/supabase/functions/_shared/ai/chat-stream";

const input = { sourceTitle: "资料", sourceText: "这是一篇关于知识结构的文章。".repeat(30), anonymousUserId: "ab".repeat(32) };
const result = { attention: "知识结构", summary: "第一段\n第二段", inspiration: "", sourceTitle: "资料", warnings: [] };
const usage = { prompt_tokens: 100, completion_tokens: 30 };
const event = (value: unknown) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const chunk = (delta: Record<string, unknown>, finish_reason: string | null = null) => ({ model: "test-model", choices: [{ index: 0, delta, finish_reason }] });

describe("streaming summaries", () => {
  it("accepts long thinking streams whose SSE envelopes exceed 8 MiB without retaining reasoning", async () => {
    const reasoning = event({ ...chunk({ reasoning_content: "思" }), id: "chat-completion-id".repeat(12), object: "chat.completion.chunk", created: 1780000000 });
    expect(reasoning.length * 32768).toBeGreaterThan(8 * 1024 * 1024);
    const encoder = new TextEncoder();
    let batches = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      if (batches++ < 32) controller.enqueue(encoder.encode(reasoning.repeat(1024)));
      else {
        controller.enqueue(encoder.encode(event(chunk({ content: JSON.stringify(result) }, "stop")) + event({ choices: [], usage }) + "data: [DONE]\n\n"));
        controller.close();
      }
    } });
    const progress = vi.fn();
    await expect(readChatStream(new Response(body), progress)).resolves.toMatchObject({ choices: [{ message: { content: JSON.stringify(result) } }] });
    expect(progress).toHaveBeenCalledExactlyOnceWith(JSON.stringify(result));
  });
  it("DeepSeek publishes real partial text before completion and excludes reasoning", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(body, { headers: { "content-type": "text/event-stream" } }));
    const progress = vi.fn();
    const task = createSummaryProvider({ apiKey: "test-key", fetchImpl }).generate({ ...input, onProgress: progress });
    const encoder = new TextEncoder();
    const prefix = event(chunk({ reasoning_content: "PRIVATE_REASONING" })) + event(chunk({ content: '{"attention":"知识结构","summary":"第一段' }));
    // Split even inside UTF-8 characters and CRLF delimiters.
    for (const byte of encoder.encode(prefix)) controller.enqueue(new Uint8Array([byte]));
    await vi.waitFor(() => expect(progress.mock.calls.some(([value]) => value.preview.includes("第一段"))).toBe(true));
    expect(JSON.stringify(progress.mock.calls)).not.toContain("PRIVATE_REASONING");
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    controller.enqueue(encoder.encode(event(chunk({ content: '\\n第二段","inspiration":"","sourceTitle":"资料","warnings":[]}' }, "stop")) + event({ choices: [], usage }) + "data: [DONE]\n\n"));
    controller.close();
    await expect(task).resolves.toMatchObject({ result, usage: { promptTokens: 100, completionTokens: 30 } });
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "validating" });
  });

  it("rejects a disconnected stream even when the partial JSON looks complete", async () => {
    const response = new Response(event(chunk({ content: JSON.stringify(result) })), { headers: { "content-type": "text/event-stream" } });
    const provider = createSummaryProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(response) });
    await expect(provider.generate({ ...input, onProgress: vi.fn() })).rejects.toMatchObject({ code: "MODEL_SERVICE_ERROR", retryable: true });
  });

  it("retains already received usage when a stream disconnects before DONE", async () => {
    const response = new Response(event(chunk({ content: JSON.stringify(result) }, "stop")) + event({ choices: [], usage }), { headers: { "content-type": "text/event-stream" } });
    const provider = createSummaryProvider({ apiKey: "key", fetchImpl: vi.fn().mockResolvedValue(response) });
    await expect(provider.generate({ ...input, onProgress: vi.fn() })).rejects.toMatchObject({ code: "MODEL_SERVICE_ERROR", retryable: true, usage: { promptTokens: 100, completionTokens: 30 } });
  });

  it("clears an invalid first draft when a streamed format repair starts", async () => {
    const valid = questionSummaryFixture();
    const invalid = { ...valid, structure: {} };
    const progress = vi.fn();
    const fetchImpl = vi.fn();
    for (const value of [invalid, valid]) fetchImpl.mockResolvedValueOnce(new Response(
      event(chunk({ content: JSON.stringify(value) }, "stop")) + event({ choices: [], usage }) + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    ));
    const provider = createSummaryProvider({ apiKey: "key", fetchImpl });
    const generated = await provider.generate({ ...input, sourceText: "计划列出行动步骤，检查用于验证结果。".repeat(30), promptVersion: "knowledge-questions-v1", onProgress: progress });
    expect(generated.providerCallCount).toBe(2);
    expect(generated.usage.promptTokens).toBe(200);
    expect(progress.mock.calls.some(([value]) => value.phase === "repairing" && value.preview === "")).toBe(true);
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ phase: "validating" });
  });

  it("cancels a stalled response body when its deadline expires", async () => {
    const cancelled = vi.fn();
    const controller = new AbortController();
    const response = new Response(new ReadableStream({ cancel: cancelled }), { headers: { "content-type": "text/event-stream" } });
    const started = vi.fn().mockResolvedValue(response);
    const task = createSummaryProvider({ apiKey: "key", fetchImpl: started }).generate({ ...input, onProgress: vi.fn(), signal: controller.signal });
    await vi.waitFor(() => expect(started).toHaveBeenCalled());
    controller.abort();
    await expect(task).rejects.toMatchObject({ code: "MODEL_SERVICE_ERROR" });
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
