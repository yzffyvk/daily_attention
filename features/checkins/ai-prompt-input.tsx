"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { AI_USER_PROMPT_LIMIT, type AiGenerationContext } from "@/lib/domain/ai-prompt";

export function AiPromptInput({ value, onChange, disabled, generationContext, hasSummary }: {
  value: string;
  onChange(value: string): void;
  disabled: boolean;
  generationContext?: AiGenerationContext | null;
  hasSummary: boolean;
}) {
  const id = useId();
  const [expanded, setExpanded] = useState(Boolean(value));
  const [previousValue, setPreviousValue] = useState(value);
  // Restored drafts arrive after mount; reveal their requirements without losing disclosure state on clear.
  if (previousValue !== value) {
    setPreviousValue(value);
    if (value) setExpanded(true);
  }
  const changed = hasSummary && generationContext != null && value.trim() !== generationContext.userPrompt;

  return (
    <div className="ai-prompt-field">
      <button className="ai-prompt-toggle" type="button" aria-expanded={expanded} aria-controls={`${id}-panel`} onClick={() => setExpanded(!expanded)}>
        <span>提炼要求 <small>选填</small></span>
        <ChevronDown aria-hidden="true" size={16} />
      </button>
      <div className="ai-prompt-panel" id={`${id}-panel`} hidden={!expanded}>
        <p className="ai-prompt-help" id={`${id}-hint`}>告诉 AI 你想重点理解什么、已有多少基础，以及希望怎样讲解。留空则按默认方式提炼。</p>
        <textarea
          id={`${id}-input`}
          aria-label="提炼要求"
          aria-describedby={`${id}-hint ${id}-count`}
          disabled={disabled}
          value={value}
          onChange={event => onChange(event.target.value)}
          maxLength={AI_USER_PROMPT_LIMIT}
          rows={4}
          placeholder="例如：我是刚接触 AI 的产品经理。重点解释工具调用和使用边界，先说明解决什么问题，再解释如何运作；少讲历史背景。"
        />
        <div className="ai-prompt-footer">
          <span>会保留资料的知识骨架，并按你的要求调整讲解。</span>
          <span id={`${id}-count`}>{value.length} / {AI_USER_PROMPT_LIMIT}</span>
        </div>
      </div>
      {changed ? <p className="ai-prompt-changed" role="status">提炼要求已修改，修改后重新提炼生效；当前总结仍使用上次的要求。</p> : null}
      {hasSummary && generationContext ? (
        <details className="ai-prompt-history">
          <summary>本次结果使用的要求</summary>
          <p>{generationContext.userPrompt || "未填写，按默认方式提炼。"}</p>
        </details>
      ) : null}
    </div>
  );
}
