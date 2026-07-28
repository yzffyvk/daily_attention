import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckInEditor,
  type CheckInDraft,
} from "@/features/checkins/checkin-editor";

vi.mock("@/features/checkins/image-note-uploader", () => ({
  ImageNoteUploader: () => <div data-testid="image-note-uploader">图片笔记</div>,
}));

const emptyDraft: CheckInDraft = {
  attention: "",
  sourceUrl: "",
  summary: "",
  inspiration: "",
  imageFile: null,
  removeImage: false,
  uploadedImagePath: null,
};

afterEach(cleanup);

function EditorHarness() {
  const [draft, setDraft] = useState(emptyDraft);

  return (
    <CheckInEditor
      date="2026-07-28"
      draft={draft}
      draftStorageState="ready"
      isCleaningUpImage={false}
      isDirty={false}
      isLoading={false}
      isOffline={false}
      isPreparingImage={false}
      isRetryingRecord={false}
      isSaving={false}
      loadError=""
      message=""
      messageTone="neutral"
      onDraftChange={(change) => setDraft((current) => ({ ...current, ...change }))}
      onImageChange={vi.fn()}
      onImageError={vi.fn()}
      onImagePreparationChange={vi.fn()}
      onReset={vi.fn()}
      onRetryRecord={vi.fn()}
      onSubmit={vi.fn()}
      record={null}
    />
  );
}

describe("CheckInEditor modes", () => {
  it("starts in manual mode with the existing journal fields", () => {
    render(<EditorHarness />);

    expect(screen.getByRole("button", { name: /手动记录/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("attention")).toBeVisible();
    expect(screen.getByLabelText(/学习资料来源/)).toBeVisible();
    expect(screen.getByLabelText(/学习知识点小结/)).toBeVisible();
  });

  it("stages an AI summary flow without sending a backend request", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);

    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));

    expect(screen.getByRole("button", { name: /AI 提炼/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const generate = screen.getByRole("button", { name: "生成知识小结" });
    expect(generate).toBeDisabled();

    await user.type(
      screen.getByLabelText(/学习资料来源/),
      "https://example.com/transformer",
    );
    expect(generate).toBeEnabled();

    await user.click(generate);
    expect(
      screen.getByText("AI 总结服务尚未接入，资料链接已保存在当前草稿中。"),
    ).toBeVisible();
  });
});
