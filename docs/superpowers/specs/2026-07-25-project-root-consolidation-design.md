# 项目根目录整理设计

## 目标

将 `codex/supabase-web-v1` 中已经完成的 Supabase 网页版整理为仓库根目录的唯一正式
项目，消除旧 `main` 中微信登录、D1 和 Drizzle 文件造成的误导。

## 整理方式

1. 为整理前的 `main` 建立只读回退分支。
2. 将根目录里未被 Git 跟踪的重复文件移入 `.local-backups/`，不直接删除。
3. 将 `main` 快进到 `codex/supabase-web-v1`。
4. 将 worktree 中私有的 `.env.production.local` 复制到新根目录，环境值不写入 Git。
5. 用 `PROJECT_STRUCTURE.md` 标出页面、接口、服务端、数据库和测试的正式入口。
6. 保留历史架构文档中的旧技术名词，但明确它们不属于当前运行配置。

## 安全边界

- 不改写已有提交历史。
- 不提交任何环境变量实际值。
- 不删除未跟踪文件，先备份并生成文件清单。
- 不修改 Supabase 生产数据库结构或业务代码。

## 完成标准

- 仓库根目录的 `main` 指向最新 Supabase 版本。
- 根目录不再包含正式微信登录、D1 或 Drizzle 代码。
- `.dev.vars.example` 只列出当前 Supabase 相关变量。
- 用户可通过 `README.md` 和 `PROJECT_STRUCTURE.md` 快速找到有用代码。
