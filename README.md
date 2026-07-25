# 今天你 Ai 了吗？

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
configuration because the current application uses phone-and-password accounts
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
npm run test:rendered
npm run test:integration
npm run lint
npm run typecheck
npm run build
```

`npm run test:integration` starts the local application with bindings from the
local Supabase instance. Stop local services with `npm run supabase:stop` when
you are finished.

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

This application has no invite flow, administrative console, or legacy-import
feature. It uses Supabase as its only formal persistence and authentication
backend.
