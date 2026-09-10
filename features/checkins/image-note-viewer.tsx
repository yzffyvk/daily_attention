"use client";

/* eslint-disable @next/next/no-img-element */
import { Expand, ImageOff, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "./dirty-switch-dialog";

type ImageNoteViewerProps = { src: string; name: string };

// The uploader keys this viewer by URL, so replacing a file cannot leave a
// lightbox open with an obsolete (or revoked) local preview.
export function ImageNoteViewer({ src, name }: ImageNoteViewerProps) {
  const [open, setOpen] = useState(false);
  const label = name || "学习图片笔记";

  return (
    <>
      <button
        aria-label={`查看完整图片：${label}`}
        aria-haspopup="dialog"
        className="image-preview-trigger"
        onClick={() => setOpen(true)}
        type="button"
      >
        <img alt={label} src={src} />
        <span className="image-preview-hint" aria-hidden="true">
          <Expand size={14} />查看完整图片
        </span>
      </button>
      {open && <ImageLightbox src={src} name={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function ImageLightbox({ src, name, onClose }: ImageNoteViewerProps & { onClose: () => void }) {
  const descriptionId = useId();
  const backdropRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const background = Array.from(document.body.children)
      .filter((node): node is HTMLElement => node instanceof HTMLElement && node !== backdropRef.current)
      .map((node) => ({ node, inert: node.inert }));
    document.body.style.overflow = "hidden";
    for (const { node } of background) node.inert = true;
    return () => {
      document.body.style.overflow = previousOverflow;
      for (const { node, inert } of background) node.inert = inert;
    };
  }, []);

  // Restore background interaction before the shared hook restores focus.
  useDialogFocus({ dialogRef, onClose });

  return createPortal(
    <div
      className="image-lightbox-backdrop"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
      ref={backdropRef}
      role="presentation"
    >
      <section className="image-lightbox" ref={dialogRef} role="dialog" aria-modal="true" aria-label="图片笔记" aria-describedby={descriptionId}>
        <header className="image-lightbox-header">
          <div>
            <h2>图片笔记</h2>
            <p id={descriptionId}>{name}</p>
          </div>
          <button className="image-lightbox-close" aria-label="关闭图片预览" onClick={onClose} type="button">
            <X aria-hidden="true" size={22} />
          </button>
        </header>
        <div className="image-lightbox-stage">
          {failed ? (
            <p className="image-lightbox-error" role="status">
              <ImageOff aria-hidden="true" size={28} />
              <strong>图片加载失败</strong>
              <span>请关闭后重新打开；若仍无法显示，请刷新页面后重试。</span>
            </p>
          ) : (
            <img className="image-lightbox-image" src={src} alt={name} onError={() => setFailed(true)} />
          )}
        </div>
        <p className="image-lightbox-caption">完整图片 · 按 Esc 或点击背景关闭</p>
      </section>
    </div>,
    document.body,
  );
}
