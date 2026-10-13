import { questionSummarySchema } from "@/lib/domain/knowledge-questions";

// Authored, synthetic teaching material. Never presented as a live model result.
const context = "访谈先还原最近一次具体经历，记录当时的情境和当前做法。";
const evidence = "实际行动、发生频率和付出的代价是行为证据；对功能的赞同不能直接证明需求。";
const validation = "对多份记录交叉验证，再把发现写成可检验的需求假设，用原型任务继续验证。";

export const demoQuestionSummary = questionSummarySchema.parse({
  attention: "用户访谈：从具体经历中发现真实需求",
  thesis: "先还原经历，再辨别证据，最后把发现变成可以验证的需求假设。",
  sourceTitle: "演示教材 · 怎样进行一次有效的用户访谈",
  inspiration: "",
  warnings: ["这是人工编写的演示教材与预置提炼结果，不读取输入链接，也不调用真实 AI。"],
  distinctions: "用户提出的功能是方案偏好；需要解决的问题要回到情境和行为中判断。访谈发现问题，原型测试验证方案。问题编号仅表示建议阅读顺序。",
  prompts: ["如何把“你愿不愿意用”改成基于真实经历的问题？", "如何从访谈证据形成一个可检验的需求假设？"],
  structure: {
    schemaVersion: 2,
    coreQuestion: "怎样从用户表达的愿望中，找到值得验证的真实问题？",
    contentTypes: ["方法与决策规则", "概念与边界"],
    questionOrder: ["context", "evidence", "validation"],
    questions: [
      { id: "context", title: "怎样问出真实经历？", answer: "围绕最近一次发生的事情，先还原情境，再了解用户当时的做法。", scope: "访谈的提问方法", mainlineRole: "还原真实经历", evidence: context,
        views: [{ id: "context-view", title: "从经历还原情境", diagramKind: "flow", nodeIds: ["experience", "situation", "workaround"], relationIds: ["e1", "e2"], referenceNodeIds: [], readingOrder: ["experience", "situation", "workaround"], contextNotes: [] }] },
      { id: "evidence", title: "怎样区分愿望与需求证据？", answer: "结合具体经历，观察实际行动、频率和代价；一句赞同只提供线索，不能直接证明需求。", scope: "证据强弱与判断边界", mainlineRole: "辨别需求证据", evidence,
        views: [{ id: "evidence-view", title: "从经历到行为证据", diagramKind: "argument", nodeIds: ["experience", "behavior", "wish"], relationIds: ["e3", "e4"], referenceNodeIds: ["experience"], readingOrder: ["experience", "behavior", "wish"], contextNotes: [{ nodeId: "experience", text: "复用问题一中的具体经历，作为判断行为证据的情境基础。" }] }] },
      { id: "validation", title: "发现如何进入下一轮验证？", answer: "比较多份记录中的共同模式与反例，形成可检验的需求假设，再用任务观察检验方案。", scope: "从访谈发现到验证任务", mainlineRole: "验证需求假设", evidence: validation,
        views: [{ id: "validation-view", title: "从证据到需求假设", diagramKind: "flow", nodeIds: ["behavior", "cross-check", "hypothesis", "prototype"], relationIds: ["e5", "e6", "e7"], referenceNodeIds: ["behavior"], readingOrder: ["behavior", "cross-check", "hypothesis", "prototype"], contextNotes: [{ nodeId: "behavior", text: "沿用问题二的行为证据，比较不同记录时仍然保留情境与反例。" }] }] },
    ],
    nodes: [
      { id: "experience", homeQuestionId: "context", name: "具体经历", role: "证据", summary: "追问最近一次发生了什么", explanation: "把“你会使用学习打卡功能吗？”换成“上一次你想回顾学过的内容，具体是怎么找的？”。追问实际步骤，比假设性的承诺更容易发现中断和绕路。", evidence: context },
      { id: "situation", homeQuestionId: "context", name: "使用情境", role: "条件", summary: "记录目标、限制与参与者", explanation: "同一句“我找不到笔记”，可能发生在准备分享、复习考试或解决工作问题时。记录时间、目标和限制，才知道是否在讨论同一种困难。", evidence: context },
      { id: "workaround", homeQuestionId: "context", name: "当前做法", role: "方案", summary: "观察现有工具和临时补救", explanation: "例如先翻收藏夹，再搜索聊天记录，最后重新观看资料。绕路和补救说明用户实际投入了什么，也为后续判断成本提供线索。", evidence: context },
      { id: "behavior", homeQuestionId: "evidence", name: "行为证据", role: "证据", summary: "关注行动、频率与代价", explanation: "询问这个问题多久发生一次、已经花了多少时间、是否尝试过其他办法。主动付出的成本比一句“这个功能不错”更有信息量，但仍需核对情境和反例。", evidence },
      { id: "wish", homeQuestionId: "evidence", name: "功能愿望", role: "观点", summary: "表达偏好，尚待验证", explanation: "“想要搜索框”描述了一种方案；“表达时无法找到过去学过的内容”描述了需要理解的问题。访谈者应继续追问经历，而不是直接把方案放进开发列表。", evidence },
      { id: "cross-check", homeQuestionId: "validation", name: "交叉验证", role: "机制", summary: "比较共同模式与反例", explanation: "把不同用户、不同情境的记录放在一起，检查困难是否重复出现，也记录不符合当前猜测的反例。一场访谈只能提供线索，不能代表所有用户。", evidence: validation },
      { id: "hypothesis", homeQuestionId: "validation", name: "需求假设", role: "观点", summary: "写成可以被检验的陈述", explanation: "例如：如果把同主题笔记组织为概念图谱，准备分享的人能否更快找到证据并解释概念关系？明确目标用户、情境和可观察结果，才能继续检验。", evidence: validation },
      { id: "prototype", homeQuestionId: "validation", name: "原型测试", role: "方案", summary: "用真实任务观察方案表现", explanation: "请目标用户完成“找到上周学过的一条知识并解释它”的任务，记录完成情况、犹豫与出错位置。界面受到赞美不等于任务已经完成。", evidence: validation },
    ],
    relations: [
      { id: "e1", from: "experience", to: "situation", kind: "作用", label: "帮助还原", condition: "追问真实发生的事件时", evidence: context },
      { id: "e2", from: "situation", to: "workaround", kind: "条件", label: "限定理解背景", condition: "保留当时目标和限制", evidence: context },
      { id: "e3", from: "experience", to: "behavior", kind: "支持", label: "提供可追问的线索", condition: "核对实际行动、频率和代价", evidence },
      { id: "e4", from: "wish", to: "behavior", kind: "区别", label: "不等同于", condition: "只有赞同而没有行为依据时", evidence },
      { id: "e5", from: "behavior", to: "cross-check", kind: "作用", label: "提供比较材料", condition: "保留不同记录的具体情境", evidence: validation },
      { id: "e6", from: "cross-check", to: "hypothesis", kind: "支持", label: "帮助形成", condition: "同时考虑共同模式与反例", evidence: validation },
      { id: "e7", from: "hypothesis", to: "prototype", kind: "作用", label: "指导验证任务", condition: "明确可观察的成功标准", evidence: validation },
    ],
    questionLinks: [
      { fromQuestionId: "context", toQuestionId: "evidence", label: "具体经历为行为证据提供线索", relationIds: ["e3"] },
      { fromQuestionId: "evidence", toQuestionId: "validation", label: "行为证据进入交叉验证", relationIds: ["e5"] },
    ],
  },
});
