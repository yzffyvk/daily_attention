import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  compressImage,
  ImageNoteUploader,
  type ImageCompressor,
} from "@/features/checkins/image-note-uploader";

const targetImageBytes = 2 * 1024 * 1024;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderUploader(
  compressImage: ImageCompressor,
  identity = "2026-07-23",
  onPreparationChange = vi.fn(),
) {
  const onChange = vi.fn();
  const onError = vi.fn();
  const result = render(
    <ImageNoteUploader
      compressImage={compressImage}
      existingImage={null}
      file={null}
      identity={identity}
      onChange={onChange}
      onError={onError}
      onPreparationChange={onPreparationChange}
      removeImage={false}
    />,
  );
  return { ...result, onChange, onError, onPreparationChange };
}

function installImageCanvas({
  width,
  height,
  outputSize,
}: {
  width: number;
  height: number;
  outputSize: (attempt: {
    width: number;
    height: number;
    quality: number | undefined;
    index: number;
  }) => number;
}) {
  const attempts: Array<{
    width: number;
    height: number;
    quality: number | undefined;
    index: number;
  }> = [];
  const drawImage = vi.fn();
  const canvas = {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ({ clearRect: vi.fn(), drawImage })),
    toBlob: vi.fn((
      callback: BlobCallback,
      _type?: string,
      quality?: number,
    ) => {
      const attempt = {
        width: canvas.width,
        height: canvas.height,
        quality,
        index: attempts.length,
      };
      attempts.push(attempt);
      callback(new Blob(
        [new Uint8Array(outputSize(attempt))],
        { type: "image/jpeg" },
      ));
    }),
  };
  const originalCreateElement = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((
    tagName: string,
    options?: ElementCreationOptions,
  ) => (
    tagName === "canvas"
      ? canvas as unknown as HTMLCanvasElement
      : originalCreateElement(tagName, options)
  ));
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:source"),
    revokeObjectURL: vi.fn(),
  });
  vi.stubGlobal("Image", class {
    width = width;
    height = height;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;

    set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  });
  return { attempts, canvas, drawImage };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ImageNoteUploader", () => {
  it("creates and revokes a preview for an image file restored from local draft storage", async () => {
    const createObjectURL = vi.fn(() => "blob:restored-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    const restored = new File(["restored"], "restored-note.png", { type: "image/png" });

    const view = render(
      <ImageNoteUploader
        existingImage={null}
        file={restored}
        identity="2026-07-23"
        onChange={vi.fn()}
        onError={vi.fn()}
        removeImage={false}
      />,
    );

    const preview = await screen.findByAltText("restored-note.png");
    expect(preview).toHaveAttribute("src", "blob:restored-preview");
    expect(createObjectURL).toHaveBeenCalledWith(restored);

    view.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:restored-preview");
  });

  it("limits the longest prepared image edge to 1600px and returns at most 2MiB", async () => {
    const browser = installImageCanvas({
      width: 3200,
      height: 800,
      outputSize: () => 1_200_000,
    });
    const source = new File(["source"], "wide.png", { type: "image/png" });

    const prepared = await compressImage(source);

    expect(browser.attempts[0]).toMatchObject({ width: 1600, height: 400 });
    expect(browser.drawImage).toHaveBeenCalled();
    expect(prepared.size).toBeLessThanOrEqual(targetImageBytes);
    expect(prepared.type).toBe("image/jpeg");
  });

  it("re-encodes a small-dimension JPEG that exceeds 2MiB instead of returning it unchanged", async () => {
    const browser = installImageCanvas({
      width: 800,
      height: 600,
      outputSize: ({ index }) => index === 0 ? targetImageBytes + 1 : 1_400_000,
    });
    const source = new File(
      [new Uint8Array(targetImageBytes + 100_000)],
      "oversized.jpg",
      { type: "image/jpeg" },
    );

    const prepared = await compressImage(source);

    expect(prepared).not.toBe(source);
    expect(browser.attempts.length).toBeGreaterThan(1);
    expect(browser.attempts[0]).toMatchObject({ width: 800, height: 600 });
    expect(browser.attempts[1].quality).toBeLessThan(browser.attempts[0].quality ?? 1);
    expect(prepared.size).toBeLessThanOrEqual(targetImageBytes);
  });

  it("uses bounded downscaling after quality reduction cannot reach 2MiB", async () => {
    const browser = installImageCanvas({
      width: 2400,
      height: 1800,
      outputSize: ({ width: attemptWidth }) => (
        attemptWidth === 1600 ? targetImageBytes + 1 : 1_500_000
      ),
    });
    const source = new File(
      [new Uint8Array(targetImageBytes + 100_000)],
      "detailed.png",
      { type: "image/png" },
    );

    const prepared = await compressImage(source);

    expect(browser.attempts[0]).toMatchObject({ width: 1600, height: 1200 });
    expect(browser.attempts.some((attempt) => attempt.width < 1600)).toBe(true);
    expect(browser.attempts.length).toBeLessThanOrEqual(20);
    expect(prepared.size).toBeLessThanOrEqual(targetImageBytes);
  });

  it("rejects clearly when bounded preparation cannot reach 2MiB", async () => {
    installImageCanvas({
      width: 2400,
      height: 1800,
      outputSize: () => targetImageBytes + 1,
    });
    const source = new File(
      [new Uint8Array(targetImageBytes + 100_000)],
      "impossible.png",
      { type: "image/png" },
    );

    await expect(compressImage(source)).rejects.toThrow(
      "图片压缩后仍超过 2MB，请选择更小或内容更简单的图片",
    );
  });

  it("surfaces an over-target preparation error without calling onChange", async () => {
    const preparationError = new Error(
      "图片压缩后仍超过 2MB，请选择更小或内容更简单的图片",
    );
    preparationError.name = "ImagePreparationError";
    const { onChange, onError } = renderUploader(
      vi.fn().mockRejectedValue(preparationError),
    );
    const source = new File(["source"], "source.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith(preparationError.message));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps the 10MiB input cap before preparation", async () => {
    const compressor = vi.fn();
    const { onChange, onError } = renderUploader(compressor);
    const source = new File(
      [new Uint8Array(10 * 1024 * 1024 + 1)],
      "too-large.png",
      { type: "image/png" },
    );

    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });

    expect(onError).toHaveBeenCalledWith("请选择 10MB 以内的 JPEG、PNG 或 WebP 图片");
    expect(compressor).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops stale compression work after its date identity changes and revokes its URL", async () => {
    const compressed = deferred<File>();
    const compressor = vi.fn(() => compressed.promise);
    const createObjectURL = vi.fn(() => "blob:stale-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const { onChange, onPreparationChange, rerender } = renderUploader(compressor);
    const source = new File(["image"], "source.png", { type: "image/png" });
    const output = new File(["compressed"], "compressed.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });
    await waitFor(() => expect(compressor).toHaveBeenCalledWith(source));
    expect(onPreparationChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ImageNoteUploader
        compressImage={compressor}
        existingImage={null}
        file={null}
        identity="2026-07-24"
        onChange={onChange}
        onError={vi.fn()}
        onPreparationChange={onPreparationChange}
        removeImage={false}
      />,
    );
    expect(onPreparationChange).toHaveBeenLastCalledWith(false);
    compressed.resolve(output);

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:stale-preview"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("drops stale compression work after unmounting and revokes its URL", async () => {
    const compressed = deferred<File>();
    const compressor = vi.fn(() => compressed.promise);
    const createObjectURL = vi.fn(() => "blob:unmounted-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const { onChange, onPreparationChange, unmount } = renderUploader(compressor);
    const source = new File(["image"], "source.png", { type: "image/png" });
    const output = new File(["compressed"], "compressed.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });
    await waitFor(() => expect(compressor).toHaveBeenCalledWith(source));
    expect(onPreparationChange).toHaveBeenLastCalledWith(true);

    unmount();
    expect(onPreparationChange).toHaveBeenLastCalledWith(false);
    compressed.resolve(output);

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:unmounted-preview"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("invalidates pending compression when the image is removed", async () => {
    const compressed = deferred<File>();
    const compressor = vi.fn(() => compressed.promise);
    const createObjectURL = vi.fn(() => "blob:removed-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const onChange = vi.fn();
    const view = render(
      <ImageNoteUploader
        compressImage={compressor}
        existingImage={{ imageName: "existing.png", imageUrl: "https://example.com/existing.png" }}
        file={null}
        identity="2026-07-23"
        onChange={onChange}
        onError={vi.fn()}
        removeImage={false}
      />,
    );
    const source = new File(["image"], "source.png", { type: "image/png" });
    const output = new File(["compressed"], "compressed.jpg", { type: "image/jpeg" });

    fireEvent.change(screen.getByLabelText("替换图片"), {
      target: { files: [source] },
    });
    await waitFor(() => expect(compressor).toHaveBeenCalledWith(source));
    fireEvent.click(screen.getByRole("button", { name: "移除图片" }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ file: null, removeImage: true });

    view.rerender(
      <ImageNoteUploader
        compressImage={compressor}
        existingImage={null}
        file={null}
        identity="2026-07-23"
        onChange={onChange}
        onError={vi.fn()}
        removeImage
      />,
    );
    compressed.resolve(output);

    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith("blob:removed-preview"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.queryByAltText("compressed.jpg")).not.toBeInTheDocument();
  });

  it("reports that preparation has settled after compression fails", async () => {
    const compressor = vi.fn().mockRejectedValue(new Error("broken image"));
    const { onError, onPreparationChange } = renderUploader(compressor);
    const source = new File(["image"], "source.png", { type: "image/png" });

    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalledWith("图片读取失败，请换一张重试"));
    expect(onPreparationChange).toHaveBeenNthCalledWith(1, true);
    expect(onPreparationChange).toHaveBeenLastCalledWith(false);
  });
});
