"use client";

import { Check, Copy, Download, X } from "lucide-react";
import { useState } from "react";

export function RecoveryCodeDialog({
  open,
  recoveryCode,
  name = "学习者",
  onClose,
}: {
  open: boolean;
  recoveryCode: string;
  name?: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  async function copyCode() {
    await navigator.clipboard?.writeText(recoveryCode);
    setCopied(true);
  }

  function downloadCode() {
    const blob = new Blob(
      [`今天你attention了吗？\n名称：${name}\n恢复码：${recoveryCode}\n`],
      { type: "text/plain;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "attention-recovery-code.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="auth-dialog-backdrop" role="presentation">
      <section className="auth-dialog" aria-labelledby="recovery-code-title" aria-modal="true" role="dialog">
        <div className="auth-dialog-heading">
          <div>
            <p className="eyebrow">KEEP IT SAFE</p>
            <h2 id="recovery-code-title">恢复码只显示这一次</h2>
          </div>
          <button aria-label="关闭恢复码" className="icon-button" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>
        <p className="auth-dialog-copy">请妥善保存。它可用于重设密码，关闭后无法再次查看。</p>
        <output className="recovery-code" aria-label="恢复码">{recoveryCode}</output>
        <div className="auth-dialog-actions">
          <button className="secondary-button" onClick={() => void copyCode()} type="button">
            {copied ? <Check aria-hidden="true" size={16} /> : <Copy aria-hidden="true" size={16} />}
            {copied ? "已复制" : "复制恢复码"}
          </button>
          <button className="secondary-button" onClick={downloadCode} type="button">
            <Download aria-hidden="true" size={16} />
            下载文本
          </button>
          <button className="primary-button" onClick={onClose} type="button">我已保存</button>
        </div>
      </section>
    </div>
  );
}
