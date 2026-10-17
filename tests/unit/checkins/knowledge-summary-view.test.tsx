import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { KnowledgeSummaryView } from "@/features/checkins/knowledge-summary-view";
import { serializeQuestionSummary } from "@/lib/domain/knowledge-questions";
import { questionSummaryFixture } from "../../helpers/knowledge-questions-fixture";

const summary = `一句话主旨：
Agent 由模型与运行系统共同构成。

主要骨架：
Agent
├─ LLM / Model：负责决策
└─ Harness：组织运行
   ├─ 上下文：提供信息
   └─ 工具：执行行动

沿骨架展开：
### LLM / Model
模型根据当前信息选择下一步。
### Harness
上下文和工具构成最小运行系统，生产中加入约束、验证和纠正。
### 上下文
保留本次任务需要的信息。
### 工具
通过外部接口执行操作。

关键辨析：
两个公式描述同一系统的展开。

试着讲一遍：
1. 为什么 Harness 包含上下文和工具？`;

afterEach(cleanup);

describe("KnowledgeSummaryView", () => {
  it('renders emphasized formulas and actual lists consistently across reading surfaces', async () => {
    const document = questionSummaryFixture();
    const formula = 'Agent = LLM + 上下文 + 工具';
    document.thesis = `核心构成：**${formula}**`;
    document.structure.questions[0].answer = `**${formula}**\n\n- **LLM**：负责决策\n- **上下文**：承载信息\n- **工具**：执行行动`;
    document.structure.nodes[0].explanation = '三个组成相互配合。\n\n- **决策**：选择行动\n- **反馈**：更新上下文\n\n1. 观察环境\n2. 执行行动';
    document.distinctions = '**环境**位于 Agent 边界之外。';
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const user = userEvent.setup();
    expect(within(screen.getByRole('heading', { name: `核心构成：${formula}` })).getByText(formula).tagName).toBe('STRONG');
    await user.click(screen.getByRole('button', { name: '展开核心部分：明确行动' }));
    const check = (scope: ReturnType<typeof within>) => {
      expect(scope.getAllByText(formula).every((el: HTMLElement) => el.tagName === 'STRONG')).toBe(true);
      const item = scope.getByText('LLM', { exact: true }).closest('li');
      expect(item).toHaveTextContent('LLM：负责决策');
      expect(item?.parentElement?.tagName).toBe('UL');
      expect(scope.getByText('观察环境').closest('li')?.parentElement?.tagName).toBe('OL');
    };
    check(within(screen.getByRole('region', { name: '明确行动' })));
    await user.click(screen.getByRole('button', { name: '展开阅读' }));
    check(within(screen.getByRole('region', { name: '明确行动' })));
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('查看完整小结', { exact: true }));
    check(within(screen.getByTestId('complete-summary')));
    expect(within(screen.getByTestId('complete-summary')).getByText('环境', { exact: true }).tagName).toBe('STRONG');
  });

  it('keeps safe emphasis and list structure in plain or legacy notes without interpreting source HTML', () => {
    render(<KnowledgeSummaryView value={'**核心公式**\n\n• **模型**：决策\n• 工具：行动\n\n<script>unsafe()</script>\n\n```text\n- code example\n```'} />);
    expect(screen.getByText('核心公式').tagName).toBe('STRONG');
    expect(screen.getByText('模型', { exact: true }).closest('li')).toHaveTextContent('模型：决策');
    expect(screen.getByText(/- code example/).closest('li')).toBeNull();
    expect(screen.getByText(/<script>unsafe/)).toBeVisible();
    expect(document.querySelector('script')).toBeNull();
  });

  it('shows pending-review status before reading without hiding it in a collapsed source-warning section', async () => {
    const document = questionSummaryFixture();
    document.warnings = ['待核对：已生成学习草稿，仍有内容需要核对。', '待核对：检查：解释只有名称，没有说明如何验证。', '原文只覆盖已提供范围。'];
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const notice = screen.getByRole('note', { name: '提炼结果待核对' });
    expect(notice).toBeVisible();
    expect(within(notice).getByText('已生成学习草稿，仍有内容需要核对。')).toBeVisible();
    await userEvent.setup().click(within(notice).getByText('查看核对提示'));
    expect(within(notice).getByText('检查：解释只有名称，没有说明如何验证。')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: '展开阅读' }));
    expect(within(screen.getByRole('dialog')).getByRole('note', { name: '提炼结果待核对' })).toBeVisible();
  });
  it('describes review findings with knowledge names rather than internal identifiers', async () => {
    const document = questionSummaryFixture();
    document.warnings = ['待核对：已生成学习草稿，骨架仍需核对。', '待核对：q2 的 question/answer 与 n1 的 homeQuestionId 不一致。'];
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const notice = screen.getByRole('note', { name: '提炼结果待核对' });
    await userEvent.setup().click(within(notice).getByText('查看核对提示'));
    expect(notice.textContent).toContain('验证行动');
    expect(notice.textContent).toContain('计划');
    expect(notice.textContent).not.toMatch(/q2|n1|question|answer|homeQuestionId/u);
  });
  it('preserves a legacy mainline explanation when the outline uses its shorter scope label', async () => {
    const document = questionSummaryFixture();
    document.structure.questions[0].mainlineRole = '先明确行动，才能为后续检查提供可比较的目标。';
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const user = userEvent.setup();
    await user.click(screen.getByText('查看完整小结', { exact: true }));
    const complete = within(screen.getByTestId('complete-summary'));
    const part = complete.getByRole('heading', { name: '如何安排？' }).closest('li')!;
    await user.click(within(part).getByText('范围与依据', { exact: true }));
    expect(within(part).getByText('先明确行动，才能为后续检查提供可比较的目标。', { exact: true })).toBeVisible();
  });
  it("renders the complete question summary as readable sections without storage tables or identifiers", async () => {
    const document = questionSummaryFixture();
    document.structure.questionOrder.reverse();
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    await userEvent.setup().click(screen.getByText("查看完整小结", { exact: true }));
    const complete = within(screen.getByTestId("complete-summary"));
    expect(complete.getByRole("heading", { name: document.attention })).toBeVisible();
    expect(complete.getAllByRole("heading", { level: 6 }).slice(0, 2).map(el => el.textContent)).toEqual(["如何检查？", "如何安排？"]);
    for (const q of document.structure.questions) expect(complete.getAllByText(q.answer, { exact: true })).toHaveLength(1);
    for (const n of document.structure.nodes) expect(complete.getAllByText(n.explanation, { exact: true })).toHaveLength(1);
    expect(complete.getByRole("heading", { name: "试着讲一遍" })).toBeVisible();
    expect(complete.getByText(document.prompts[0], { exact: true })).toBeVisible();
    expect(screen.getByTestId("complete-summary").textContent).not.toMatch(/知识结构版本|文档结束|\|---|homeQuestionId|外部引用|q1|n1|e1/u);
    expect(complete.queryByText("它属于什么")).not.toBeInTheDocument();
    expect(complete.queryByText("与其他问题的联系")).not.toBeInTheDocument();
    const part = complete.getByRole("heading", { name: "如何检查？" }).closest("li")!;
    expect(within(part).getByText('检查实际结果，找出差距。', { exact: true })).toBeVisible();
    expect(within(part).queryByText('列出下一步行动。', { exact: true })).not.toBeInTheDocument();
    await userEvent.setup().click(within(part).getByText("范围与依据", { exact: true }));
    expect(within(part).getByText("本题检查计划的结果。", { exact: true })).toBeVisible();
    expect(within(part).getByText("检查结果用于改进计划", { exact: true })).toBeVisible();
  });

  it("keeps named relationships, conditions and evidence accessible in the complete summary", async () => {
    const document = questionSummaryFixture();
    document.structure.nodes[0].explanation = '选择 **行动**，保留 `A|B` 与 <script>unsafe()</script>。';
    render(<KnowledgeSummaryView value={serializeQuestionSummary(document)} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("查看完整小结", { exact: true }));
    const complete = within(screen.getByTestId("complete-summary"));
    await user.click(complete.getByText("关系与适用条件", { exact: true }));
    expect(complete.getByText("检查 → 计划", { exact: true })).toBeVisible();
    expect(complete.getByText("验证并改进", { exact: true })).toBeVisible();
    expect(complete.getByText("获得结果后", { exact: true })).toBeVisible();
    const relation = complete.getByText("验证并改进", { exact: true }).closest("li")!;
    await user.click(within(relation).getByText("原文依据", { exact: true }));
    expect(within(relation).getByText(document.structure.relations[0].evidence, { exact: true })).toBeVisible();
    expect(complete.getByText("A|B", { exact: true }).tagName).toBe("CODE");
    expect(complete.getByText("行动", { exact: true }).tagName).toBe("STRONG");
    expect(screen.getByTestId("complete-summary")).toHaveTextContent("<script>unsafe()</script>");
    expect(screen.getByTestId("complete-summary").querySelector("script")).toBeNull();
  });
  it("shows the actual hierarchy and lets a learner select a node explanation", async () => {
    render(<KnowledgeSummaryView value={summary} />);
    const user = userEvent.setup();
    const harness = screen.getByRole("button", { name: "Harness" });
    await user.click(harness);
    expect(harness).toHaveAttribute("aria-pressed", "true");
    const explanation = screen.getByRole("region", { name: "节点解释" });
    expect(within(explanation).getByText(/生产中加入约束、验证和纠正/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "工具" }));
    expect(within(explanation).getByText("通过外部接口执行操作。")).toBeVisible();
    expect(within(explanation).queryByText(/生产中加入/)).not.toBeInTheDocument();
  });

  it("keeps all original text available without guessing a graph for flat notes", async () => {
    const text = "这是一份普通笔记。\n\n没有明确的组成关系，也不应凭空画出关系。\n<script>doSomething()</script>";
    render(<KnowledgeSummaryView value={text} />);
    expect(screen.getByText("这是一份普通笔记。", { exact: false })).toBeVisible();
    expect(screen.queryByRole("region", { name: "知识结构图" })).not.toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("exposes the unabridged summary and resets selection when another note arrives", async () => {
    const view = render(<KnowledgeSummaryView value={summary} />);
    const user = userEvent.setup();
    await user.click(screen.getByText("查看完整小结", { exact: true }));
    expect(screen.getByTestId("complete-summary")).toHaveTextContent("为什么 Harness 包含上下文和工具？");
    await user.click(screen.getByRole("button", { name: "工具" }));
    view.rerender(<KnowledgeSummaryView value={"一句话主旨：理解光合作用。\n\n主要骨架：\n光合作用\n├─ 光反应\n└─ 碳固定\n\n沿骨架展开：\n### 光反应\n将光能转化为化学能。"} />);
    expect(screen.queryByRole("button", { name: "工具" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "光反应" })).toBeVisible();
    expect(screen.queryByText("通过外部接口执行操作。")).not.toBeInTheDocument();
  });
});
