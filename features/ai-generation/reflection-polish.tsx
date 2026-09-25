"use client";

import { Check, LoaderCircle, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ReflectionPolishInput, ReflectionPolishResult } from "@/lib/domain/reflection-polish";
import { ApiError } from "@/features/checkins/api";
import { polishReflection } from "./api";

type Props = {
  input: ReflectionPolishInput;
  disabled?: boolean;
  canApply: (answer: string) => boolean;
  onApply: (answer: string) => boolean;
};
type SuggestionState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; result: ReflectionPolishResult };

// A new input snapshot mounts a fresh request, so late responses cannot replace newer writing.
function PolishSuggestion({ input, disabled, canApply, onApply }: Props) {
  const [state, setState] = useState<SuggestionState>({ status: "idle" });
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function generate() {
    if (disabled || request.current || !input.answer.trim() || !input.summary.trim() || input.maxLength < 1) return;
    const controller = new AbortController();
    request.current = controller;
    setState({ status: "loading" });
    try {
      const result = await polishReflection(input, controller.signal);
      if (!controller.signal.aborted) setState({ status: "ready", result });
    } catch (error) {
      if (!controller.signal.aborted) setState({ status: "error", message: error instanceof ApiError ? error.message : "润色暂时失败，请稍后重试。" });
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  const loading = state.status === "loading";
  const result = state.status === "ready" ? state.result : null;
  const fits = result ? canApply(result.polishedAnswer) : true;
  const unavailable = !input.answer.trim() ? "先写下自己的解释，再让 AI 帮你理顺表达。"
    : !input.summary.trim() ? "有了知识总结，AI 才能结合知识点给出建议。"
    : input.maxLength < 1 ? "其他栏目已用完字数额度，请先减少内容。"
    : "结合知识总结润色表达，采纳前保留你的原文。";

  return <div className="reflection-polish">
    <div className="reflection-polish-toolbar">
      <p>{unavailable}</p>
      <div className="reflection-polish-buttons">
        <button className="reflection-polish-trigger" type="button" disabled={disabled || loading || !input.answer.trim() || !input.summary.trim() || input.maxLength < 1} onClick={() => void generate()}>
          {loading ? <LoaderCircle aria-hidden="true" size={15} className="polish-spinner" /> : <Sparkles aria-hidden="true" size={15} />}
          {loading ? "正在润色…" : "AI 润色"}
        </button>
        {loading ? <button type="button" className="reflection-polish-plain" onClick={() => { request.current?.abort(); request.current = null; setState({ status: "idle" }); }}>取消润色</button> : null}
      </div>
    </div>
    {loading ? <p className="reflection-polish-status" role="status">正在结合知识点整理建议，你可以继续编辑。</p> : null}
    {state.status === "error" ? <p className="reflection-polish-error" role="alert">{state.message}</p> : null}
    {result ? <section className="reflection-polish-suggestion" aria-label="AI 润色建议">
      <div className="reflection-polish-heading"><Sparkles aria-hidden="true" size={17} /><h4>建议这样表达</h4><span>AI 润色建议</span></div>
      {result.knowledgePoints.length ? <ul className="reflection-polish-concepts" aria-label="涉及的知识点">{result.knowledgePoints.map((point, index) => <li key={index}>{point}</li>)}</ul> : null}
      <p className="reflection-polish-answer">{result.polishedAnswer}</p>
      {result.improvements.length ? <div className="reflection-polish-notes"><h5>调整了什么</h5><ul>{result.improvements.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
      {result.cautions.length ? <div className="reflection-polish-cautions"><h5>知识上的提醒</h5><ul>{result.cautions.map((item, index) => <li key={index}>{item}</li>)}</ul></div> : null}
      {!fits ? <p className="reflection-polish-error" role="alert">建议超出了三个栏目的剩余字数，请减少其他内容后重新润色。</p> : null}
      <div className="reflection-polish-actions">
        <p>采纳后仍可修改，保存记录后生效。</p>
        <button type="button" className="reflection-polish-plain" onClick={() => setState({ status: "idle" })}>保留原文</button>
        <button type="button" className="reflection-polish-accept" disabled={disabled || !fits} onClick={() => { if (onApply(result.polishedAnswer)) setState({ status: "idle" }); }}><Check aria-hidden="true" size={16} />采纳建议</button>
      </div>
    </section> : null}
  </div>;
}

export function ReflectionPolish(props: Props) {
  const { input, disabled, canApply, onApply } = props;
  const [adopted, setAdopted] = useState<{ before: string; after: string; summary: string; topic: string } | null>(null);
  const canUndo = adopted && adopted.after === input.answer && adopted.summary === input.summary && adopted.topic === input.topic;
  return <>
    <PolishSuggestion {...props} key={JSON.stringify(input)} onApply={answer => {
      if (!onApply(answer)) return false;
      setAdopted({ before: input.answer, after: answer, summary: input.summary, topic: input.topic });
      return true;
    }} />
    {canUndo ? <div className="reflection-polish-adopted">
      <p role="status">已采纳润色，保存记录后生效。</p>
      <button type="button" className="reflection-polish-plain" disabled={disabled || !canApply(adopted.before)} onClick={() => { if (onApply(adopted.before)) setAdopted(null); }}><Undo2 aria-hidden="true" size={14} />撤销本次润色</button>
    </div> : null}
  </>;
}
