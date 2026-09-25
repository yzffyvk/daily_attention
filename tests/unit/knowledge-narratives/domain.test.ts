import { describe, expect, it } from "vitest";
import { createNarrativeSchema, validateNarrativeResult } from "@/lib/domain/knowledge-narrative";

const dates = ["2026-08-31", "2026-09-02"];
export function resultFixture() {
  return {
    title: "从记录走向理解", overview: "通过记录和复盘，建立理解。",
    nodes: dates.map((date) => ({ date, label: "记录与理解", takeaway: "保存收获，回顾联系。" })),
    connections: [{ fromDate: dates[0], toDate: dates[1], relation: "补充", explanation: "复盘补充当日的记录。" }],
    sections: [{ title: "理解主线", body: "记录和复盘相互补充。", sourceDates: dates }],
    framework: [{ title: "实践方法", body: "记录后及时回顾。", sourceDates: dates }],
    gaps: ["尚缺实践结果。"], nextSteps: ["尝试一周后复盘。"],
  };
}
describe("knowledge narrative contracts", () => {
  const input = { dates, question: "  如何形成理解？  ", idempotencyKey: "dc390edf-7bd8-4896-bd8c-815b9ddf3e01" };
  it("accepts nonconsecutive dates across months and normalizes the order", () => {
    expect(createNarrativeSchema.parse({ ...input, dates: [...dates].reverse() })).toEqual({ ...input, question: "如何形成理解？", entryMode: "manual" });
    expect(createNarrativeSchema.parse({ ...input, entryMode: "ai" })).toMatchObject({ entryMode: "ai" });
    expect(createNarrativeSchema.safeParse({ ...input, entryMode: "other" }).success).toBe(false);
  });
  it.each([[dates[0]], [...dates, dates[0]], ["2026-02-30", dates[0]], Array.from({length:15},(_,i)=>`2026-09-${String(i+1).padStart(2,"0")}`)])("rejects invalid selection %j", (invalidDates) => {
    expect(createNarrativeSchema.safeParse({ ...input, dates: invalidDates }).success).toBe(false);
  });
  it("accepts valid result with complete source coverage", () => {
    expect(validateNarrativeResult(resultFixture(), dates)).toMatchObject({ nodes: dates.map(date => expect.objectContaining({ date })) });
  });
  it("rejects invented source references even in narrative paragraphs", () => {
    const result = resultFixture(); result.sections[0].sourceDates = ["2026-09-03"];
    expect(() => validateNarrativeResult(result, dates)).toThrow();
  });
  it("rejects missing or duplicate source nodes", () => {
    const result = resultFixture(); result.nodes[1].date = dates[0];
    expect(() => validateNarrativeResult(result, dates)).toThrow();
  });
  it("rejects circular or invented connections", () => {
    const result = resultFixture(); result.connections[0].toDate = dates[0];
    expect(() => validateNarrativeResult(result, dates)).toThrow();
  });
  it("requires a relation between each consecutive pair, including weak links", () => {
    const result = resultFixture(); result.connections = [];
    expect(() => validateNarrativeResult(result, dates)).toThrow();
  });
});
