"use client";

/* eslint-disable @next/next/no-img-element */
import { ImagePlus, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export type ImageSelection = {
  file: File | null;
  removeImage: boolean;
};

export type ImageCompressor = (file: File) => Promise<File>;

type ImageNoteUploaderProps = {
  identity: string;
  existingImage: { imageName: string; imageUrl: string | null } | null;
  file: File | null;
  removeImage: boolean;
  onChange: (selection: ImageSelection) => void | Promise<void>;
  onError: (message: string) => void;
  disabled?: boolean;
  compressImage?: ImageCompressor;
};

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 10 * 1024 * 1024;

export async function compressImage(file: File) {
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

type ImageNoteUploaderSessionProps = Omit<ImageNoteUploaderProps, "identity">;

export function ImageNoteUploader({ identity, ...props }: ImageNoteUploaderProps) {
  return <ImageNoteUploaderSession key={identity} {...props} />;
}

function ImageNoteUploaderSession({
  existingImage,
  file,
  removeImage,
  onChange,
  onError,
  disabled = false,
  compressImage: compress = compressImage,
}: ImageNoteUploaderSessionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [filePreview, setFilePreview] = useState<{ file: File; url: string } | null>(null);
  const filePreviewRef = useRef<{ file: File; url: string } | null>(null);
  const lifecycleRef = useRef({
    disabled,
    generation: 0,
    mounted: false,
  });
  const lastDisabledRef = useRef(disabled);

  function revokeFilePreview() {
    if (!filePreviewRef.current) return;
    URL.revokeObjectURL(filePreviewRef.current.url);
    filePreviewRef.current = null;
  }

  useEffect(() => {
    const lifecycle = lifecycleRef.current;
    lifecycle.mounted = true;
    return () => {
      lifecycle.mounted = false;
      lifecycle.generation += 1;
      revokeFilePreview();
    };
  }, []);

  useEffect(() => {
    if (!file) revokeFilePreview();
  }, [file]);

  useLayoutEffect(() => {
    const lifecycle = lifecycleRef.current;
    lifecycle.disabled = disabled;
    lifecycle.generation += 1;
  }, [disabled]);

  useEffect(() => {
    if (lastDisabledRef.current === disabled) return;
    lastDisabledRef.current = disabled;
    const timer = window.setTimeout(() => {
      setIsDragging(false);
      setIsPreparing(false);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [disabled]);

  const previewUrl =
    file && filePreview?.file === file
      ? filePreview.url
      : !removeImage
        ? existingImage?.imageUrl ?? null
        : null;
  const imageName = file?.name ?? (!removeImage ? existingImage?.imageName ?? "" : "");
  const isActiveDrag = isDragging && !disabled;
  const isActivePreparation = isPreparing && !disabled;

  function isCurrent(generation: number) {
    const lifecycle = lifecycleRef.current;
    return (
      lifecycle.mounted &&
      !lifecycle.disabled &&
      lifecycle.generation === generation
    );
  }

  async function processImage(nextFile?: File) {
    if (!nextFile || disabled) return;
    if (!acceptedTypes.has(nextFile.type) || nextFile.size > maxImageBytes) {
      onError("请选择 10MB 以内的 JPEG、PNG 或 WebP 图片");
      return;
    }

    const generation = lifecycleRef.current.generation + 1;
    lifecycleRef.current.generation = generation;
    setIsPreparing(true);
    try {
      const compressed = await compress(nextFile);
      const preview = {
        file: compressed,
        url: URL.createObjectURL(compressed),
      };
      if (!isCurrent(generation)) {
        URL.revokeObjectURL(preview.url);
        return;
      }
      revokeFilePreview();
      filePreviewRef.current = preview;
      setFilePreview(preview);
      await onChange({ file: compressed, removeImage: false });
      if (!isCurrent(generation) && filePreviewRef.current === preview) {
        revokeFilePreview();
        setFilePreview(null);
      }
    } catch {
      if (!isCurrent(generation)) return;
      revokeFilePreview();
      setFilePreview(null);
      onError("图片读取失败，请换一张重试");
    } finally {
      if (isCurrent(generation)) setIsPreparing(false);
    }
  }

  function handleRemoveImage() {
    lifecycleRef.current.generation += 1;
    revokeFilePreview();
    setFilePreview(null);
    setIsDragging(false);
    setIsPreparing(false);
    void onChange({ file: null, removeImage: true });
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (!disabled) void processImage(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (!disabled) void processImage(event.dataTransfer.files?.[0]);
  }

  return (
    <div
      className={`upload-field${isActiveDrag ? " dragging" : ""}${previewUrl ? " has-image" : ""}`}
      aria-busy={isActivePreparation}
      aria-disabled={disabled}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={(event) => {
        if (!disabled && !event.currentTarget.contains(event.relatedTarget as Node)) {
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
                  disabled={disabled}
                  onChange={handleInput}
                  type="file"
                />
                <ImagePlus aria-hidden="true" size={17} />
              </label>
              <button
                aria-label="移除图片"
                className="small-icon-button danger"
                disabled={disabled}
                onClick={handleRemoveImage}
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
            disabled={disabled}
            onChange={handleInput}
            type="file"
          />
          <span className="upload-icon" aria-hidden="true">
            {isActiveDrag || isActivePreparation ? <Upload size={22} /> : <ImagePlus size={22} />}
          </span>
          <b>{isActivePreparation ? "正在整理图片" : isActiveDrag ? "松手添加图片" : "添加图片笔记"}</b>
          <small>点击或拖入脑图、手写笔记、截图 · JPEG、PNG、WebP，最大 10MB</small>
        </label>
      )}
    </div>
  );
}
