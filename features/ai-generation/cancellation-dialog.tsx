"use client";

import { X } from "lucide-react";
import { useRef } from "react";
import { useDialogFocus } from "@/features/checkins/dirty-switch-dialog";

export function CancellationDialog({ isBusy, onContinue, onConfirm }: {
  isBusy: boolean;
  onContinue(): void;
  onConfirm(): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  useDialogFocus({ dialogRef, initialFocusRef: continueRef, onClose: () => { if (!isBusy) onContinue(); } });

  return <div className="dialog-backdrop" role="presentation">
    <section className="switch-dialog ai-cancellation-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-cancellation-title" aria-describedby="ai-cancellation-description" ref={dialogRef}>
      <button className="dialog-close icon-button" type="button" aria-label="关闭" disabled={isBusy} onClick={onContinue}><X aria-hidden="true" size={18} /></button>
      <p className="eyebrow">AI 提炼</p>
      <h2 id="ai-cancellation-title">取消将消耗 1 次额度</h2>
      <p id="ai-cancellation-description">今日生成开始后的 2 次免费取消已用完。确认取消将保留本次已占用的 1 次提炼额度，不会重复扣除；此前小结与编辑内容会保留。</p>
      <div className="dialog-actions">
        <button className="primary-button" type="button" ref={continueRef} disabled={isBusy} onClick={onContinue}>继续生成</button>
        <button className="secondary-button" type="button" disabled={isBusy} onClick={onConfirm}>{isBusy ? "正在取消…" : "确认取消并消耗 1 次额度"}</button>
      </div>
    </section>
  </div>;
}
