import { afterEach, describe, expect, it } from "vitest";
import { draftFromRecord, isDraftDirty } from "@/features/checkins/checkin-editor";
import { editorDraftFromStored, storedDraftFromEditor } from "@/features/drafts/use-checkin-draft";
import { applyAiResultToDraft, deleteAttentionDraftDatabase, loadDraft, saveDraft } from "@/lib/indexed-db/drafts";

afterEach(deleteAttentionDraftDatabase);

describe("AI learning requirements in drafts", () => {
  it("counts requirements-only edits as dirty and round-trips them through draft storage", async () => {
    const draft = { ...draftFromRecord(null), userPrompt: "解释使用边界", aiGenerationContext: { userPrompt: "原要求", promptVersion: "v1" } };
    expect(isDraftDirty(draft, null)).toBe(true);
    await saveDraft(storedDraftFromEditor("user-1", "2026-09-23", draft, null, null, "ai"));
    const stored = await loadDraft("user-1", "2026-09-23", "ai");
    expect(editorDraftFromStored(stored!)).toMatchObject({ userPrompt: "解释使用边界", aiGenerationContext: { userPrompt: "原要求", promptVersion: "v1" } });
    expect(await loadDraft("user-1", "2026-09-23", "manual")).toBeUndefined();
    expect(await loadDraft("user-2", "2026-09-23", "ai")).toBeUndefined();
    expect(await loadDraft("user-1", "2026-09-24", "ai")).toBeUndefined();
  });

  it("keeps current requirements and personal writing while recording the completed job's actual requirements", async () => {
    const draft = { ...draftFromRecord(null), userPrompt: "下次想问的内容", inspiration: "我的理解" };
    await saveDraft(storedDraftFromEditor("user-1", "2026-09-23", draft, null, null, "ai"));
    await applyAiResultToDraft("user-1", {
      jobId: "job-1", targetDate: "2026-09-23", sourceUrl: "https://example.com/article", createdAt: new Date().toISOString(), userPrompt: "已提交要求",
      generationContext: { userPrompt: "已提交要求", promptVersion: "v1" },
    }, { attention: "新主题", summary: "新总结", inspiration: "", sourceTitle: "原文", warnings: [] });
    expect(await loadDraft("user-1", "2026-09-23", "ai")).toMatchObject({
      summary: "新总结", inspiration: "我的理解", userPrompt: "下次想问的内容",
      aiGenerationContext: { userPrompt: "已提交要求", promptVersion: "v1" },
    });
  });
});
