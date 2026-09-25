"use client";

import { useEffect, useRef, useState } from "react";
import type { KnowledgeNarrative } from "@/lib/domain/knowledge-narrative";
import type { ConceptMapResult, KnowledgeConcept, KnowledgeMapResult } from "@/lib/domain/knowledge-map";
import { SourceSnapshot } from "./source-snapshot";

const provenance = { record: "记录依据", inference: "基于记录推断", ai_supplement: "AI 补充" };
const conceptKinds = { concept: "概念", principle: "原理", method: "方法", example: "示例", condition: "条件" };
const organizations = { hierarchy: "层次结构", process: "过程结构", comparison: "对照结构" };

function Origin({ origin }: { origin: keyof typeof provenance }) {
  return <span className={`map-origin map-origin-${origin}`}>{provenance[origin]}</span>;
}

function RelationArrow() {
  return <svg className="map-relation-arrow" aria-hidden="true" viewBox="0 0 20 12"><path d="M0 6 H18 M13 1 L18 6 L13 11" fill="none" stroke="currentColor" strokeWidth="1" /></svg>;
}

function focusSourcePanel(panel: HTMLElement | null) {
  panel?.focus({ preventScroll: true });
  panel?.scrollIntoView?.({ block: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
}

function ConceptGraph({ result, selectedId, onSelect }: { result: ConceptMapResult; selectedId: string; onSelect: (id: string) => void }) {
  const concepts = new Map(result.concepts.map(concept => [concept.id, concept]));
  return <section className="concept-graph" role="region" aria-label="概念关系图">
    <div className="map-root"><p className="eyebrow">围绕一个问题</p><h3>{result.focusQuestion}</h3><span className="map-organization">{organizations[result.organization]}</span></div>
    <div className="map-branches">
      {result.branches.map(branch => <section className="map-branch" key={branch.id}>
        <header><h4>{branch.title}</h4><p>{branch.summary}</p></header>
        <ul className="map-concepts">
          {result.concepts.filter(concept => concept.branchId === branch.id).map(concept => <li className="map-concept" key={concept.id}>
            <button type="button" className="map-node" aria-label={`查看概念 ${concept.label}`} aria-pressed={selectedId === concept.id} onClick={() => onSelect(concept.id)}>
              <strong>{concept.label}</strong><Origin origin={concept.origin} />
            </button>
            {result.connections.filter(edge => edge.fromId === concept.id).map(edge => <div className="map-edge" key={edge.toId}>
              <div className="map-edge-label"><span>{edge.relation}</span><Origin origin={edge.origin} /></div>
              <RelationArrow />
              <button type="button" className="map-edge-target" aria-label={`定位概念 ${concepts.get(edge.toId)?.label}`} onClick={() => onSelect(edge.toId)}>{concepts.get(edge.toId)?.label}<span aria-hidden="true"> ↗</span></button>
            </div>)}
          </li>)}
        </ul>
      </section>)}
    </div>
    <p className="map-graph-hint">选择概念，阅读具体解释；箭头旁的文字说明两个概念如何相连。</p>
  </section>;
}

export function KnowledgeMapReader({ narrative, result }: { narrative: KnowledgeNarrative; result: KnowledgeMapResult }) {
  const [selectedId, setSelectedId] = useState(() => result.mode === "concept_map" ? (result.concepts.find(concept => concept.origin === "record") ?? result.concepts[0]).id : "");
  const [sourceDate, setSourceDate] = useState<string | null>(null);
  const sourceRef = useRef<HTMLElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const citationRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!sourceDate) return;
    focusSourcePanel(sourceRef.current);
  }, [sourceDate]);

  function revealSource(date: string) {
    citationRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (date === sourceDate) focusSourcePanel(sourceRef.current);
    setSourceDate(date);
  }

  function citations(dates: string[], label = "引用来源") {
    return <div className="narrative-citations map-citations" role="group" aria-label={label}>{dates.map(date => <button key={date} type="button" aria-label={`查看来源 ${date}`} onClick={() => revealSource(date)}>{date}</button>)}</div>;
  }

  if (result.mode === "source_records") return <article className="source-records-reader narrative-scroll" aria-label="原始学习记录">
    <div className="source-records-intro"><p className="eyebrow">先保留每一天的原貌</p><h3>{result.reason === "mixed_topics" ? "这些记录涉及不同主题" : "当前材料还不足以形成清晰关系"}</h3><p>{result.reason === "mixed_topics" ? "按日期阅读保存时的原始记录，分别理解每个主题。" : "先回看保存时的原始记录，补充具体理解后再尝试串联。"}</p></div>
    {[...result.sourceDates].sort().map(date => {
      const source = narrative.sources.find(item => item.date === date);
      return source ? <SourceSnapshot key={date} source={source} /> : null;
    })}
  </article>;

  const selected: KnowledgeConcept = result.concepts.find(concept => concept.id === selectedId) ?? result.concepts.find(concept => concept.origin === "record") ?? result.concepts[0];
  const source = narrative.sources.find(item => item.date === sourceDate);
  const concepts = new Map(result.concepts.map(concept => [concept.id, concept]));
  function selectConcept(id: string, revealDetail: boolean) {
    setSelectedId(id);
    if (!revealDetail) return;
    requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" });
    });
  }
  function selectFromGraph(id: string) {
    const narrow = window.matchMedia?.("(max-width: 800px)").matches ?? window.innerWidth <= 800;
    selectConcept(id, narrow);
  }

  return <div className="knowledge-map-reader">
    <p className="map-overview">{result.overview}</p>
    <div className="map-exploration">
      <ConceptGraph result={result} selectedId={selected.id} onSelect={selectFromGraph} />
      <section className="map-detail" role="region" aria-label="概念详情" ref={detailRef} tabIndex={-1}>
        <p className="eyebrow">{conceptKinds[selected.kind]}</p><h3>{selected.label}</h3><Origin origin={selected.origin} />
        <p className="map-detail-explanation">{selected.explanation}</p>
        {selected.origin === "ai_supplement" ? <div className="map-supplement-reason"><h4>为什么补充这个概念</h4><p>{selected.supplementReason}</p><p className="knowledge-muted">这是 AI 提供的补充概念，没有对应的原始记录日期。</p></div> : citations(selected.sourceDates)}
      </section>
    </div>
    <section className="map-relationships" role="region" aria-label="关系说明"><h3>关系说明</h3><p className="map-section-note">对照记录依据与推断，理解每一条联系。</p>
      {result.connections.map(edge => <article className="map-relationship" key={`${edge.fromId}-${edge.toId}`}>
        <div className="map-relationship-title"><span>{concepts.get(edge.fromId)?.label}</span><span aria-hidden="true"> → </span><span>{concepts.get(edge.toId)?.label}</span></div>
        <h4>{edge.relation}</h4><Origin origin={edge.origin} /><p>{edge.explanation}</p>{edge.origin !== "ai_supplement" ? citations(edge.sourceDates) : null}
      </article>)}
    </section>
    <section className="map-outline" role="region" aria-label="讲述提纲"><h3>讲述提纲</h3><p className="map-section-note">沿用图中的概念，试着把理解讲清楚。</p>
      <ol>{result.outline.map((step, index) => <li key={index}><h4>{step.title}</h4><p>{step.body}</p><div className="map-outline-concepts">{step.conceptIds.map(id => <button key={id} type="button" aria-label={`查看概念 ${concepts.get(id)?.label}`} aria-pressed={selected.id === id} onClick={() => selectConcept(id, true)}>{concepts.get(id)?.label}{concepts.get(id)?.origin === "ai_supplement" ? <Origin origin="ai_supplement" /> : null}</button>)}</div></li>)}</ol>
    </section>
    {result.gaps.length ? <section className="map-gaps"><h3>待探索的部分</h3><ul>{result.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></section> : null}
    <section className="map-all-sources"><h3>回看全部原始来源</h3>{citations([...narrative.dates].sort(), "全部来源日期")}</section>
    {source ? <SourceSnapshot source={source} ref={sourceRef} onClose={() => { setSourceDate(null); citationRef.current?.focus(); }} /> : null}
  </div>;
}
