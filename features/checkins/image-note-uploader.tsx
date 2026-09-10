"use client";

import { ImagePlus, Trash2, Upload } from "lucide-react";
import type { ChangeEvent, DragEvent } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImageNoteViewer } from "./image-note-viewer";

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
  onPreparationChange?: (isPreparing: boolean) => void;
  isPreparing?: boolean;
  disabled?: boolean;
  compressImage?: ImageCompressor;
};

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxImageBytes = 10 * 1024 * 1024;
const targetImageBytes = 2 * 1024 * 1024;
const maxImageDimension = 1600;
const outputQualities = [0.86, 0.74, 0.62, 0.5] as const;
const outputScales = [1, 0.82, 0.66, 0.52, 0.4] as const;
const overTargetMessage = "图片压缩后仍超过 2MB，请选择更小或内容更简单的图片";

export class ImagePreparationError extends Error {
  constructor(message = overTargetMessage) {
    super(message);
    this.name = "ImagePreparationError";
  }
}

export async function compressImage(file: File) {
  if (
    typeof Image === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    typeof document === "undefined"
  ) {
    if (file.size <= targetImageBytes) return file;
    throw new ImagePreparationError();
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("无法读取图片"));
    });

    const sourceMaxEdge = Math.max(image.width, image.height);
    if (sourceMaxEdge <= 0) throw new Error("无法读取图片");
    const initialScale = Math.min(1, maxImageDimension / sourceMaxEdge);
    if (initialScale === 1 && file.size <= targetImageBytes) return file;

    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法处理图片");
    const fileName = file.name.replace(/\.[^.]+$/u, "") || "image";
    const initialWidth = Math.max(1, Math.round(image.width * initialScale));
    const initialHeight = Math.max(1, Math.round(image.height * initialScale));
    let encodedAtLeastOnce = false;

    for (const outputScale of outputScales) {
      canvas.width = Math.max(1, Math.round(initialWidth * outputScale));
      canvas.height = Math.max(1, Math.round(initialHeight * outputScale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      for (const quality of outputQualities) {
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", quality);
        });
        if (!blob) continue;
        encodedAtLeastOnce = true;
        if (blob.size <= targetImageBytes) {
          return new File([blob], `${fileName}.jpg`, {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
        }
      }
    }

    if (!encodedAtLeastOnce) throw new Error("无法处理图片");
    throw new ImagePreparationError();
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
  onPreparationChange,
  isPreparing: isPreparingFromParent = false,
  disabled = false,
  compressImage: compress = compressImage,
}: ImageNoteUploaderSessionProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isPreparingLocally, setIsPreparingLocally] = useState(false);
  const [filePreview, setFilePreview] = useState<{ file: File; url: string } | null>(null);
  const filePreviewRef = useRef<{ file: File; url: string } | null>(null);
  const isPreparingRef = useRef(false);
  const onPreparationChangeRef = useRef(onPreparationChange);
  const lifecycleRef = useRef({
    disabled,
    generation: 0,
    mounted: false,
  });
  const lastDisabledRef = useRef(disabled);

  useEffect(() => {
    onPreparationChangeRef.current = onPreparationChange;
  }, [onPreparationChange]);

  function setPreparation(nextPreparing: boolean) {
    if (isPreparingRef.current === nextPreparing) return;
    isPreparingRef.current = nextPreparing;
    if (lifecycleRef.current.mounted) setIsPreparingLocally(nextPreparing);
    onPreparationChangeRef.current?.(nextPreparing);
  }

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
      setPreparation(false);
      revokeFilePreview();
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!file) {
        revokeFilePreview();
        setFilePreview(null);
        return;
      }
      if (filePreviewRef.current?.file === file) return;

      revokeFilePreview();
      const preview = {
        file,
        url: URL.createObjectURL(file),
      };
      filePreviewRef.current = preview;
      setFilePreview(preview);
    }, 0);
    return () => window.clearTimeout(timer);
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
      if (disabled) setPreparation(false);
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
  const isActivePreparation = (isPreparingFromParent || isPreparingLocally) && !disabled;

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
    setPreparation(true);
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
    } catch (error) {
      if (!isCurrent(generation)) return;
      revokeFilePreview();
      setFilePreview(null);
      onError(
        error instanceof Error && error.name === "ImagePreparationError"
          ? error.message
          : "图片读取失败，请换一张重试",
      );
    } finally {
      if (isCurrent(generation)) setPreparation(false);
    }
  }

  function handleRemoveImage() {
    lifecycleRef.current.generation += 1;
    revokeFilePreview();
    setFilePreview(null);
    setIsDragging(false);
    setPreparation(false);
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
          <ImageNoteViewer key={previewUrl} name={imageName} src={previewUrl} />
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
          <b aria-live={isActivePreparation ? "polite" : undefined} role={isActivePreparation ? "status" : undefined}>
            {isActivePreparation ? "正在整理图片，请稍候" : isActiveDrag ? "松手添加图片" : "添加图片笔记"}
          </b>
          <small>点击或拖入脑图、手写笔记、截图 · JPEG、PNG、WebP，最大 10MB</small>
        </label>
      )}
    </div>
  );
}
