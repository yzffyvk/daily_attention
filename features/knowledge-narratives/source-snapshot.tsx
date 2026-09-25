import { forwardRef } from "react";
import type { NarrativeSource } from "@/lib/domain/knowledge-narrative";
import { parseLearningReflections } from "@/lib/domain/learning-reflections";

/** Source content always comes from the saved snapshot, including structured personal reflections. */
export const SourceSnapshot = forwardRef<HTMLElement, { source: NarrativeSource; onClose?: () => void }>(function SourceSnapshot({ source, onClose }, ref) {
  const reflections = parseLearningReflections(source.inspiration);
  return <section className="narrative-source" role="region" aria-label={`来源快照 ${source.date}`} tabIndex={-1} ref={ref}>
    <div className="narrative-source-heading"><p className="eyebrow">生成时的来源快照</p>{onClose ? <button type="button" onClick={onClose}>收起来源</button> : null}</div>
    <time>{source.date} · 版本 {source.version}</time><h3>{source.attention}</h3>
    <h4>知识小结</h4><p>{source.summary || "当日未填写知识小结"}</p>
    <h4>我的理解与收获</h4>
    {reflections.insights || reflections.ideas ? <>
      {reflections.explanation ? <div><h5>用自己的话解释</h5><p>{reflections.explanation}</p></div> : null}
      {reflections.insights ? <div><h5>新的理解</h5><p>{reflections.insights}</p></div> : null}
      {reflections.ideas ? <div><h5>有趣的思想点</h5><p>{reflections.ideas}</p></div> : null}
    </> : <p>{reflections.explanation || "当日未填写理解与收获"}</p>}
    {source.sourceUrl ? <p className="narrative-source-url">资料来源：{source.sourceUrl}</p> : null}
    {source.hasImage ? <p className="knowledge-muted">当日有图片笔记；生成内容未读取图片正文。</p> : null}
  </section>;
});
