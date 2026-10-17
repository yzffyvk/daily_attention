# 知序 Aura

让每一次学习，连成自己的知识地图。以点成线，以线成面。在记录中积累，在关联中理解。

**在线访问：[https://aura-attention.com/](https://aura-attention.com/)**

一个帮助学习者记录、理解和串联知识的应用，支持每天多条学习记录、主题专辑、AI 文章提炼、知识串联和心得润色。
前端使用 React、TypeScript 和 [vinext](https://github.com/cloudflare/vinext)，网站及 API 部署在 Cloudflare Workers，
Supabase 提供账户认证、数据库和图片存储，Railway 运行常驻 AI Worker 与安全抓取服务。

## 主要功能

- **学习记录与日历**：每天可新增多条独立记录，直接进入编辑并切换手动记录或 AI 提炼，切换保留当前草稿；按完成学习的日期计算天数；一级导航「全部记录」汇总跨日期、跨专辑的已完成记录、云端草稿和浏览器草稿，以纵向列表展示，支持按学习主题名称模糊搜索、状态筛选与分页加载。
- **专辑整理**：每条记录可选择一个专辑，也可暂不归类；支持创建、重命名、单条或批量移动。删除专辑会保留记录并转为未归类。
- **AI 提炼**：读取公开文字资料链接，可填写提炼要求，按核心主线、独立问题、答案和局部结构图组织内容。
- **知识串联**：选择 2–14 条已完成的学习记录（支持同日、跨日及混合手动/AI），生成概念图谱和讲述提纲，支持查看来源、编辑、复制和重新生成。
- **心得润色**：依据当前知识总结改进用户自己的解释，采纳后可撤销，仍需主动保存记录。
- **账户与草稿**：邮箱密码登录、恢复码找回账户，草稿按账户和记录 ID 存储在浏览器中，支持离线保留。
- **每日新知**：包含网球入门目录、个人学习进度和阶段回顾；正式内容需审核并发布后才会展示。

## 运行架构

| 服务 | 平台 | 职责 |
| --- | --- | --- |
| 网站与 API：`daily-attention` | Cloudflare Workers | 页面、登录、记录管理、创建和查询 AI 任务，以及心得润色 |
| `ai-worker` | Railway | 持续消费文章提炼和知识串联任务，调用模型并保存结果 |
| `safe-fetch-gateway` | Railway | 安全读取用户提交的公开文章链接，校验地址、重定向和响应大小 |
| 数据库、账户与图片存储 | Supabase | 正式数据持久化、认证、权限控制和图片存储 |

当前三项 AI 能力均使用 `deepseek-flash`。文章提炼采用异步队列，页面提交后轮询任务状态；
AI 提炼完成后直接展示结果，刷新仍可继续编辑。手动记录与 AI 提炼统一使用「保存草稿、取消、确认」：保存草稿便于稍后继续，确认后计为完成学习；取消放弃本次未保存修改并返回列表，已保存内容保留。记录列表支持删除记录。知识串联结果会自动保存。
具体模型参数、健康检查及后台部署方式见 [AI Worker 文档](./services/ai-worker/README.md)。

## 多记录与专辑升级

增量升级按迁移文件顺序执行 `20261015043320_multi_records_albums.sql`、
`20261015043552_record_knowledge_sources.sql`、`20261015043844_record_bound_ai.sql`、
`20261015045932_complete_learning_record_create_replay.sql`，
随后发布网站/API 和 AI Worker。已有记录保留 ID、内容、日期和图片，归入「未归类」并保持已完成；
旧 AI 任务恢复到独立记录，旧知识串联结果继续可读。

已有本地数据库使用 `supabase db push --local` 增量升级；不要为升级清空数据。
部署应先应用数据库迁移，再更新应用和 Worker；旧网页的按日期保存请求会提示刷新，以免覆盖多条记录。
本次发布同步升级数据库、网站/API 和 AI Worker。

## 项目结构

日常开发直接使用当前仓库根目录。页面、接口、服务端和数据库文件的位置见
[`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)。

最常用的入口：

- `app/(app)/page.tsx`：打卡主页面。
- `app/(auth)/`：登录、注册和找回页面。
- `features/`：日历、打卡编辑器、登录表单等前端功能。
- `server/`：认证、打卡、存储和限流服务。
- `supabase/migrations/`：正式数据库结构。

## 环境要求

- Node.js `>=22.13.0`
- Docker Desktop（本地 Supabase 依赖 Docker）
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## 本地启动

```bash
npm install
npm run supabase:start
cp .dev.vars.example .dev.vars
npm run dev
```

使用 `supabase status -o env` 获取本地 API 地址、公开密钥和服务端密钥，填写到 `.dev.vars`。
`AUTH_RATE_LIMIT_PEPPER` 需要至少 32 字节的私密随机值。`.dev.vars` 已被 Git 忽略，不得提交。

本地读取生产配置时使用同样被忽略的 `.env.production.local`。环境变量模板为 `.dev.vars.example`；
当前账户体系使用 Supabase 邮箱密码认证，不需要微信配置。

正式数据库结构和数据 API 由 Supabase 管理。本地应用全部迁移和种子数据：

```bash
npm run supabase:reset
```

数据库结构变更后，重新生成纳入版本管理的 TypeScript 数据库类型：

```bash
npm run supabase:types
```

如需本地使用真实 AI，另行配置模型、匿名用户标识和网关密钥，并在两个终端保持后台运行：

```bash
npm run dev:gateway
npm run dev:ai-worker
```

所需变量及连接托管数据库时的账号限定验收方式见 [AI Worker 本地运行说明](./services/ai-worker/README.md#本地运行)。

## 验证命令

```bash
npm run test:unit
npm run supabase:test
npm run test:integration
npm run test:rendered
npm run test:e2e
npm run lint
npm run typecheck
npm run build
```

`npm run test:integration` 和 `npm run test:e2e` 使用本地 Supabase 绑定。
E2E 仅创建保留的 `e2e.daily-attention.invalid` 测试账户，并在核对 Auth 邮箱归属后清理。
本地服务使用完毕后，运行 `npm run supabase:stop` 停止。

## Cloudflare Workers 部署

仓库使用现有 vinext 和 Cloudflare Vite 插件构建，部署配置为
[`wrangler.jsonc`](./wrangler.jsonc)。构建会生成 `dist/server/wrangler.json`
及 `.wrangler/deploy/config.json`；Wrangler 会自动使用这份构建产物配置。
`nodejs_compat` 由 `vite.config.ts` 提供，`ASSETS` 和 `IMAGES` 绑定供
`worker/index.ts` 的静态资源与图片优化入口使用。

在 Cloudflare 的 **Workers & Pages → Create application → Import a repository**
连接 GitHub 仓库，设置如下：

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `daily-attention`（当前生产站点） |
| 生产分支 | `main` |
| 根目录 | 仓库根目录 |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

仓库中的 Worker 名称与当前生产实例统一为 `daily-attention`，生产构建与分支预览均使用这个名称。
本机发布命令保留显式的 `--name daily-attention`，便于核对发布目标。
参见 [Cloudflare 构建说明](https://developers.cloudflare.com/workers/ci-cd/builds/troubleshoot/)。

在 **Build variables and secrets** 添加 `NODE_VERSION=22`、
`NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`。
两个 Supabase 值必须来自同一个正式项目，构建时会将公开配置写入前端产物。

在 Worker 的 **Settings → Variables and Secrets** 另行配置运行时变量；
构建变量不会自动成为运行时变量：

| 变量 | 类型 | 内容 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Text | 与构建配置一致 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Text | 与构建配置一致 |
| `SUPABASE_SECRET_KEY` | Secret | 现有正式项目的服务端密钥 |
| `AUTH_RATE_LIMIT_PEPPER` | Secret | 沿用现有生产配置，至少 32 字节的私密随机值 |
| `APP_ORIGIN` | Text | 当前生产值为 `https://aura-attention.com`，不带末尾 `/` |
| `AI_GENERATION_ENABLED` | Text | 启用 AI 时设置为 `true`；后台未就绪时使用 `false` |
| `DEEPSEEK_API_KEY` | Secret | 心得润色调用模型所需的 DeepSeek API 密钥 |
| `AI_USER_ID_PEPPER` | Secret | 与 AI Worker 一致、至少 32 字符的匿名用户标识密钥 |

`keep_vars: true` 保留控制台管理的运行时普通变量。密钥只放入 Secret，
不要写进 `wrangler.jsonc`、`NEXT_PUBLIC_*` 或提交到 GitHub。
本地 `.env.production.local` 和 `.dev.vars` 不会随 Git 自动上传到 Cloudflare。

本地部署预检（生产构建及打包检查，不上传、不发布）：

```bash
npm run deploy:check
```

如需从本机发布到当前生产站点：

```bash
npx wrangler login
npm run build
npx wrangler deploy --name daily-attention
```

使用 GitHub 自动部署时，在配置合入 `main` 后由 Cloudflare 执行上述构建和部署命令。
每次发布都应在 Cloudflare 的 Deployments 中确认新版本已就绪并接管生产流量。

此配置部署网站和 API。常驻 [AI Worker](./services/ai-worker/README.md)
及 [安全抓取服务](./services/safe-fetch-gateway/) 需要单独部署；
仅上传网站不能完成 AI 生成任务。发布前确认正式数据库迁移已应用，发布后验证
注册、登录、打卡保存和刷新读取。`deploy:check` 不验证 Cloudflare 账号权限、
线上 Secret、域名、生产数据库连接或大陆网络可用性。

AI 后台的两个 Railway 服务同样使用 `main` 分支。AI Worker 需要数据库密钥、
`DEEPSEEK_API_KEY`、`AI_USER_ID_PEPPER`、`AI_PROVIDER_MODE=deepseek` 及抓取网关地址和令牌；
网关需要同一份 `SAFE_FETCH_GATEWAY_TOKEN`。配置步骤、容器入口及健康检查见 [Railway 部署说明](./services/ai-worker/README.md#railway-生产部署)。

## 账户与草稿行为

学习记录以北京时间（`Asia/Shanghai`）判断今天，仅允许记录今天或过去日期。日历、保存接口与 AI 提炼入口均拒绝未来日期；数据库迁移 `supabase/migrations/20261014034015_reject_future_checkin_dates.sql` 同时限制直接写入和修改。旧的未来日期记录保留，到达对应日期后才可继续编辑。

当前开放注册。创建账户或成功找回账户时都会生成恢复码；恢复码仅能使用一次，
找回账户后会生成新码，请在关闭弹窗前记录新恢复码。

未保存的学习记录草稿存储在浏览器本地 IndexedDB 中，按登录账户和记录 ID 隔离，离线时仍可保留。
恢复联网后，由用户主动保存才会上传图片和写入云端；浏览器草稿不承担服务端数据迁移或导入。

## AI 功能与使用边界

负责人线上测试账号可通过私有表 `private.ai_quota_allowlist` 按用户 ID 加入每日额度白名单，AI 提炼与知识串联共用此权限。白名单仅由数据库管理员维护，普通账号仍为每日 5 次；实际调用计数继续记录，短时请求限流继续生效。新环境应用 `20261015113416_ai_quota_allowlist.sql`，升级时先部署支持不限额响应的应用，再应用迁移、添加账号；移除白名单后立即恢复每日额度校验。

AI 提炼最终因内容质量校验失败且未输出有效小结时，自动退回本次额度，并刷新余额、显示未消耗次数的提示。重试不重复扣费，退款按任务原始额度日期结算，重复回调不重复退款；已交付的待核对草稿仍沿用原计次规则。对应迁移为 `20261017044000_ai_quality_failure_refund.sql`，先应用数据库迁移，再更新应用和 Worker。

提炼阅读中的并列小点使用 bullet，有序步骤保留编号；关键短语和核心公式仅加粗。正文、展开阅读及完整小结共用安全的文本渲染，支持换行列表，不执行资料中的 HTML。新生成结果会按此规则标注重点，历史结果保留已有内容和标记。

本期 AI 提炼支持网页文章、文字教程、知识笔记等文字资料链接，只根据可访问的页面正文梳理知识骨架；暂不支持视频或音频内容解析。视频页面的简介不能代表视频内容，界面不承诺对视频进行提炼。

AI 提炼可选填写最多 1000 字符的「提炼要求」，指定学习重点、基础和讲解方式。留空采用默认方法；资料依据、概念关系和知识骨架结构始终保留。要求随账号、日期和 AI 记录保存，任务使用提交时的要求与提示词版本快照。修改要求后需重新提炼才会影响总结，界面可回看该结果实际使用的要求；重试同一请求不重复扣额度，新的提炼仍使用每日共享额度。旧记录无需补填要求。上线顺序见 [`services/ai-worker/README.md`](./services/ai-worker/README.md) 的提炼要求升级说明。

新版 AI 提炼以「核心主线 → 独立问题 → 本题答案与局部结构图」组织阅读。一篇资料可以包含多个问题，每题仅展示回答它所需的概念和关系；共用概念保留统一解释，并支持跳转到所属问题后返回。问题编号表示建议阅读顺序，不代表因果或执行流程。简单资料可以只有一个问题，没有原文依据时不强行连线。结果保存为可编辑小结；总字符硬性上限已取消，系统提示词仅建议最终小结尽量控制在 12000 字符以内，超过建议篇幅仍完整接收、解析、编辑和保存。结构、字段、引用及原文依据校验继续保留，旧格式继续展示，结构化文档编辑失效时保留完整原文。新环境需应用 [`20261013145413_remove_summary_character_limit.sql`](./supabase/migrations/20261013145413_remove_summary_character_limit.sql)。升级顺序与验收边界见 Worker 文档和 [`docs/ai-question-reader-qa-2026-09-27.md`](./docs/ai-question-reader-qa-2026-09-27.md)。

提炼与知识串联使用 `deepseek-flash` 的 `high` 思考模式；提炼格式修复和心得润色关闭思考。
常驻 Worker 单日提炼的模型调用总时限为 480 秒，知识串联为 120 秒。长文生成可能需要数分钟，
页面持续查询同一任务，具体超时、重试、原文截取与任务恢复边界见 Worker 文档。

学习记录按独立 ID 保存，同一天可以创建多条。点击「新增记录」直接进入编辑区，可在「手动记录 / AI 提炼」之间切换；切换保留当前草稿的主题、链接、小结、个人收获、图片、提炼要求和专辑，不会创建另一条记录。资料链接可选，也可填写书名、课程名、编号等普通文字，保存不校验网址格式；仅在 AI 提炼时校验可读取的 HTTP/HTTPS 链接。AI 提炼无需先收藏或手动保存。保存按钮旁显示处理中、成功或失败结果，失败时保留草稿供重试。上线前应用 `supabase/migrations/20261015081743_allow_learning_source_text.sql` 放宽来源字段约束。重复链接会提示已有记录，也可以继续创建。每条记录最多归入一个专辑。内容导航为「每日记录 / 全部记录 / 专辑」，不再单独提供待处理或未归类入口。「全部记录」按创建时间从新到旧纵向展示所有记录，保留筛选、编辑、删除和批量整理；输入部分主题名称即可搜索，英文不区分大小写，不检索正文或专辑名。搜索覆盖未加载的历史记录，搜索结果也支持继续加载，清空后恢复全部记录。主导航「专辑」可直接进入专辑列表，新建专辑、查看主题及完成数量；入口不受日历侧栏的展开状态影响；日历侧栏只展示日历，不再重复提供专辑入口。右上角账户入口保留小形象，主标题右侧不再重复展示大形象，页面主体的学习形象保留。日历统计按已完成记录的去重日期计算，知识串联按选定记录 ID 取材。

AI 提炼下的「用自己的话解释」支持 AI 润色：根据当前知识总结和已写回答生成建议，经用户采纳后只更新这一栏，支持撤销；仍需手动保存记录。建议不会自动写入打卡记录。润色通过应用服务器直接调用模型，因此应用服务器也需要配置 `DEEPSEEK_API_KEY`、至少 32 字符的 `AI_USER_ID_PEPPER` 和 `AI_GENERATION_ENABLED=true`；密钥不能使用 `NEXT_PUBLIC_` 前缀。沿用现有限流配置，每个账号 10 分钟最多请求 10 次润色，独立于下述每日提炼/串联额度；润色接口本身不新增数据库结构。

首页「串联知识」先展示已保存的脉络列表，支持编辑、复制独立副本和确认删除；右上角「新增串联知识」可选择 2–14 个跨月、不连续的已保存日期。同一主题生成以概念为节点的知识图谱：围绕核心问题组织知识主干，解释概念关系，并提供使用同一组概念的讲述提纲。必要时最多补充 3 个概念，标明「AI 补充」及补充原因，与原始记录和基于记录的推断区分。多领域混合或材料不足时直接展示原始来源快照，不强行连线或改写正文。

结果会自动保存，可编辑概念解释和提纲、回看来源或重新生成；原始记录模式仅编辑脉络名称。原记录更新后保留旧快照并提示更新，旧版知识流和主题叙事仍可读取、编辑和复制。知识串联与单日 AI 提炼共用每日 5 次额度，编辑与复制不消耗额度。图谱结果沿用现有 JSON 字段，无需转换旧数据；上线前先应用仓库中的待执行迁移，包括 `20260917114824_index_knowledge_narrative_quota_reference.sql` 补齐额度关联索引，再更新前端/API 并重启常驻 Worker，详见 [`services/ai-worker/README.md`](./services/ai-worker/README.md)。

当前应用不包含邀请流程、管理后台或旧数据导入功能。Supabase 是唯一的正式持久化与认证后端。

## 每日新知

首页新增网球入门新知：按个人进度阅读、可选自测、主动收下、跳过已了解内容，以及按主题回看「我的新知」。每天最多收下一条，日期由数据库按 `Asia/Shanghai` 计算；跳过与自测不计入收下数量，也不影响原有学习打卡、知识串联或 AI 额度。累计 7、14、30 条可展开知识回顾。

先应用 `supabase/migrations/20261009025954_daily_takeaways.sql`，再发布应用。新表启用 RLS，客户端不能直接写入；`GET/POST /api/daily-takeaways` 验证登录后调用仅服务端可执行的事务函数，处理并发、重复请求与每日限额。页面刷新会同步云端进度，但已展开的阅读内容保留至用户主动载入更新。

`lib/domain/tennis-lessons.ts` 包含 30 条附 ITF、USTA、LTA 来源的初稿。`sourceVerifiedAt` 仅表示资料核对日期，不代表已完成真人编辑审核。目录默认导入为未发布草稿，生产读取不会展示草稿。

```bash
# 校验目录，不连接数据库
node --experimental-strip-types scripts/sync-tennis-takeaways.mts
# 导入本地 Supabase，仍为待审核草稿
node --experimental-strip-types scripts/sync-tennis-takeaways.mts --apply
# 仅在真人逐条审核内容及来源后执行；填入实际审核人
node --experimental-strip-types scripts/sync-tennis-takeaways.mts --apply --publish --reviewer "实际审核人" --confirm-human-review
```

正式环境需显式加 `--configured-database`，并由环境提供 `NEXT_PUBLIC_SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`；不要将服务端密钥写入前端配置。已发布或曾经发布的内容修改必须递增 `version`、填写 `correctionNote` 并重新审核。撤回只停止新用户获取该条，历史保留最后审核内容和收下时的版本，不允许草稿覆盖历史。

本地体验运行 `npm run demo`，打开 `http://127.0.0.1:4300/?demo=1`。这是使用独立模拟数据的预览，不会发布目录或写入真实账号；可加 `&takeaway=history`、`milestone`、`corrected`、`save-error` 或 `complete` 检查不同状态。验证使用 `tests/unit/daily-takeaways/`、`supabase/tests/database/daily-takeaways.test.sql`、`tests/integration/daily-takeaways-api.test.ts` 和 `node tests/visual/verify-daily-takeaways.mjs`。
