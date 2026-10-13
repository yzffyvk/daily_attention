"use client";

import { ListOrdered } from "lucide-react";
import { useRef, useState } from "react";

type SummaryEditorProps = {
  disabled: boolean;
  id: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
};

type SummaryFont = "sans" | "serif" | "mono";
type SummarySize = "small" | "medium" | "large";

const orderedPrefixPattern = /^\s*\d+[.)、]\s*/u;

export function SummaryEditor({
  disabled,
  id,
  onChange,
  placeholder,
  value,
}: SummaryEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [font, setFont] = useState<SummaryFont>("sans");
  const [size, setSize] = useState<SummarySize>("medium");

  function addOrderedPrefixes() {
    const textarea = textareaRef.current;
    if (!textarea || disabled) return;

    const lineStart = value.lastIndexOf("\n", Math.max(0, textarea.selectionStart - 1)) + 1;
    const nextLineBreak = value.indexOf("\n", textarea.selectionEnd);
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    const selectedBlock = value.slice(lineStart, lineEnd);
    const numberedBlock = selectedBlock
      .split("\n")
      .map((line, index) => `${index + 1}. ${line.replace(orderedPrefixPattern, "")}`)
      .join("\n");
    const nextValue = `${value.slice(0, lineStart)}${numberedBlock}${value.slice(lineEnd)}`;

    onChange(nextValue);
    window.requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(lineStart, lineStart + numberedBlock.length);
    });
  }

  return (
    <div className="summary-editor">
      <div aria-label="知识小结格式工具" className="summary-toolbar" role="toolbar">
        <label className="summary-toolbar-select">
          <span>字体</span>
          <select
            aria-label="知识小结字体"
            disabled={disabled}
            onChange={(event) => setFont(event.target.value as SummaryFont)}
            value={font}
          >
            <option value="sans">无衬线</option>
            <option value="serif">衬线</option>
            <option value="mono">等宽</option>
          </select>
        </label>

        <label className="summary-toolbar-select">
          <span>字号</span>
          <select
            aria-label="知识小结字号"
            disabled={disabled}
            onChange={(event) => setSize(event.target.value as SummarySize)}
            value={size}
          >
            <option value="small">小</option>
            <option value="medium">标准</option>
            <option value="large">大</option>
          </select>
        </label>

        <span aria-hidden="true" className="summary-toolbar-divider" />

        <button
          aria-label="添加前置序号"
          disabled={disabled}
          onClick={addOrderedPrefixes}
          title="为选中的行添加前置序号"
          type="button"
        >
          <ListOrdered aria-hidden="true" size={17} />
        </button>
      </div>

      <textarea
        className={`summary-textarea summary-font-${font} summary-size-${size}`}
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        ref={textareaRef}
        value={value}
      />
    </div>
  );
}
