"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiGenerationProgress } from "@/lib/domain/ai-progress";
import type { AiGenerationController } from "./use-ai-generation";

type Props = {
  stage: AiGenerationController["stage"];
  progress: AiGenerationProgress | null;
  attemptCount?: number;
  retryMessage?: string;
  createdAt?: string;
  isLongRunning: boolean;
  error: string;
};

export function GenerationProgress({ stage, progress, attemptCount = 0, retryMessage = "", createdAt, isLongRunning, error }: Props) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const [following, setFollowing] = useState(true);
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (following && previewRef.current) previewRef.current.scrollTop = previewRef.current.scrollHeight;
  }, [progress?.preview, following]);

  const phase = progress?.phase;
  const currentStep = stage === "generating" ? phase === "validating" || phase === "repairing" ? 3 : 2 : stage === "fetching" ? 1 : 0;
  const title = stage === "creating" ? "正在创建提炼任务"
    : stage === "queued" ? "已排队，等待开始"
    : stage === "fetching" ? "正在读取并整理资料"
    : stage === "retrying" ? "本轮未完成，准备自动重试"
    : phase === "repairing" ? "正在修正格式与原文引用"
    : phase === "validating" ? "正在校验并整理知识骨架"
    : progress?.preview ? "正在生成知识小结"
    : "AI 正在组织内容，等待首段正文";
  const seconds = Math.max(0, Math.floor((now - (createdAt ? Date.parse(createdAt) : startedAt)) / 1000));
  const elapsed = seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
  const retryNotice = stage === "retrying"
    ? `准备第 ${attemptCount + 1} 轮尝试。${retryMessage || "上一轮未完成，系统将自动重试。"}`
    : attemptCount > 1 ? `第 ${attemptCount} 轮尝试。${retryMessage || "上一轮未完成，正在重新处理。"}` : "";

  return (
    <section className="ai-live-progress" aria-label="AI 提炼进度">
      <div className="ai-live-heading">
        <span className="ai-live-title" role="status"><LoaderCircle size={17} className="ai-live-spinner" aria-hidden="true" />{title}</span>
        <span className="ai-live-time">已等待 {elapsed}</span>
      </div>
      {retryNotice ? <p className="ai-live-hint">{retryNotice}</p> : null}
      <ol className="ai-live-steps" aria-label="提炼步骤">
        {["任务排队", "读取资料", "生成正文", "校验整理"].map((label, index) => (
          <li key={label} className={index < currentStep ? "done" : index === currentStep ? "current" : ""} aria-current={index === currentStep ? "step" : undefined}>
            <span aria-hidden="true">{index < currentStep ? <Check size={12} /> : index + 1}</span>{label}
          </li>
        ))}
      </ol>
      {stage === "generating" && phase === "repairing" ? <p className="ai-live-hint">当前输出尚未通过校验，正在自动修正。修正时会重新输出正文，完成后再次校验。</p> : null}
      {stage === "generating" && phase === "validating" ? <p className="ai-live-hint">正文已返回，正在检查结构、内容完整性与原文引用；需要修正时会继续生成。</p> : null}
      {progress?.preview ? <>
        <div className="ai-live-preview-heading"><strong>实时输出</strong><span>生成中，校验完成后可编辑</span></div>
        <div className="ai-live-preview" ref={previewRef} tabIndex={0} role="region" aria-label="正在生成的知识小结" onScroll={event => {
          const node = event.currentTarget;
          setFollowing(node.scrollHeight - node.scrollTop - node.clientHeight < 48);
        }}>{progress.preview}<span className="ai-live-caret" aria-hidden="true" /></div>
        {!following ? <button className="ai-live-follow" type="button" onClick={() => setFollowing(true)}>查看最新输出 ↓</button> : null}
      </> : <p className="ai-live-empty">{stage === "retrying" ? "本轮未完成的预览已清除，重试开始后将继续显示。" : "正文返回后会在这里逐步显示，可以先阅读已生成的内容。"}</p>}
      {isLongRunning ? <p className="ai-live-hint">这篇资料处理时间较长，任务仍在继续，页面会持续更新。</p> : null}
      {error ? <p className="ai-live-error" role="alert">进度更新暂时中断，正在重新连接。{error}</p> : null}
    </section>
  );
}
