import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CheckInEditor,
  type CheckInDraft,
} from "@/features/checkins/checkin-editor";
import type { ActiveAiJob } from "@/features/ai-generation/types";

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

function EditorHarness({
  initialDraft = emptyDraft,
  activeAiJob = null,
  aiStage = "idle",
  onAiCancel = vi.fn(),
  onAiGenerate = vi.fn(),
}: {
  initialDraft?: CheckInDraft;
  activeAiJob?: ActiveAiJob | null;
  aiStage?: "idle" | "creating" | "queued" | "fetching" | "generating" | "retrying" | "complete";
  onAiCancel?: () => void;
  onAiGenerate?: () => void;
} = {}) {
  const [draft, setDraft] = useState(initialDraft);

  return (
    <CheckInEditor
      aiActiveJob={activeAiJob}
      aiError=""
      aiIsLongRunning={false}
      aiQuotaRemaining={null}
      aiStage={aiStage}
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
      onAiCancel={onAiCancel}
      onAiGenerate={onAiGenerate}
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
  it("offers optional requirements and distinguishes edited requirements from the generated result", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initialDraft={{ ...emptyDraft, userPrompt: "重点解释边界", summary: "原总结", aiGenerationContext: { userPrompt: "简短总结", promptVersion: "v1" } }} />);
    expect(screen.queryByRole("textbox", { name: "提炼要求" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    expect(screen.getByRole("textbox", { name: "提炼要求" })).toHaveValue("重点解释边界");
    expect(screen.getByText(/修改后重新提炼生效/)).toBeVisible();
    expect(screen.getByText("简短总结")).toBeInTheDocument();
    await user.clear(screen.getByRole("textbox", { name: "提炼要求" }));
    expect(screen.getByRole("textbox", { name: "提炼要求" })).toHaveValue("");
    expect(screen.getByText("原总结")).toBeVisible();
  });

  it("locks requirements as soon as a generation request is being created", async () => {
    const user = userEvent.setup();
    render(<EditorHarness initialDraft={{ ...emptyDraft, userPrompt: "重点解释边界", sourceUrl: "https://example.com/article" }} aiStage="creating" />);
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    expect(screen.getByRole("textbox", { name: "提炼要求" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "正在创建…" })).toBeDisabled();
  });
  it("reads the skeleton by default and keeps edited text and all reflection tabs", async () => {
    render(<EditorHarness initialDraft={{ ...emptyDraft, summary: "一句话主旨：看清组成。\n\n主要骨架：\n整体\n├─ 部分甲\n└─ 部分乙" }} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));
    expect(screen.getByRole("region", { name: "知识结构图" })).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "知识小结" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "编辑总结" }));
    const editor = screen.getByRole("textbox", { name: "知识小结" });
    await user.clear(editor);
    await user.type(editor, "我修改后的完整知识解释。");
    await user.click(screen.getByRole("button", { name: "完成编辑" }));
    expect(screen.getByText("我修改后的完整知识解释。")).toBeVisible();
    await user.type(screen.getByRole("textbox", { name: /用自己的话解释/ }), "我的解释");
    await user.click(screen.getByRole("tab", { name: "新的理解" }));
    await user.type(screen.getByRole("textbox", { name: /新的理解/ }), "新理解");
    await user.click(screen.getByRole("tab", { name: "有趣的思想点" }));
    await user.type(screen.getByRole("textbox", { name: /有趣的思想点/ }), "新联想");
    await user.click(screen.getByRole("button", { name: "暂时收起知识总结" }));
    expect(screen.getByText("我修改后的完整知识解释。")).not.toBeVisible();
    await user.click(screen.getByRole("tab", { name: "用自己的话解释" }));
    expect(screen.getByRole("textbox", { name: /用自己的话解释/ })).toHaveValue("我的解释");
    await user.click(screen.getByRole("button", { name: "显示知识总结" }));
    expect(screen.getByText("我修改后的完整知识解释。")).toBeVisible();
  });
  it("explains full-article extraction for section anchors", async () => {
    const user = userEvent.setup();
    render(<EditorHarness />);
    await user.click(screen.getByRole("button", {name:/AI 提炼/}));
    await user.type(screen.getByLabelText(/学习资料来源/), "https://example.com/article#skills");
    expect(screen.getByText("将忽略链接中的章节定位，提炼整篇文章，而非仅该章节。")).toBeVisible();
    expect(screen.getByRole("button", {name:"生成知识小结"})).toBeEnabled();
  });
  it("starts in manual mode with the existing journal fields", () => {
    render(<EditorHarness />);

    expect(screen.getByRole("button", { name: /手动记录/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByLabelText("今日知识主题")).toBeVisible();
    expect(screen.getByRole("textbox", { name: /知识小结/ })).toBeVisible();

    const referenceSection = screen.getByRole("region", { name: "参考资料" });
    expect(within(referenceSection).getByLabelText(/学习资料来源/)).toBeVisible();
    expect(within(referenceSection).getByTestId("image-note-uploader")).toBeVisible();
    expect(within(referenceSection).getByLabelText(/我的理解与收获/)).toBeVisible();
  });

  it("starts a real AI summary flow after a source URL is entered", async () => {
    const user = userEvent.setup();
    const onAiGenerate = vi.fn();
    render(<EditorHarness onAiGenerate={onAiGenerate} />);

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
    expect(onAiGenerate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/尚未接入/)).not.toBeInTheDocument();
  });

  it("offers cancellation only while a job is queued", async () => {
    const user = userEvent.setup();
    const onAiCancel = vi.fn();
    const activeAiJob = {
      jobId: "10000000-0000-4000-8000-000000000001",
      targetDate: "2026-07-28",
      sourceUrl: "https://example.com/article",
      createdAt: "2026-07-28T10:00:00.000Z",
    };
    render(<EditorHarness activeAiJob={activeAiJob} aiStage="queued" onAiCancel={onAiCancel} />);
    await user.click(screen.getByRole("button", { name: /AI 提炼/ }));

    await user.click(screen.getByRole("button", { name: "取消任务" }));
    expect(onAiCancel).toHaveBeenCalledTimes(1);
  });
});
