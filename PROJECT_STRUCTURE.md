# 项目代码导航

本仓库当前只有一套正式实现：网页端 + Supabase。日常开发从仓库根目录开始，
不需要进入 `.worktrees/`、`drizzle/` 或旧的微信登录目录。

## 最常用入口

| 要找的内容 | 目录或文件 |
| --- | --- |
| 登录、注册、找回页面 | `app/(auth)/` |
| 登录、注册、找回接口 | `app/api/auth/` |
| 登录表单和交互 | `features/auth/` |
| 打卡主页面 | `app/(app)/page.tsx` |
| 日历 | `features/calendar/` |
| 打卡编辑、保存、图片上传 | `features/checkins/` |
| 浏览器本地草稿 | `features/drafts/`、`lib/indexed-db/` |
| 服务端认证逻辑 | `server/auth/` |
| 服务端打卡逻辑 | `server/checkins/` |
| 图片存储逻辑 | `server/storage/` |
| Supabase 客户端 | `lib/supabase/` |
| 数据库迁移 | `supabase/migrations/` |
| 数据库安全测试 | `supabase/tests/database/` |
| 前端和接口测试 | `tests/` |
| Supabase 运维说明 | `docs/operations/supabase-runbook.md` |

## 顶层目录说明

```text
.
├── app/                 Next.js/vinext 路由、页面和 API
├── features/            按业务功能拆分的前端组件与状态
├── server/              只在服务端运行的业务逻辑
├── lib/                 通用领域模型、Supabase 和 IndexedDB 封装
├── supabase/            数据库迁移、配置、种子数据和数据库测试
├── tests/               单元、集成、渲染和端到端测试
├── public/              网站静态资源
├── scripts/             本地开发与测试脚本
├── docs/                架构、实施记录和运维文档
├── worker/              OpenAI Sites/Cloudflare 运行入口
├── .dev.vars.example    本地开发环境变量模板
└── .env.production.local 生产环境变量，仅保存在本机
```

## 环境变量

当前登录方式是“名称 + 密码”，认证和数据均由 Supabase 提供，不使用微信登录。

- `.dev.vars.example`：可提交的本地开发模板，只包含 Supabase、限流密钥和站点来源。
- `.dev.vars`：本地开发实际值，不提交。
- `.env.production.local`：生产环境实际值，不提交。

需要的变量：

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
AUTH_RATE_LIMIT_PEPPER
APP_ORIGIN
```

`docs/superpowers/` 和 `PROMPT_CHANGELOG.md` 可能提到微信、D1 或 R2，它们是历史设计与
迁移记录，不是当前运行代码或配置来源。

## 已废弃内容

以下内容已从正式版本删除，不应继续作为开发入口：

- `app/wechat-auth.ts`
- `app/api/auth/wechat/`
- `db/`
- `drizzle/`
- 微信登录环境变量
- Cloudflare D1/R2 作为正式数据源

若根目录中存在 `.local-backups/`，它只保存整理前的未跟踪文件，不参与构建和部署。
