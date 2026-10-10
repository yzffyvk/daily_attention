# 知识脉络列表与编辑

目标：串联知识入口默认展示保存列表，右上角新增按钮进入创建页；列表提供详情编辑、独立复制、不可恢复删除确认。

## Global Constraints
- 保留现有主题、每日记录草稿、生成请求幂等恢复与星图自动居中。
- 编辑和复制不调用模型、不消耗额度；所有读写限定当前账号。
- 列表展示现有所有状态，完成的记录可编辑、复制；所有记录可删除，生成中的删除提示终止展示，后台旧结果不得复活。
- 复制名称依次使用 `原名 cp`、`原名 2 cp`，最长 120 字；数据库串行选名。
- 不提交、不部署、不重置用户数据库；在现有本地产品开发。

### Task 1: 列表、创建与编辑界面

文件：features/knowledge-narratives/{knowledge-workspace.tsx,api.ts,narrative-editor.tsx}、app/knowledge-theme.css、tests/unit/knowledge-narratives/workspace.test.tsx、tests/visual/verify-knowledge.mjs。

默认进入列表，显示名称、日期数、创建时间、状态与各行操作；空列表明确引导新建。右上角 `新增串联知识` 进入现有日期选择创建页。列表行标题打开阅读详情；`编辑` 直接进入可编辑详情。提供返回列表导航。

编辑完整 NarrativeResult 文本（名称、总览、日期节点标签/要点、联系说明与关系、叙事章节和知识框架标题/正文、待探索问题与下一步）。引用日期和快照保留；无需增删章节。保存与取消可用；未保存编辑离开需防止静默丢失，保存失败保留输入，显示服务端中文错误。保留重命名兼容或整合进编辑，无需额外独立重命名按钮。

复制仅完成记录支持，留在列表并立即显示新增行；每次成功后新操作使用新 UUID，失败重试保留 UUID 以免重复。复制成功提示名称。删除先用可键盘访问的确认弹窗明确 `删除后不可恢复`，取消不发送请求，确认期间禁止重复提交，失败留在弹窗可重试，成功刷新列表。生成中删除可提示生成结果也不会保留。

接口契约（父任务实现服务器，前端任务实现 api.ts 包装）：
- GET 列表/详情、POST 创建保持不变。
- PATCH /api/knowledge-narratives/:id，body `{result: NarrativeResult, expectedUpdatedAt: string}` 返回 KnowledgeNarrative；冲突 409 NARRATIVE_EDIT_CONFLICT，保留本地草稿。旧 `{title}` 仍兼容。
- POST /api/knowledge-narratives/:id/copy，body `{idempotencyKey: uuid}` 返回 KnowledgeNarrative (201)。服务端选名，前端不自行追加。
- DELETE /api/knowledge-narratives/:id，无 body，返回 `{id: string}`。

先更新有意义的交互测试；再实现 UI；运行对应单元和视觉验收。视觉浏览器所有接口使用 mock，避免调用真实模型和删除用户数据。原自动居中、轮询不抢滚动的验收保留。

### Task 2: 保存、复制、删除后端

新增服务角色 RPC 与迁移。编辑使用 updated_at 乐观锁，完整结果仍验证日期和结构。复制原结果和来源快照，支持请求幂等、独立副本、并发名称检查，不扣 AI 额度。删除加行锁并退回从未启动的配额预约，已启动任务不退消耗；旧 worker 结果无法重新写回。新增 owner/foreign、非法引用、过期更新、复制重试/重名、删除与配额回归测试。

### Task 3: 验证与复核

本地应用迁移（不重置）、生成类型、运行相关单元/数据库/接口/浏览器验证，检查桌面和手机布局。独立代码复核后处理必要问题；交付本地验收入口。

## 完成状态

三个任务均已完成。前端与后端独立审查通过，641项单元、39项新数据库规则、15项本地接口和9项渲染测试通过；1440/390/320浏览器验收、类型检查、代码检查和生产构建通过。已接入本地3001产品，迁移仅应用本地，未提交或部署线上。详见 docs/knowledge-narratives-qa.md。
