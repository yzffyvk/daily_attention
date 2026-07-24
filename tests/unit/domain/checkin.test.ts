import { describe, expect, it } from "vitest";
import { checkInInputSchema, dateKeySchema } from "@/lib/domain/checkin";

describe("check-in contracts", () => {
  it("accepts a complete dated entry", () => {
    expect(
      checkInInputSchema.parse({
        attention: "理解了 attention 的作用",
        sourceUrl: "https://example.com/lesson",
        summary: "Query、Key、Value 共同计算相关性。",
        inspiration: "尝试把会议纪要按主题聚类。",
        imagePath: null,
        imageName: "",
        version: null,
      }).attention,
    ).toBe("理解了 attention 的作用");
  });

  it("rejects impossible dates and non-http sources", () => {
    expect(dateKeySchema.safeParse("2026-02-30").success).toBe(false);
    expect(
      checkInInputSchema.safeParse({
        attention: "x",
        sourceUrl: "javascript:alert(1)",
        summary: "",
        inspiration: "",
        imagePath: null,
        imageName: "",
        version: null,
      }).success,
    ).toBe(false);
  });

  it("rejects an empty image path", () => {
    expect(
      checkInInputSchema.safeParse({
        attention: "x",
        sourceUrl: "",
        summary: "",
        inspiration: "",
        imagePath: "",
        imageName: "",
        version: null,
      }).success,
    ).toBe(false);
  });
});
