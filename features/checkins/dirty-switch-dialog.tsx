"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

type DirtySwitchDialogProps = {
  title: string;
  eyebrow?: string;
  description: string;
  saveLabel: string;
  discardLabel: string;
  saveDisabled?: boolean;
  onSave: () => void | Promise<void>;
  onDiscard: () => void | Promise<void>;
  onCancel: () => void;
};

export function DirtySwitchDialog({
  title,
  eyebrow = "UNSAVED ATTENTION",
  description,
  saveLabel,
  discardLabel,
  saveDisabled = false,
  onSave,
  onDiscard,
  onCancel,
}: DirtySwitchDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => {
      saveButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      priorFocusRef.current?.focus();
    };
  }, [onCancel]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        aria-label={title}
        aria-modal="true"
        className="switch-dialog"
        ref={dialogRef}
        role="dialog"
      >
        <button
          aria-label="关闭"
          className="dialog-close icon-button"
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p>{description}</p>
        <div className="dialog-actions">
          <button
            className="primary-button"
            disabled={saveDisabled}
            onClick={() => void onSave()}
            ref={saveButtonRef}
            type="button"
          >
            {saveLabel}
          </button>
          <button
            className="secondary-button"
            onClick={() => void onDiscard()}
            type="button"
          >
            {discardLabel}
          </button>
          <button className="text-button" onClick={onCancel} type="button">
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
