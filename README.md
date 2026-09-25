# 知序 Aura

让每一次学习，连成自己的知识地图。以点成线，以线成面。在记录中积累，在关联中理解。

一个使用 Supabase 保存账户、打卡记录和图片的学习打卡应用。前端由
[vinext](https://github.com/cloudflare/vinext) 运行，并部署到 OpenAI Sites。

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

手动记录与 AI 提炼按账号、日期和方式独立保存，各自拥有主题、来源、小结、收获、图片与版本。切换前立即保存浏览器草稿；AI 生成、润色与还原只影响 AI 记录。日历展示同一天的两类主题，统计按去重后的学习日期计算。知识串联从进入该功能时所选方式的已保存记录取材，重新生成沿用来源快照中的方式。旧云端记录与浏览器草稿原样归入手动记录，不推断历史来源。部署这次隔离功能前，先应用 `supabase/migrations/20260916123432_checkin_entry_mode_isolation.sql`，再发布应用；旧接口不带方式时仍读取或写入手动记录。

AI 提炼下的「用自己的话解释」支持 AI 润色：根据当前知识总结和已写回答生成建议，经用户采纳后只更新这一栏，支持撤销；仍需手动保存记录。建议不会自动写入打卡记录。润色通过应用服务器直接调用模型，因此应用服务器也需要配置 `DEEPSEEK_API_KEY`、至少 32 字符的 `AI_USER_ID_PEPPER` 和 `AI_GENERATION_ENABLED=true`；密钥不能使用 `NEXT_PUBLIC_` 前缀。沿用现有限流配置，每个账号 10 分钟最多请求 10 次润色，独立于下述每日提炼/串联额度；润色接口本身不新增数据库结构。

首页「串联知识」先展示已保存的脉络列表，支持编辑、复制独立副本和确认删除；右上角「新增串联知识」可选择 2–14 个跨月、不连续的已保存日期。同一主题生成以概念为节点的知识图谱：围绕核心问题组织知识主干，解释概念关系，并提供使用同一组概念的讲述提纲。必要时最多补充 3 个概念，标明「AI 补充」及补充原因，与原始记录和基于记录的推断区分。多领域混合或材料不足时直接展示原始来源快照，不强行连线或改写正文。

结果会自动保存，可编辑概念解释和提纲、回看来源或重新生成；原始记录模式仅编辑脉络名称。原记录更新后保留旧快照并提示更新，旧版知识流和主题叙事仍可读取、编辑和复制。知识串联与单日 AI 提炼共用每日 5 次额度，编辑与复制不消耗额度。图谱结果沿用现有 JSON 字段，无需转换旧数据；上线前先应用仓库中的待执行迁移，包括 `20260917114824_index_knowledge_narrative_quota_reference.sql` 补齐额度关联索引，再更新前端/API 并重启常驻 Worker，详见 [`services/ai-worker/README.md`](./services/ai-worker/README.md)。

This application has no invite flow, administrative console, or legacy-import
feature. It uses Supabase as its only formal persistence and authentication
backend.
