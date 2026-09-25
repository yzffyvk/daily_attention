import type { AiGenerationResult } from "@/lib/domain/ai-generation";
import type { ConceptMapResult } from "@/lib/domain/knowledge-map";
import type { NarrativeResult, NarrativeSource } from "@/lib/domain/knowledge-narrative";
import type { CheckInRecord } from "@/features/checkins/types";
import { serializeLearningReflections } from "@/lib/domain/learning-reflections";

export const demoSourceUrl = "https://example.com/learning/user-interviews";
export const demoAiResult: AiGenerationResult = {
  attention: "用户访谈：从具体经历中发现真实需求",
  sourceTitle: "示例文章 · 怎样进行一次有效的用户访谈",
  inspiration: "", warnings: [],
  summary: `## 一句话主旨
用户访谈的价值，是从真实发生过的行为中理解问题，而不是收集用户对未来功能的赞同。

## 主要骨架
- 用户访谈：用具体经历理解需求
  - 还原情境：把问题放回实际生活
    - 具体经历：追问上一次发生了什么
    - 当前做法：了解用户现在怎样解决
  - 识别问题：把愿望和证据分开
    - 行为证据：关注行动、频率和代价
    - 潜在需求：理解用户想达成的结果
  - 形成判断：带着不确定性继续验证
    - 交叉验证：寻找不同用户的共同模式
    - 下一步假设：把发现写成可检验的问题

## 沿骨架展开
### 还原情境
先请对方讲述一件具体发生过的事。时间、地点、参与者和限制条件，决定同一句“我想要”背后是不是同一个问题。
### 具体经历
把“你会使用学习打卡功能吗？”换成“上一次你想回顾学过的内容，具体是怎么找的？”。真实经历更容易暴露中断、绕路和遗忘。
### 当前做法
记录用户使用的工具、操作步骤和临时补救办法。例如：为了找到一条知识点，先翻收藏夹，再搜索聊天记录，最后重新看视频。
### 识别问题
“想要搜索框”是方案偏好，“无法快速找回学过的内容”才是需要进一步理解的问题。不要跳过情境直接设计功能。
### 行为证据
询问问题多久发生一次、用户花了多少时间、是否试过别的办法。主动付出的成本，比一句“这个功能不错”更能说明问题的重要性。
### 潜在需求
从做法中提炼目标：用户可能并不是想保存更多文章，而是希望需要表达时，能重新组织自己已经学到的知识。
### 形成判断
一场访谈只能提供线索。把相似经历放在一起比较，保留反例，再决定下一步要验证什么。
### 交叉验证
比较至少几种不同情境中的记录。重复出现的困难可能是共同问题；只出现一次的诉求需要更多证据，不能直接代表所有用户。
### 下一步假设
示例：如果把同主题笔记组织为概念图谱，用户能否更清晰地解释概念间的关系？接下来可以用原型任务观察，而不是仅询问喜好。

## 关键辨析
用户说“想要某个功能”，不等于这个功能已经被验证。访谈帮助发现问题，原型测试帮助检验方案；两者回答的问题不同。

## 试着讲一遍
1. 为什么“上一次你怎么做”比“你愿不愿意用”更有信息量？
2. 用一个学习产品的例子，区分用户目标、当前做法和功能诉求。
3. 访谈发现的问题，应该怎样进入下一轮验证？`,
};

export function shiftDemoDate(today: string, days: number) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function demoDates(today: string) {
  return { related: [-6, -4, -2].map(offset => shiftDemoDate(today, offset)), mixed: [-5, -3, -1].map(offset => shiftDemoDate(today, offset)) };
}

