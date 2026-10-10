import { describe, expect, it } from "vitest";
import { takeawayLessonSchema } from "@/lib/domain/daily-takeaway";
import { tennisLessons } from "@/lib/domain/tennis-lessons";

describe("beginner tennis takeaway catalog", () => {
  it("publishes exactly 30 schema-valid lessons in order", () => {
    expect(tennisLessons).toHaveLength(30);
    for (const [index, lesson] of tennisLessons.entries()) {
      expect(takeawayLessonSchema.safeParse(lesson).success).toBe(true);
      expect(lesson.sequence).toBe(index + 1);
      expect(lesson.id).toBe(`tennis-${String(index + 1).padStart(2, "0")}`);
      expect(lesson.domain).toBe("tennis");
      expect(lesson.readingSeconds).toBe(60);
      expect(lesson.version).toBe(1);
      expect(lesson.correctionNote).toBeNull();
      expect(lesson.sourceVerifiedAt).toBe("2026-10-09");
    }
  });

  it("covers all five topics with distinct, answerable lessons", () => {
    expect(new Set(tennisLessons.map(lesson => lesson.topic))).toEqual(
      new Set(["rules", "terms", "watching", "technique", "etiquette"]),
    );
    expect(new Set(tennisLessons.map(lesson => lesson.question)).size).toBe(30);
    for (const lesson of tennisLessons) {
      expect(lesson.quiz.options[0]).not.toBe(lesson.quiz.options[1]);
      expect(lesson.quiz.explanation.length).toBeGreaterThan(5);
      expect(lesson.sources.length).toBeGreaterThan(0);
      for (const source of lesson.sources) {
        expect(source.url).toMatch(/^https:\/\/(www\.itftennis\.com|www\.usta\.com|www\.lta\.org\.uk|clubspark\.lta\.org\.uk)\//u);
        expect(source.section.length).toBeGreaterThan(3);
      }
    }
  });

  it("keeps distinct scoring formats explicit in the learning sequence", () => {
    expect(tennisLessons[10].conclusion).toContain("标准占先制");
    expect(tennisLessons[16].conclusion).toContain("两分");
    expect(tennisLessons[19].conclusion).toContain("无占先制");
    expect(tennisLessons[17].conclusion).toContain("占先盘");
  });
});
