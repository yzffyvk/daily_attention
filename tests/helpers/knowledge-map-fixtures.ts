export const mapDates = ["2026-09-01", "2026-09-04", "2026-09-09"];

export function knowledgeMapFixture(): ConceptMapResult {
  return {
    schemaVersion: 2 as const,
    mode: "concept_map" as const,
    title: "从理解用户，到验证需求",
    overview: "把发现的问题形成可检验的假设，再用测试结果修正判断。",
    focusQuestion: "怎样从用户反馈走到可以验证的方案？",
    organization: "process" as const,
    branches: [
      { id: "discover", title: "理解用户", summary: "先了解具体情境，再判断问题是否值得解决。" },
      { id: "verify", title: "验证判断", summary: "将需求变成可检验的假设，用测试修正判断。" },
    ],
    concepts: [
      { id: "interview", branchId: "discover", label: "用户访谈", explanation: "通过具体经历了解问题发生的情境。", kind: "method" as const, origin: "record" as const, sourceDates: [mapDates[0]], supplementReason: "" },
      { id: "priority", branchId: "discover", label: "需求优先级", explanation: "结合影响与成本，选择先验证的问题。", kind: "method" as const, origin: "record" as const, sourceDates: [mapDates[1]], supplementReason: "" },
      { id: "prototype", branchId: "verify", label: "原型测试", explanation: "观察目标用户完成任务的过程，检验方案。", kind: "method" as const, origin: "record" as const, sourceDates: [mapDates[2]], supplementReason: "" },
      { id: "hypothesis", branchId: "verify", label: "需求假设", explanation: "明确哪个用户在什么情境下遇到什么问题，以及怎样观察验证结果。", kind: "concept" as const, origin: "ai_supplement" as const, sourceDates: [], supplementReason: "连接访谈发现与原型测试，明确测试究竟在验证什么。" },
    ],
    connections: [
      { fromId: "interview", toId: "priority", relation: "为判断提供线索", explanation: "访谈提供具体问题，优先级用于选择先处理的问题。", origin: "inference" as const, sourceDates: [mapDates[0], mapDates[1]] },
      { fromId: "priority", toId: "hypothesis", relation: "选出需要验证的", explanation: "将优先处理的问题写成可验证的需求假设。", origin: "ai_supplement" as const, sourceDates: [] },
      { fromId: "hypothesis", toId: "prototype", relation: "通过其检验", explanation: "原型测试围绕假设安排任务，并观察支持或反对假设的现象。", origin: "ai_supplement" as const, sourceDates: [] },
    ],
    outline: [
      { title: "先说清楚问题", body: "从用户的具体经历出发，说明如何判断需求优先级。", conceptIds: ["interview", "priority"] },
      { title: "再说明如何验证", body: "把需求写成假设，说明原型测试如何帮助修正判断。", conceptIds: ["hypothesis", "prototype"] },
    ],
    gaps: ["当前记录未覆盖如何选择测试参与者。"],
  };
}

export function sourceRecordsFixture(): SourceRecordsResult {
  return { schemaVersion: 2 as const, mode: "source_records" as const, title: "这些天的学习记录", reason: "mixed_topics" as const, sourceDates: [...mapDates] };
}

export function knowledgeMapSourcesFixture() {
  return mapDates.map((date, index) => ({ date, attention: ["用户访谈", "需求优先级", "原型测试"][index], summary: ["通过具体经历了解问题发生的情境。", "结合影响与成本，选择先验证的问题。", "观察目标用户完成任务的过程，检验方案。"][index], inspiration: "还需要在实践中验证。", version: 1, sourceUrl: "", hasImage: false }));
}
import type { ConceptMapResult, SourceRecordsResult } from "@/lib/domain/knowledge-map";
