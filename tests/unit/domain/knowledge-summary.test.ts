import { describe, expect, it } from "vitest";
import { parseKnowledgeSummary } from "../../../lib/domain/knowledge-summary";

describe("parseKnowledgeSummary", () => {
  it("preserves an explicit chapter tree and leaves prose relationships unmapped", () => {
    const result = parseKnowledgeSummary("一句话主旨：系统组成。\n主要骨架：\nAgent\n├─ Model：决策\n└─ Harness\n   ├─ 上下文\n   └─ 工具\nReAct 是协同机制：思考→行动\n沿骨架展开：\n### Model\n模型作决策。\n### 工具（手脚）\n不可猜测所属节点。\n关键辨析：\n有限定。\n试着讲一遍：\n1. 为什么？");
    expect(result.roots[0].children.map(n => n.label)).toEqual(["Model", "Harness"]);
    expect(result.roots[0].children[1].children.map(n => n.label)).toEqual(["上下文", "工具"]);
    expect(result.roots[0].children[0].description).toBe("决策");
    expect(result.roots[0].children[0].details).toEqual(["模型作决策。"]);
    expect(result.roots[0].children[1].children[1].details).toEqual([]);
    expect(result.unmapped).toContain("ReAct 是协同机制");
    expect(result.explanation).toContain("不可猜测");
    expect(result.prompts).toEqual(["为什么？"]);
  });
  it("accepts numbered Markdown sections and nested bullets without conflating duplicate labels", () => {
    const text = "## 1. 一句话主旨\n主题\n## 二、主要骨架\n- A\n  - 重复：一\n- B\n  - 重复：二\n## 3）沿骨架展开\n### 重复\n不能唯一归属。";
    const result = parseKnowledgeSummary(text);
    expect(result.roots.map(n => n.label)).toEqual(["A", "B"]);
    expect(result.roots[0].children[0].details).toEqual([]);
    const ids = result.roots.flatMap(n => [n.id, ...n.children.map(c => c.id)]);
    expect(new Set(ids).size).toBe(4);
    expect(parseKnowledgeSummary(text)).toEqual(result);
  });
  it("keeps flat prose and unknown sections fully readable", () => {
    const text = "自定义章节：\nA → B，说明因果。\n没有目录。";
    const result = parseKnowledgeSummary(text);
    expect(result.roots).toEqual([]);
    expect(result.original).toBe(text);
    expect(result.unmapped).toBe(text);
  });
  it("does not read fenced code or formulas as a tree and retains HTML as text", () => {
    const text = "主要骨架：\n```\n- fake\n```\nAgent = Model + Harness\n<script>alert(1)</script>\n沿骨架展开：\n公式 $x = y + z$";
    const result = parseKnowledgeSummary(text);
    expect(result.roots).toEqual([]);
    expect(result.unmapped).toContain("- fake");
    expect(result.unmapped).toContain("<script>");
    expect(result.explanation).toContain("$x = y + z$");
    expect(result.original).toBe(text);
  });
  it("preserves an explicitly listed formula without inventing its operands as nodes", () => {
    const result = parseKnowledgeSummary("主要骨架：\nAgent\n└─ Harness = 上下文 + 工具");
    expect(result.roots[0].children[0].label).toBe("Harness = 上下文 + 工具");
    expect(result.roots[0].children[0].children).toEqual([]);
  });
  it("accepts ordinary four-space Markdown nesting", () => {
    const result = parseKnowledgeSummary("主要骨架：\n- 系统\n    - 核心\n        - 组成");
    expect(result.roots[0].children[0].children[0].label).toBe("组成");
  });
  it.each(["```", "~~~", "````markdown"])("keeps %s inside a longer backtick fence across every scan", (inner) => {
    const code = ["````markdown", inner, "沿骨架展开：", "### 真实", "假解释。", "- 假节点", "````"].join("\n");
    const skeleton = parseKnowledgeSummary(`主要骨架：\n${code}\n- 真实\n沿骨架展开：\n实际说明。`);
    expect(skeleton.roots.map(n => n.label)).toEqual(["真实"]);
    expect(skeleton.explanation).toBe("实际说明。");
    expect(skeleton.unmapped).toContain(code);
    const details = parseKnowledgeSummary(`主要骨架：\n- 真实\n沿骨架展开：\n${code}\n### 真实\n实际说明。`);
    expect(details.roots[0].details).toEqual(["实际说明。"]);
    expect(details.explanation).toContain(code);
  });
  it("closes a tilde fence only with a sufficient matching whitespace-only delimiter", () => {
    const text = "主要骨架：\n~~~~text\n```\n- 假节点\n~~~\n- 另一个假节点\n  ~~~~~  \n- 真实";
    const result = parseKnowledgeSummary(text);
    expect(result.roots.map(n => n.label)).toEqual(["真实"]);
    expect(result.unmapped).toContain("另一个假节点");
  });
  it("bounds hierarchy without dropping the complete source", () => {
    const text = "主要骨架：\n" + Array.from({ length: 250 }, (_, i) => `- 节点${i}`).join("\n");
    const result = parseKnowledgeSummary(text);
    expect(result.roots.length).toBeLessThanOrEqual(120);
    expect(result.unmapped).toContain("节点249");
    expect(result.original).toBe(text);
  });
});
