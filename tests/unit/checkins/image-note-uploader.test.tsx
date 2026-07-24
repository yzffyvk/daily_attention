import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ImageNoteUploader, type ImageCompressor } from "@/features/checkins/image-note-uploader";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function renderUploader(compressImage: ImageCompressor, identity = "2026-07-23") {
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
      removeImage={false}
    />,
  );
  return { ...result, onChange, onError };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ImageNoteUploader", () => {
  it("drops stale compression work after its date identity changes and revokes its URL", async () => {
    const compressed = deferred<File>();
    const compressor = vi.fn(() => compressed.promise);
    const createObjectURL = vi.fn(() => "blob:stale-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const { onChange, rerender } = renderUploader(compressor);
    const source = new File(["image"], "source.png", { type: "image/png" });
    const output = new File(["compressed"], "compressed.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });
    await waitFor(() => expect(compressor).toHaveBeenCalledWith(source));

    rerender(
      <ImageNoteUploader
        compressImage={compressor}
        existingImage={null}
        file={null}
        identity="2026-07-24"
        onChange={onChange}
        onError={vi.fn()}
        removeImage={false}
      />,
    );
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

    const { onChange, unmount } = renderUploader(compressor);
    const source = new File(["image"], "source.png", { type: "image/png" });
    const output = new File(["compressed"], "compressed.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("添加图片笔记"), {
      target: { files: [source] },
    });
    await waitFor(() => expect(compressor).toHaveBeenCalledWith(source));

    unmount();
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
});
