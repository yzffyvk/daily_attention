import { describe, expect, it } from "vitest";
import { planCatalogSync } from "@/scripts/sync-tennis-takeaways.mts";
import { tennisLessons } from "@/lib/domain/tennis-lessons";

describe("takeaway editorial publication", () => {
  it("imports unreviewed lessons only as drafts", () => {
    const rows = planCatalogSync([tennisLessons[0]], [], {});
    expect(rows[0]).toMatchObject({ published: false, reviewed_by: null, reviewed_at: null });
  });
  it("requires a named human review before publishing", () => {
    expect(() => planCatalogSync([tennisLessons[0]], [], { publish: true })).toThrow("人工审核");
    expect(() => planCatalogSync([tennisLessons[0]], [], { publish: true, reviewer: "Editor" })).toThrow("人工审核");
    expect(planCatalogSync([tennisLessons[0]], [], { publish: true, reviewer: "Editor", confirmHumanReview: true })[0].published).toBe(true);
  });
  it("leaves identical published content alone and requires a version and correction for revisions", () => {
    const existing = { id: "tennis-01", sequence: 1, version: 1, content: tennisLessons[0], published: true };
    expect(planCatalogSync([tennisLessons[0]], [existing], {})).toEqual([]);
    const changed = { ...tennisLessons[0], conclusion: "修改后的结论" };
    expect(() => planCatalogSync([changed], [existing], {})).toThrow();
    expect(() => planCatalogSync([changed], [existing], { publish: true, reviewer: "Editor", confirmHumanReview: true })).toThrow("版本");
    expect(() => planCatalogSync([{ ...changed, version: 2 }], [existing], { publish: true, reviewer: "Editor", confirmHumanReview: true })).toThrow("更正说明");
  });
  it("does not overwrite withdrawn but previously reviewed content with an unreviewed draft", () => {
    const withdrawn = { id: "tennis-01", sequence: 1, version: 1, content: tennisLessons[0], published: false, reviewed_at: "2026-10-09T02:00:00Z" };
    expect(planCatalogSync([tennisLessons[0]], [withdrawn], {})).toEqual([]);
    expect(() => planCatalogSync([{ ...tennisLessons[0], conclusion: "尚未审核的修改" }], [withdrawn], {})).toThrow("人工审核");
  });
});
