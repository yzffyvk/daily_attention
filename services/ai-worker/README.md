# 常驻 AI Worker

应用创建任务后立即返回 `202`。本服务独立轮询 Supabase 队列，复用已有抓取、提炼、数据库状态转换与每日 5 次额度逻辑。

## 本地运行

前提：Node.js 22.13 以上、项目依赖已安装，本项目 Supabase 数据库/API 已启动。在项目根目录的三个终端分别运行：

```sh
npm run dev
npm run dev:gateway
npm run dev:ai-worker
```

三个进程都需要保持运行。关闭终端或重启电脑后应重新启动。不要同时运行旧 `ai-generation-worker` Edge Function 消费者。

`.dev.vars` 保留现有密钥，并设置：

```dotenv
AI_GENERATION_ENABLED=true
AI_PROVIDER_MODE=deepseek
SAFE_FETCH_GATEWAY_URL=http://127.0.0.1:8788
AI_WORKER_HEALTH_PORT=8790
```

还需要 `NEXT_PUBLIC_SUPABASE_URL`（或 `SUPABASE_URL`）、`SUPABASE_SECRET_KEY`、`DEEPSEEK_API_KEY`、`AI_USER_ID_PEPPER`、`SAFE_FETCH_GATEWAY_TOKEN`。密钥不得提交或打印。Node Worker 不需要 `AI_WORKER_TRIGGER_TOKEN`。

检查服务：

```sh
curl http://127.0.0.1:8788/healthz
curl http://127.0.0.1:8790/readyz
```

均应返回 `{"ok":true}`。`/healthz` 只检查 Worker 进程；`/readyz` 检查轮询是否成功，不保证上游模型可用。

## 行为与边界

- 每秒轮询；队列读取失败按 1、2、4、8、16、30 秒退避。
- 每批最多领取 2 条、并发 2 条，避免 5 条任务排队等待超过 180 秒可见性租期。
- 网关总抓取上限 15 秒；连接失败会尝试本次 DNS 查询的其他已验证公网地址。每个重定向重新验证，HTTP 拒绝不会触发地址回退。
- 模型仍为 `deepseek-v4-pro`，思考模式 `high`，模型调用上限 120 秒。
- 退出时停止新读取，最多等待 170 秒让当前任务完成。强制退出中断的处理中任务仍需现有维护任务处理，不能承诺模型请求跨进程崩溃的严格 exactly-once。
- 成功结果仍是待用户确认的草稿，不自动保存打卡。

## 部署提醒

本次修复验收的是 localhost。线上需要单独部署常驻 Node 服务并配置进程守护；执行 `NODE_ENV=production node --experimental-strip-types services/ai-worker/index.ts` 时由部署环境注入密钥。线上网关必须 HTTPS，HTTP 回环例外仅在开发模式开启。

当前 Worker 复用 `supabase/functions/ai-generation-worker/index.ts` 导出的处理逻辑；导入不会启动 Edge 服务，也不依赖 Deno 全局。旧 HTTP 入口只为兼容保留，应用不再触发它。部署时停用旧消费者的 Cron，保留 `ai-generation-maintenance` 的清理与恢复调度。独立容器打包与线上验收不包含在本次本地修复结果内。
