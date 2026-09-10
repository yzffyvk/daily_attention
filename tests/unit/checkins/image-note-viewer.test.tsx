import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageNoteUploader } from "@/features/checkins/image-note-uploader";

const savedImage = { imageName: "学习脑图.png", imageUrl: "https://example.invalid/note.png" };
const baseProps = {
  identity: "2026-09-10",
  existingImage: savedImage,
  file: null,
  removeImage: false,
  onChange: vi.fn(),
  onError: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("image note full viewer", () => {
  it("opens the saved image without mutating the note, even while editing is disabled", async () => {
    const user = userEvent.setup();
    render(<ImageNoteUploader {...baseProps} disabled />);

    const trigger = screen.getByRole("button", { name: "查看完整图片：学习脑图.png" });
    expect(trigger).not.toBeDisabled();
    expect(trigger.closest('[aria-disabled="true"]')).toBeNull();
    expect(screen.getByLabelText("替换图片")).toBeDisabled();
    expect(screen.getByRole("button", { name: "移除图片" })).toBeDisabled();
    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "图片笔记" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByRole("img", { name: "学习脑图.png" })).toHaveAttribute("src", "https://example.invalid/note.png");
    expect(baseProps.onChange).not.toHaveBeenCalled();
    expect(baseProps.onError).not.toHaveBeenCalled();
  });

  it("announces the filename as the dialog description", async () => {
    const user = userEvent.setup();
    render(<ImageNoteUploader {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "查看完整图片：学习脑图.png" }));
    expect(screen.getByRole("dialog", { name: "图片笔记" })).toHaveAccessibleDescription("学习脑图.png");
  });

  it("opens a local draft image using its existing preview URL without uploading it", async () => {
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:local-note"), revokeObjectURL: vi.fn() });
    const user = userEvent.setup();
    render(<ImageNoteUploader {...baseProps} existingImage={null}
      file={new File(["image"], "local.png", { type: "image/png" })} />);

    await user.click(await screen.findByRole("button", { name: "查看完整图片：local.png" }));

    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute("src", "blob:local-note");
    expect(baseProps.onChange).not.toHaveBeenCalled();
  });

  it("traps focus and restores focus, background interaction and scrolling after Escape", async () => {
    const user = userEvent.setup();
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "auto";
    try {
      const view = render(<ImageNoteUploader {...baseProps} />);
      const trigger = screen.getByRole("button", { name: "查看完整图片：学习脑图.png" });
      await user.click(trigger);
      const close = screen.getByRole("button", { name: "关闭图片预览" });
      await waitFor(() => expect(close).toHaveFocus());
      expect(document.body.style.overflow).toBe("hidden");
      expect(view.container.inert).toBe(true);
      await user.tab();
      expect(close).toHaveFocus();
      await user.tab({ shift: true });
      expect(close).toHaveFocus();
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(trigger).toHaveFocus();
      expect(view.container.inert).not.toBe(true);
      expect(document.body.style.overflow).toBe("auto");
    } finally {
      document.body.style.overflow = priorOverflow;
    }
  });

  it("closes by its close button or backdrop, but not when clicking the image", async () => {
    const user = userEvent.setup();
    render(<ImageNoteUploader {...baseProps} />);
    const trigger = screen.getByRole("button", { name: "查看完整图片：学习脑图.png" });
    await user.click(trigger);
    await user.click(within(screen.getByRole("dialog")).getByRole("img"));
    expect(screen.getByRole("dialog")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "关闭图片预览" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(trigger);
    fireEvent.click(screen.getByRole("dialog").parentElement!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(baseProps.onChange).not.toHaveBeenCalled();
  });

  it.each(["date", "source", "removal"])("dismisses stale previews when the %s changes", async (change) => {
    const user = userEvent.setup();
    const view = render(<ImageNoteUploader {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "查看完整图片：学习脑图.png" }));
    view.rerender(<ImageNoteUploader {...baseProps}
      identity={change === "date" ? "2026-09-11" : baseProps.identity}
      existingImage={change === "source" ? { ...savedImage, imageUrl: "https://example.invalid/other.png" } : savedImage}
      removeImage={change === "removal"} />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(document.body.style.overflow).not.toBe("hidden");
    view.rerender(<ImageNoteUploader {...baseProps} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a recoverable message if the full image fails to load", async () => {
    const user = userEvent.setup();
    render(<ImageNoteUploader {...baseProps} />);
    await user.click(screen.getByRole("button", { name: "查看完整图片：学习脑图.png" }));
    fireEvent.error(within(screen.getByRole("dialog")).getByRole("img"));
    expect(within(screen.getByRole("dialog")).getByRole("status")).toHaveTextContent("图片加载失败");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
