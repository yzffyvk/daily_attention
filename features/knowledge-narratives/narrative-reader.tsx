"use client";

import { useRef, useState } from "react";
import type { KnowledgeNarrative, LegacyNarrativeResult } from "@/lib/domain/knowledge-narrative";
import { KnowledgeMapReader } from "./knowledge-map-reader";
import { SourceSnapshot } from "./source-snapshot";

export function NarrativeReader({ narrative }: { narrative: KnowledgeNarrative }) {
  if (!narrative.result) return null;
  if ("schemaVersion" in narrative.result) return <KnowledgeMapReader key={narrative.id} narrative={narrative} result={narrative.result} />;
  return <LegacyNarrativeReader key={narrative.id} narrative={narrative} result={narrative.result} />;
}

function LegacyNarrativeReader({ narrative, result }: { narrative: KnowledgeNarrative; result: LegacyNarrativeResult }) {
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const sourceRef = useRef<HTMLElement>(null);
  const citationRef = useRef<HTMLElement | null>(null);
  const source = narrative.sources.find(item => item.date === sourceDate);

  function revealSource(date: string) {
    citationRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSourceDate(date);
    requestAnimationFrame(() => {
      sourceRef.current?.focus({ preventScroll: true });
      sourceRef.current?.scrollIntoView?.({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    });
  }

  function citations(dates: string[]) {
    return <div className="narrative-citations" aria-label="引用来源">{dates.map(date => <button key={date} type="button" onClick={() => revealSource(date)} aria-label={`查看来源 ${date}`}>{date}</button>)}</div>;
  }

  return (
    <div className="narrative-reading-layout">
      <nav aria-label="知识流" className="knowledge-flow">
        <p className="eyebrow">学习如何相连</p>
        <ol>
          {[...result.nodes].sort((a, b) => a.date.localeCompare(b.date)).map(node => (
            <li className="knowledge-flow-node" key={node.date}>
              <button className="knowledge-node-link" type="button" onClick={() => revealSource(node.date)} aria-label={`查看来源 ${node.date}`}>
                <time>{node.date}</time><strong>{node.label}</strong><span>{node.takeaway}</span>
              </button>
              {result.connections.filter(connection => connection.fromDate === node.date).map((connection, index) => (
                <div className="knowledge-connection" key={`${connection.toDate}-${index}`}>
                  <span>{connection.relation}<span aria-hidden="true"> → </span><time>{connection.toDate}</time></span>
                  <p>{connection.explanation}</p>
                </div>
              ))}
            </li>
          ))}
          <li className="knowledge-flow-terminal"><a href="#narrative-scroll">阅读完整脉络 <span aria-hidden="true">↗</span></a></li>
        </ol>
      </nav>
      <article className="narrative-scroll" id="narrative-scroll" aria-label="叙事长卷">
        <p className="eyebrow">从记录，到理解</p>
        <section className="narrative-overview"><h3>主线</h3><p>{result.overview}</p></section>
        {result.sections.map((section, index) => <section className="narrative-chapter" key={index}><h3>{section.title}</h3><p>{section.body}</p>{citations(section.sourceDates)}</section>)}
        <section className="narrative-framework"><h3>理解框架</h3>{result.framework.map((item, index) => <div key={index}><h4>{item.title}</h4><p>{item.body}</p>{citations(item.sourceDates)}</div>)}</section>
        {result.gaps.length ? <section><h3>知识缺口</h3><ul>{result.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></section> : null}
        {result.nextSteps.length ? <section><h3>下一步</h3><ul>{result.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ul></section> : null}
        {source ? <SourceSnapshot source={source} ref={sourceRef} onClose={() => { setSourceDate(null); citationRef.current?.focus(); }} /> : null}
      </article>
    </div>
  );
}
