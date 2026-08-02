import { describe, expect, it } from "vitest";
import {
  aiGenerationResultSchema,
  createAiGenerationSchema,
} from "@/lib/domain/ai-generation";

const validInput = {
  sourceUrl: "https://example.com/article",
  targetDate: "2026-07-31",
  idempotencyKey: "8b6b3b53-8753-4f5b-bc5a-258b05e3d5d2",
};

const validResult = {
  attention: "理解注意力机制",
  summary: "结构化知识小结",
  inspiration: "继续比较不同架构",
  sourceTitle: "示例资料",
  warnings: ["资料可能不完整"],
};

describe("AI generation domain contracts", () => {
  it("normalizes safe HTTP and HTTPS URLs", () => {
    expect(createAiGenerationSchema.parse({
      ...validInput,
      sourceUrl: "HTTPS://EXAMPLE.COM:443/a/../lesson?q=One%20Two",
    }).sourceUrl).toBe("https://example.com/lesson?q=One%20Two");

    expect(createAiGenerationSchema.parse({
      ...validInput,
      sourceUrl: "http://EXAMPLE.COM:80/article",
    }).sourceUrl).toBe("http://example.com/article");
  });

  it.each([
    "file:///tmp/article.html",
    "ftp://example.com/article",
    "https://user:password@example.com/article",
    "https://example.com/article#private-section",
    "https://example.com:8080/article",
  ])("rejects a disallowed URL: %s", (sourceUrl) => {
    expect(createAiGenerationSchema.safeParse({ ...validInput, sourceUrl }).success).toBe(false);
  });

  it("rejects invalid dates, identifiers, and extra fields", () => {
    expect(createAiGenerationSchema.safeParse({
      ...validInput,
      targetDate: "2026-02-30",
    }).success).toBe(false);
    expect(createAiGenerationSchema.safeParse({
      ...validInput,
      idempotencyKey: "not-a-uuid",
    }).success).toBe(false);
    expect(createAiGenerationSchema.safeParse({
      ...validInput,
      internalOverride: true,
    }).success).toBe(false);
  });

  it.each([
    ["attention", "a".repeat(121)],
    ["summary", "s".repeat(5001)],
    ["inspiration", "i".repeat(2001)],
    ["sourceTitle", "t".repeat(301)],
  ] as const)("enforces the %s output limit", (field, value) => {
    expect(aiGenerationResultSchema.safeParse({
      ...validResult,
      [field]: value,
    }).success).toBe(false);
  });

  it("accepts a bounded result and rejects malformed warnings", () => {
    expect(aiGenerationResultSchema.parse(validResult)).toEqual(validResult);
    expect(aiGenerationResultSchema.safeParse({
      ...validResult,
      warnings: [123],
    }).success).toBe(false);
    expect(aiGenerationResultSchema.safeParse({
      ...validResult,
      warnings: Array.from({ length: 11 }, (_, index) => `warning-${index}`),
    }).success).toBe(false);
  });
});
