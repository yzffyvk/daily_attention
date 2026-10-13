// Chat Completions SSE is shared by both configured providers. Only public
// content is accumulated; reasoning deltas are intentionally discarded.
export class ChatStreamError extends Error {
  readonly code: "MODEL_SERVICE_ERROR" | "MODEL_OUTPUT_INVALID";
  readonly usage?: unknown;
  constructor(code: "MODEL_SERVICE_ERROR" | "MODEL_OUTPUT_INVALID", usage?: unknown) {
    super(code);
    this.name = "ChatStreamError";
    this.code = code;
    this.usage = usage;
  }
}

export async function readChatStream(
  response: Response,
  onContent: (content: string) => Promise<void>,
  signal?: AbortSignal,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("MODEL_SERVICE_ERROR");
  const decoder = new TextDecoder();
  let buffer = "", content = "", model = "", fingerprint: string | null = null;
  let finishReason: string | null = null, refusal = "", usage: unknown;
  let done = false, size = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    while (!done) {
      signal?.throwIfAborted();
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.byteLength;
      // 32k thinking tokens can exceed 8 MiB in SSE envelope overhead alone.
      // Bound transport separately from the public-content limit below.
      if (size > 64 * 1024 * 1024) throw new Error("MODEL_OUTPUT_INVALID");
      buffer += decoder.decode(next.value, { stream: true });
      let delimiter: RegExpExecArray | null;
      while ((delimiter = /\r?\n\r?\n/u.exec(buffer))) {
        const frame = buffer.slice(0, delimiter.index);
        buffer = buffer.slice(delimiter.index + delimiter[0].length);
        const data = frame.split(/\r?\n/u).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        if (data === "[DONE]") { done = true; break; }
        const event = JSON.parse(data);
        if (event.error) throw new Error("MODEL_SERVICE_ERROR");
        if (typeof event.model === "string") model = event.model;
        if (typeof event.system_fingerprint === "string") fingerprint = event.system_fingerprint;
        if (event.usage) usage = event.usage;
        const choice = event.choices?.find((item: { index?: number }) => item.index === 0);
        if (!choice) continue;
        if (typeof choice.delta?.refusal === "string") refusal += choice.delta.refusal;
        if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
        if (typeof choice.delta?.content === "string") {
          content += choice.delta.content;
          if (content.length > 2 * 1024 * 1024) throw new Error("MODEL_OUTPUT_INVALID");
          await onContent(content);
        }
      }
    }
    // EOF alone is not success, even if the JSON happens to be parseable.
    if (!done || !finishReason || !usage) throw new Error("MODEL_SERVICE_ERROR");
    return { model, system_fingerprint: fingerprint, usage,
      choices: [{ finish_reason: finishReason, message: { content, refusal: refusal || null } }] };
  } catch (error) {
    // Usage may have arrived before a transport interruption. Preserve it for
    // retry accounting without carrying raw content or reasoning in errors.
    throw new ChatStreamError(error instanceof Error && error.message === "MODEL_OUTPUT_INVALID"
      ? "MODEL_OUTPUT_INVALID" : "MODEL_SERVICE_ERROR", usage);
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