const productNotes = [
  { title: "用户访谈", summary: "从用户真实发生过的经历中理解问题。先问最近一次行为、当时的情境与当前做法，再追问频率和代价。\n\n不要把对某个功能的赞同，直接当成已经成立的需求。", explanation: "访谈像还原一段录像：先看用户做了什么，再理解为什么，而不是一开始就问想要什么功能。", insight: "用户的临时补救办法，往往比直接表达的愿望更能揭示问题。", idea: "下一次访谈只围绕最近一次真实经历，避免假设性提问。" },
  { title: "需求优先级", summary: "先判断问题对用户的影响、出现频率与证据强度，再估计验证或解决它的成本。\n\n优先级是一种取舍。高频不等于高价值，少见但后果严重的问题也可能值得优先处理。", explanation: "不能用谁声音最大来决定做什么。我会把影响、频率、证据与成本放在一起比较，先验证最值得解决的问题。", insight: "在证据不足时，先投入小成本验证，比直接排进开发计划更合理。", idea: "给每项需求增加一列“目前有什么证据”，让不确定性可见。" },
  { title: "原型测试", summary: "围绕明确的任务，让目标用户实际操作原型。记录任务是否完成、在哪里犹豫或出错，再追问原因。\n\n观察行为证据，并用它修正方案。用户说界面好看，不代表能完成任务。", explanation: "原型测试是在看一个方案能不能帮助用户完成任务。先定义成功的表现，再观察卡点，最后决定保留、调整还是放弃。", insight: "访谈帮我理解问题，测试帮我验证方案；两个阶段的证据不能混用。", idea: "用“找到上周学过的一条知识并解释它”作为测试任务。" },
];
const mixedNotes = [
  { title: "手冲咖啡：研磨与萃取", summary: "今天固定水温和粉水比，对比两种研磨粗细。较细研磨的流速更慢，入口的苦感更明显。\n这只是本次豆子与冲煮条件下的观察，下次保持其他变量不变再比较。", inspiration: "一次只改变一个变量，更容易知道风味变化来自哪里。" },
  { title: "宋词阅读：意象与情境", summary: "阅读苏轼词作时，先记录词中出现的景物，再看它们怎样与叙述者的处境和情感连在一起。\n同一种意象在不同作品中的作用可能不同，不能直接套用固定含义。", inspiration: "先读具体语境，再查写作背景，看看自己的理解发生了什么变化。" },
  { title: "周末徒步：路线复盘", summary: "这次沿山脊步道行走约两小时。上坡阶段步速偏快，后半程休息次数增加。\n记录了补水点、转弯标记和容易走错的岔路，下次出发前复查路线与天气。", inspiration: "以能够稳定完成全程为目标，前半程留一点体力。" },
];

export function demoRecords(today: string): CheckInRecord[] {
  const dates = demoDates(today);
  function record(date: string, entryMode: "manual" | "ai", attention: string, summary: string, inspiration: string): CheckInRecord {
    return { id: crypto.randomUUID(), date, entryMode, attention, summary, inspiration, sourceUrl: entryMode === "ai" ? demoSourceUrl : "", imageName: "", imagePath: null, imageUrl: null, version: 1, createdAt: `${date}T02:00:00Z`, updatedAt: `${date}T02:00:00Z` };
  }
  return [
    ...productNotes.flatMap((note, index) => (["manual", "ai"] as const).map(mode => record(dates.related[index], mode, note.title,
      index === 0 && mode === "ai" ? demoAiResult.summary : note.summary,
      serializeLearningReflections({ explanation: note.explanation, insights: note.insight, ideas: note.idea })))),
    ...mixedNotes.map((note, index) => record(dates.mixed[index], "manual", note.title, note.summary, note.inspiration)),
    record(today, "ai", "用户访谈 · 待提炼示例", "", ""),
  ];
}

export function sourceFromRecord(record: CheckInRecord): NarrativeSource {
  return { id: record.id, entryMode: record.entryMode, date: record.date, attention: record.attention, summary: record.summary, inspiration: record.inspiration, version: record.version, sourceUrl: record.sourceUrl, hasImage: Boolean(record.imagePath) };
}

