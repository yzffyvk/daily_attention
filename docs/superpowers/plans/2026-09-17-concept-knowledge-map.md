# 知识串联：概念框架迭代

**Goal:** 按已确认的讨论，将同主题记录组织为概念框架，并允许少量必要的 AI 补充；混合主题忠实展示来源快照。

**Architecture:** 新增版本 2 的结果，区分 concept_map 与 source_records。历史版本继续读取、编辑、复制。沿用现有任务、JSON 存储、权限、额度和快照，不改变数据库结构。当前功能及其他工作尚未提交，在当前工作区增量修改，不重置或移动已有工作。

**Tech Stack:** React、TypeScript、Zod、Vitest、Playwright；复用现有模型调用与后台任务。

**Spec:** 本次对话中已确认的六步生成策略及同主题/混合主题分流规则。

## 约束

- 概念作为节点；日期仅用于引用。每个选中日期至少有一个记录概念引用。
- 少量主干，每个主干有具体结论；关系含明确连接词、解释、来源类型。
- AI 补充最多 3 个概念，说明必要性，不伪装为用户记录或已掌握内容。
- 多领域或材料不足时返回 source_records；正文直接读取已保存快照，不让模型改写。
- 表达提纲引用现有概念，不引入第二套结构。
- 保留旧结果和冲突保护；移动端可用、键盘可操作、尊重减少动态效果。
- 不更换依赖、不改动账号与额度、不自动部署。

## 实施

- [x] 1. 契约与验证：先写新结果、补充来源、图谱引用和原文回退测试，确认失败；新增版本化契约与验证，运行原有及新增契约测试。
  - 文件：lib/domain/knowledge-map.ts、lib/domain/knowledge-narrative.ts、tests/helpers/knowledge-map-fixtures.ts、tests/unit/knowledge-narratives/knowledge-map-domain.test.ts。
  - 接口：KnowledgeMapResult、SourceRecordsResult、isKnowledgeMapResult；validateNarrativeResult 兼容历史版本。
- [x] 2. 生成：用版本 2 响应测试驱动 prompt 和 provider；新任务只接受版本 2，历史读取仍兼容。测试模式返回原始记录结构，真实生成按适用性、问题、概念、关系、补充、提纲顺序生成。
  - 文件：supabase/functions/_shared/knowledge-narratives/{prompt,provider}.ts、services/ai-worker/knowledge-narratives.ts、tests/unit/knowledge-narratives/provider-worker.test.ts。
- [x] 3. 阅读与编辑：先写新图谱来源点击、补充标记、原文回退和保存测试，再增加概念阅读器、图谱、源记录复用组件、新版编辑字段；旧版按原路径显示。原文回退仅允许编辑脉络名称。
  - 文件：features/knowledge-narratives/ 下新增图谱组件并修改 reader/editor/workspace，app/knowledge-theme.css，tests/unit/knowledge-narratives/knowledge-map-ui.test.tsx。
  - 视觉：延续现有夜色背景、香槟金主干、Geist/系统中文字体，以可选择的概念图为主视觉，细节和来源在图下展开。
- [x] 4. 验证：运行知识串联测试、全量单元测试、类型检查和构建；用隔离浏览器数据验证桌面及 390/320px 图谱、来源、编辑、混合记录，检查横向溢出与浏览器错误；更新说明和验证记录。

## 验证命令

```sh
npx vitest run tests/unit/knowledge-narratives
npm run test:unit
npm run typecheck
npm run build
node tests/visual/verify-knowledge-map.mjs
```

## 完成记录

2026-09-17：四项均完成。最终功能回归 93 项通过；全量单元基线迭代后 780 项、集成 16 项、页面结构 9 项通过。审查修复来源重复定位并复审通过；最终类型、ESLint、构建、三种宽度浏览器复验通过。详见 docs/knowledge-map-qa.md。代码保留在当前工作区，未提交或部署。
