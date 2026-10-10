import { describe, expect, it } from "vitest";
import { reflectionPolishInputSchema, reflectionPolishResultSchema } from "@/lib/domain/reflection-polish";

describe("reflection polish domain", () => {
  it.each(["summary", "answer"] as const)("rejects whitespace-only %s without transforming valid text", (field) => {
    expect(reflectionPolishInputSchema.safeParse({ topic: "主题", summary: "总结", answer: "解释", maxLength: 20, [field]: " \n " }).success).toBe(false);
    const original = { topic: " 主题 ", summary: " 总结 ", answer: " 解释 ", maxLength: 20 };
    expect(reflectionPolishInputSchema.parse(original)).toEqual(original);
  });

  it("caps short UI lists", () => {
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: "解释", knowledgePoints: Array(7).fill("知识"), improvements: [], cautions: [] }).success).toBe(false);
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: "解释", knowledgePoints: [], improvements: Array(5).fill("改进"), cautions: [] }).success).toBe(false);
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: "解释", knowledgePoints: [], improvements: [], cautions: Array(4).fill("提醒") }).success).toBe(false);
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: "解释", knowledgePoints: ["知".repeat(41)], improvements: [], cautions: [] }).success).toBe(false);
  });

  it("rejects whitespace-only polished answers and notes", () => {
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: " \n ", knowledgePoints: [], improvements: [], cautions: [] }).success).toBe(false);
    expect(reflectionPolishResultSchema.safeParse({ polishedAnswer: "解释", knowledgePoints: ["   "], improvements: [], cautions: [] }).success).toBe(false);
  });
});
