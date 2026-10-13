# 知序 Aura

让每一次学习，连成自己的知识地图。以点成线，以线成面。在记录中积累，在关联中理解。

一个使用 Supabase 保存账户、打卡记录和图片的学习打卡应用。前端由
[vinext](https://github.com/cloudflare/vinext) 运行，支持部署到 Cloudflare Workers。

## Code Map

日常开发直接使用当前仓库根目录。页面、接口、服务端和数据库文件的位置见
[`PROJECT_STRUCTURE.md`](./PROJECT_STRUCTURE.md)。

最常用的入口：

- `app/(app)/page.tsx`：打卡主页面。
- `app/(auth)/`：登录、注册和找回页面。
- `features/`：日历、打卡编辑器、登录表单等前端功能。
- `server/`：认证、打卡、存储和限流服务。
- `supabase/migrations/`：正式数据库结构。

## Prerequisites

- Node.js `>=22.13.0`
- Docker Desktop（本地 Supabase 依赖 Docker）
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)

## Local Setup

```bash
npm install
npm run supabase:start
cp .dev.vars.example .dev.vars
npm run dev
```

Use `supabase status -o env` to copy the local API URL, publishable key, and
secret key into `.dev.vars`. Set `AUTH_RATE_LIMIT_PEPPER` to a private random
value of at least 32 bytes. `.dev.vars` is ignored and must not be committed.

Production values belong in `.env.production.local`, which is also ignored.
The active environment template is `.dev.vars.example`; it contains no WeChat
configuration because the current application uses email-and-password accounts
backed by Supabase.

The formal schema and data APIs are Supabase-owned. Apply all local migrations
and seed data with:

```bash
npm run supabase:reset
```

Regenerate the checked-in TypeScript database types after a deliberate schema
change:

```bash
npm run supabase:types
```

## Verification

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

`npm run test:integration` and `npm run test:e2e` use local Supabase bindings;
the E2E runner creates only reserved `e2e.daily-attention.invalid` accounts and
cleans them up only after exact Auth email ownership verification. Stop local
services with `npm run supabase:stop` when you are finished.

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
| Worker 名称 | `ai-learning-checkin`（必须与配置一致） |
| 生产分支 | `main` |
| 根目录 | 仓库根目录 |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

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
| `APP_ORIGIN` | Text | 网站实际 HTTPS 地址，不带末尾 `/`；绑定新域名后同步更新 |
| `AI_GENERATION_ENABLED` | Text | AI 后台部署并验证前使用 `false` |

`keep_vars: true` 保留控制台管理的运行时普通变量。密钥只放入 Secret，
不要写进 `wrangler.jsonc`、`NEXT_PUBLIC_*` 或提交到 GitHub。
本地 `.env.production.local` 和 `.dev.vars` 不会随 Git 自动上传到 Cloudflare。

本地部署预检（生产构建及打包检查，不上传、不发布）：

```bash
npm run deploy:check
```

如需从本机正式发布，先运行 `npx wrangler login` 授权，再运行 `npm run deploy`。
使用 GitHub 自动部署时，在配置合入 `main` 后由 Cloudflare 执行上述构建和部署命令。

此配置部署网站和 API。常驻 [AI Worker](./services/ai-worker/README.md)
及 [安全抓取服务](./services/safe-fetch-gateway/) 需要单独部署；
仅上传网站不能完成 AI 生成任务。发布前确认正式数据库迁移已应用，发布后验证
注册、登录、打卡保存和刷新读取。`deploy:check` 不验证 Cloudflare 账号权限、
线上 Secret、域名、生产数据库连接或大陆网络可用性。

## Account And Draft Behavior

Registration is open. Creating an account and successfully recovering access
each issue a recovery code. A recovery code is one-time use: after recovery it
is replaced, so record the newly shown code before closing the dialog.

Unsaved check-in drafts live in the browser's local IndexedDB store and are
scoped to the signed-in account and date. They remain available while offline;
images and cloud saves resume only after the browser is online and the user
explicitly saves. Browser-local drafts are not a server-side migration or
import mechanism.

## Scope

