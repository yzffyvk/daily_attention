import { useSyncExternalStore } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import type { DemoController } from "./theme-demo-api";
import "./demo.css";

export type DemoScenario = "ai" | "map" | "mixed";
export function DemoToolbar({ demo, scenario }: { demo: DemoController; scenario: DemoScenario }) {
  useSyncExternalStore(demo.subscribe, demo.getRevision, demo.getRevision);
  const titles = { ai: "从一篇文章，读出知识的骨架", map: "让几天的学习，连成一个框架", mixed: "主题不同，就让各自的收获保持完整" };
  const dates = scenario === "mixed" ? demo.dates.mixed : demo.dates.related;
  return <aside className="demo-guide" aria-label="假数据验收指南">
    <div className="demo-guide-top"><p className="demo-eyebrow">功能验收 <span>假数据演示</span></p><button className="demo-reset" onClick={demo.reset} type="button"><RotateCcw aria-hidden="true" size={14} />重置示例</button></div>
    <nav className="demo-scenarios" aria-label="验收场景">
      {(["ai", "map", "mixed"] as const).map(key => <a key={key} href={`?demo=1&scenario=${key}`} aria-current={scenario === key ? "page" : undefined}>{key === "ai" ? "AI 提炼" : key === "map" ? "同主题串联" : "多主题展示"}<ArrowRight aria-hidden="true" size={14} /></a>)}
    </nav>
    <h2>{titles[scenario]}</h2>
    {scenario === "ai" ? <p className="demo-instruction">示例链接已填好，点击「生成知识小结」。完成后可点知识节点、写下理解、体验 AI 润色，再保存记录。</p>
      : <p className="demo-instruction">点击「串联知识」可直接查看已保存的示例；也可「新增串联知识」，选择 {dates.join("、")}，体验生成过程。{scenario === "map" ? "重点查看概念关系、AI 补充、来源和讲述提纲。" : "咖啡、宋词、徒步会按原始记录展示，不强行连成图谱。"}</p>}
    <div className="demo-guide-bottom"><p>生成约需 10 秒，返回预设示例，不调用真实 AI。修改在当前标签页刷新后保留，重置可重新体验。</p><button type="button" className="demo-failure" aria-pressed={demo.willFail()} onClick={demo.toggleFailure}>{demo.willFail() ? "已开启：下次生成失败" : "体验一次生成失败"}</button></div>
  </aside>;
}