/** Fixed demonstration content; citations are always restricted to the chosen records. */
export function demoNarrativeResult(sources: NarrativeSource[], today: string, question = ""): NarrativeResult {
  const dates = sources.map(source => source.date).sort();
  const related = [...demoDates(today).related, today];
  if (dates.some(date => !related.includes(date))) return { schemaVersion: 2, mode: "source_records", title: "不同主题，各自保留原来的收获", reason: "mixed_topics", sourceDates: dates };
  const groups = [
    { id: "discover", title: "发现问题", summary: "回到具体情境，寻找真实的行为证据。", dates: [related[0], today], labels: ["用户访谈", "行为证据"], explanations: ["通过最近一次具体经历，了解问题出现的情境和当前做法。", "关注实际行动、发生频率和已经付出的代价，而不只听对未来的承诺。"] },
    { id: "prioritize", title: "判断价值", summary: "比较影响、频率、证据与成本，决定先验证什么。", dates: [related[1]], labels: ["需求优先级", "影响与成本"], explanations: ["把候选问题放在同一组标准下比较，明确当前最值得验证的方向。", "既看问题给用户造成的影响，也看解决或验证它需要付出的成本。"] },
    { id: "validate", title: "验证方案", summary: "用任务观察方案效果，再根据证据修正判断。", dates: [related[2]], labels: ["原型测试", "任务观察"], explanations: ["让目标用户执行具体任务，检验方案是否解决了预期问题。", "记录完成情况、犹豫和出错的位置，结合追问理解问题原因。"] },
  ].filter(group => group.dates.some(date => dates.includes(date)));
  const concepts: ConceptMapResult["concepts"] = groups.flatMap(group => group.labels.map((label, index) => ({ id: `${group.id}-${index}`, branchId: group.id, label, explanation: group.explanations[index], kind: index ? "principle" : "method", origin: "record", sourceDates: group.dates.filter(date => dates.includes(date)), supplementReason: "" })));
  concepts.push({ id: "hypothesis", branchId: groups.at(-1)!.id, label: "需求假设", explanation: "明确哪个用户在什么情境下遇到什么问题，以及什么观察结果能够支持或反对当前判断。", kind: "concept", origin: "ai_supplement", sourceDates: [], supplementReason: "用一个可检验的陈述连接问题发现与方案验证，帮助框架成立；这不是用户原始记录中的结论。" });
  const connections: ConceptMapResult["connections"] = groups.map(group => ({ fromId: `${group.id}-0`, toId: `${group.id}-1`, relation: "关注", explanation: group.summary, origin: "record", sourceDates: group.dates.filter(date => dates.includes(date)) }));
  for (let i = 1; i < groups.length; i++) connections.push({ fromId: `${groups[i - 1].id}-0`, toId: `${groups[i].id}-0`, relation: "为下一步提供依据", explanation: "这是对所选记录的组织性推断：先理解已有证据，再进入下一步判断或验证。", origin: "inference", sourceDates: [...new Set([...groups[i - 1].dates, ...groups[i].dates])].filter(date => dates.includes(date)) });
  connections.push({ fromId: `${groups[0].id}-0`, toId: "hypothesis", relation: "整理为可检验的", explanation: "把已有观察转成可以继续验证的需求假设，避免从零散发现直接跳到功能结论。", origin: "ai_supplement", sourceDates: [] });
  return { schemaVersion: 2, mode: "concept_map", title: "从理解用户，到验证需求", overview: "沿着“发现问题 → 判断价值 → 验证方案”组织这些天的学习。记录提供依据，关系帮助表达，少量补充让下一步验证更清晰。", focusQuestion: question || "怎样从用户反馈走到可以验证的方案？", organization: "process", branches: groups.map(({ id, title, summary }) => ({ id, title, summary })), concepts, connections,
    outline: groups.map((group, index) => ({ title: `${["先", "再", "最后"][index]}讲清楚${group.title}`, body: `${group.summary} 讲述时先解释方法，再举一个记录中的例子，最后说明目前还不能下什么结论。`, conceptIds: [`${group.id}-0`, `${group.id}-1`, ...(index === groups.length - 1 ? ["hypothesis"] : [])] })),
    gaps: ["目前没有实际测试数据，不能据此认定某个方案已经有效。", "后续可以补充：如何选择访谈与测试的参与者，以及怎样判断样本是否足够。"] };
}
