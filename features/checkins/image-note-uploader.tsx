"use client";

/* eslint-disable @next/next/no-img-element */
import { ImagePlus, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useRef, useState } from "react";

export type ImageSelection = {
  file: File | null;
  removeImage: boolean;
};

type ImageNoteUploaderProps = {
  existingImage: { imageName: string; imageUrl: string | null } | null;
  file: File | null;
  removeImage: boolean;
  onChange: (selection: ImageSelection) => void | Promise<void>;
  onError: (message: string) => void;
};

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 10 * 1024 * 1024;

async function compressImage(file: File) {
  if (
    typeof Image === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof document === "undefined"
  ) {
    return file;
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片"));
    });

    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
    if (scale === 1 && file.type === "image/jpeg") return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.82);
    });
    if (!blob) throw new Error("无法处理图片");
    const fileName = file.name.replace(/\.[^.]+$/u, "") || "image";
    return new File([blob], `${fileName}.jpg`, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function ImageNoteUploader({
  existingImage,
  file,
  removeImage,
  onChange,
  onError,
}: ImageNoteUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [filePreview, setFilePreview] = useState<{ file: File; url: string } | null>(null);
  const filePreviewRef = useRef<{ file: File; url: string } | null>(null);

  function revokeFilePreview() {
    if (!filePreviewRef.current) return;
    URL.revokeObjectURL(filePreviewRef.current.url);
    filePreviewRef.current = null;
  }

  useEffect(() => {
    return () => revokeFilePreview();
  }, []);

  useEffect(() => {
    if (!file) revokeFilePreview();
  }, [file]);

  const previewUrl =
    file && filePreview?.file === file
      ? filePreview.url
      : !removeImage
        ? existingImage?.imageUrl ?? null
        : null;
  const imageName = file?.name ?? (!removeImage ? existingImage?.imageName ?? "" : "");

  async function processImage(nextFile?: File) {
    if (!nextFile) return;
    if (!acceptedTypes.has(nextFile.type) || nextFile.size > maxImageBytes) {
      onError("请选择 10MB 以内的 JPEG、PNG 或 WebP 图片");
      return;
    }

    setIsPreparing(true);
    try {
      const compressed = await compressImage(nextFile);
      revokeFilePreview();
      const preview = {
        file: compressed,
        url: URL.createObjectURL(compressed),
      };
      filePreviewRef.current = preview;
      setFilePreview(preview);
      await onChange({ file: compressed, removeImage: false });
    } catch {
      revokeFilePreview();
      setFilePreview(null);
      onError("图片读取失败，请换一张重试");
    } finally {
      setIsPreparing(false);
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    void processImage(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    void processImage(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      className={`upload-field${isDragging ? " dragging" : ""}${previewUrl ? " has-image" : ""}`}
      onDragEnter={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setIsDragging(false);
        }
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      {previewUrl ? (
        <div className="image-preview">
          <img alt={imageName || "学习图片笔记"} src={previewUrl} />
          <div className="image-actions">
            <span>{imageName || "图片笔记"}</span>
            <div>
              <label className="small-icon-button" title="替换图片">
                <input
                  accept="image/jpeg,image/png,image/webp"
                  aria-label="替换图片"
                  onChange={handleInput}
                  type="file"
                />
                <ImagePlus aria-hidden="true" size={17} />
              </label>
              <button
                aria-label="移除图片"
                className="small-icon-button danger"
                onClick={() => void onChange({ file: null, removeImage: true })}
                title="移除图片"
                type="button"
              >
                <Trash2 aria-hidden="true" size={17} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <label className="upload-dropzone">
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="添加图片笔记"
            onChange={handleInput}
            type="file"
          />
          <span className="upload-icon" aria-hidden="true">
            {isDragging || isPreparing ? <Upload size={22} /> : <ImagePlus size={22} />}
          </span>
          <b>{isPreparing ? "正在整理图片" : isDragging ? "松手添加图片" : "添加图片笔记"}</b>
          <small>点击或拖入脑图、手写笔记、截图 · JPEG、PNG、WebP，最大 10MB</small>
        </label>
      )}
    </div>
  );
}