本期 AI 提炼支持网页文章、文字教程、知识笔记等文字资料链接，只根据可访问的页面正文梳理知识骨架；暂不支持视频或音频内容解析。视频页面的简介不能代表视频内容，界面不承诺对视频进行提炼。

AI 提炼可选填写最多 1000 字符的「提炼要求」，指定学习重点、基础和讲解方式。留空采用默认方法；资料依据、概念关系和知识骨架结构始终保留。要求随账号、日期和 AI 记录保存，任务使用提交时的要求与提示词版本快照。修改要求后需重新提炼才会影响总结，界面可回看该结果实际使用的要求；重试同一请求不重复扣额度，新的提炼仍使用每日共享额度。旧记录无需补填要求。上线顺序见 [`services/ai-worker/README.md`](./services/ai-worker/README.md) 的提炼要求升级说明。

新版 AI 提炼以「核心主线 → 独立问题 → 本题答案与局部结构图」组织阅读。一篇资料可以包含多个问题，每题仅展示回答它所需的概念和关系；共用概念保留统一解释，并支持跳转到所属问题后返回。问题编号表示建议阅读顺序，不代表因果或执行流程。简单资料可以只有一个问题，没有原文依据时不强行连线。结果保存在最多 12000 字符的可编辑小结中；旧格式继续展示，结构化文档编辑失效时保留完整原文。升级顺序与验收边界见 Worker 文档和 [`docs/ai-question-reader-qa-2026-09-27.md`](./docs/ai-question-reader-qa-2026-09-27.md)。

手动记录与 AI 提炼按账号、日期和方式独立保存，各自拥有主题、来源、小结、收获、图片与版本。切换前立即保存浏览器草稿；AI 生成、润色与还原只影响 AI 记录。日历展示同一天的两类主题，统计按去重后的学习日期计算。知识串联从进入该功能时所选方式的已保存记录取材，重新生成沿用来源快照中的方式。旧云端记录与浏览器草稿原样归入手动记录，不推断历史来源。部署这次隔离功能前，先应用 `supabase/migrations/20260916123432_checkin_entry_mode_isolation.sql`，再发布应用；旧接口不带方式时仍读取或写入手动记录。

AI 提炼下的「用自己的话解释」支持 AI 润色：根据当前知识总结和已写回答生成建议，经用户采纳后只更新这一栏，支持撤销；仍需手动保存记录。建议不会自动写入打卡记录。润色通过应用服务器直接调用模型，因此应用服务器也需要配置 `DEEPSEEK_API_KEY`、至少 32 字符的 `AI_USER_ID_PEPPER` 和 `AI_GENERATION_ENABLED=true`；密钥不能使用 `NEXT_PUBLIC_` 前缀。沿用现有限流配置，每个账号 10 分钟最多请求 10 次润色，独立于下述每日提炼/串联额度；润色接口本身不新增数据库结构。

首页「串联知识」先展示已保存的脉络列表，支持编辑、复制独立副本和确认删除；右上角「新增串联知识」可选择 2–14 个跨月、不连续的已保存日期。同一主题生成以概念为节点的知识图谱：围绕核心问题组织知识主干，解释概念关系，并提供使用同一组概念的讲述提纲。必要时最多补充 3 个概念，标明「AI 补充」及补充原因，与原始记录和基于记录的推断区分。多领域混合或材料不足时直接展示原始来源快照，不强行连线或改写正文。

结果会自动保存，可编辑概念解释和提纲、回看来源或重新生成；原始记录模式仅编辑脉络名称。原记录更新后保留旧快照并提示更新，旧版知识流和主题叙事仍可读取、编辑和复制。知识串联与单日 AI 提炼共用每日 5 次额度，编辑与复制不消耗额度。图谱结果沿用现有 JSON 字段，无需转换旧数据；上线前先应用仓库中的待执行迁移，包括 `20260917114824_index_knowledge_narrative_quota_reference.sql` 补齐额度关联索引，再更新前端/API 并重启常驻 Worker，详见 [`services/ai-worker/README.md`](./services/ai-worker/README.md)。

This application has no invite flow, administrative console, or legacy-import
feature. It uses Supabase as its only formal persistence and authentication
backend.

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
