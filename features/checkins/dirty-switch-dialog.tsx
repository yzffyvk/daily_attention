"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

type DialogFocusProps = {
  dialogRef: React.RefObject<HTMLElement | null>;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  onClose: () => void;
};

function focusableElements(dialog: HTMLElement) {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(
      'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.matches(":disabled") && element.tabIndex >= 0);
}

function focusIfEnabled(element: HTMLElement | null | undefined) {
  if (!element || element.matches(":disabled") || element.tabIndex < 0) return false;
  element.focus();
  return document.activeElement === element;
}

export function useDialogFocus({
  dialogRef,
  initialFocusRef,
  onClose,
}: DialogFocusProps) {
  const dialogRefRef = useRef(dialogRef);
  const initialFocusRefRef = useRef(initialFocusRef);
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    priorFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRefRef.current.current;
      if (!dialog) return;
      if (focusIfEnabled(initialFocusRefRef.current?.current)) return;
      focusableElements(dialog)[0]?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRefRef.current.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(dialog);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      focusIfEnabled(priorFocusRef.current);
    };
  }, []);
}

type DirtySwitchDialogProps = {
  title: string;
  eyebrow?: string;
  description: string;
  saveLabel: string;
  discardLabel: string;
  saveDisabled?: boolean;
  isBusy?: boolean;
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
  isBusy = false,
  onSave,
  onDiscard,
  onCancel,
}: DirtySwitchDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const discardButtonRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({
    dialogRef,
    initialFocusRef: saveDisabled || isBusy ? discardButtonRef : saveButtonRef,
    onClose: onCancel,
  });

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
          disabled={isBusy}
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
            disabled={saveDisabled || isBusy}
            onClick={() => void onSave()}
            ref={saveButtonRef}
            type="button"
          >
            {saveLabel}
          </button>
          <button
            className="secondary-button"
            disabled={isBusy}
            onClick={() => void onDiscard()}
            ref={discardButtonRef}
            type="button"
          >
            {discardLabel}
          </button>
          <button className="text-button" disabled={isBusy} onClick={onCancel} type="button">
            取消
          </button>
        </div>
      </section>
    </div>
  );
}
