import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteAttentionDraftDatabase,
  loadDraft,
  saveDraft,
} from "@/lib/indexed-db/drafts";

const date = "2026-07-23";

beforeEach(async () => {
  await deleteAttentionDraftDatabase();
});

afterEach(async () => {
  await deleteAttentionDraftDatabase();
});

describe("draft storage", () => {
  it("isolates drafts by immutable user id and date", async () => {
    await saveDraft({
      userId: "user-1",
      date,
      attention: "one",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob: null,
      imageName: "",
      removeImage: false,
      baseVersion: 1,
      updatedAt: "2026-07-23T10:00:00.000Z",
    });

    expect(await loadDraft("user-1", date)).toMatchObject({ attention: "one" });
    expect(await loadDraft("user-2", date)).toBeUndefined();
    expect(await loadDraft("user-1", "2026-07-24")).toBeUndefined();
  });

  it("stores image content as a Blob instead of a data URL", async () => {
    const imageBlob = new Blob(["image-bytes"], { type: "image/png" });

    await saveDraft({
      userId: "user-1",
      date,
      attention: "with image",
      sourceUrl: "",
      summary: "",
      inspiration: "",
      imageBlob,
      imageName: "note.png",
      removeImage: false,
      baseVersion: null,
      updatedAt: "2026-07-23T10:00:00.000Z",
    });

    const stored = await loadDraft("user-1", date);
    // fake-indexeddb structurally clones jsdom Blobs without their prototype.
    expect(typeof stored?.imageBlob).toBe("object");
    expect(stored).not.toHaveProperty("imageUrl");
    expect(JSON.stringify(stored)).not.toContain("data:");
  });
});
