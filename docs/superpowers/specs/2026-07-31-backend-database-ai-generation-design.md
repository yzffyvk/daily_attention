# 后端、数据库与 AI 提炼设计

日期：2026-07-31

状态：已确认，待实施计划

适用项目：今天你 Ai 了吗？

## 1. 目标

本设计分两个阶段完善现有产品：

1. 加固已有 Supabase 后端与数据库，改善统计性能、权限审计、存储清理、错误契约和可观测性。
2. 在现有“AI 提炼”前端流程中接入异步生成能力。用户提交公开网页链接后，系统使用 DeepSeek V4 Pro 生成可编辑的 `attention`、知识小结和灵感，用户审阅后再保存为正式打卡。

首版面向每天数百至数千次任务的公开产品规模。每位用户每天最多发起 5 次有效 AI 生成，日界线固定使用 `Asia/Shanghai`。

## 2. 已有系统

项目继续使用现有技术栈：

- Next.js/vinext 路由与 OpenAI Sites/Cloudflare 运行入口。
- Supabase Auth、Postgres、Storage 和现有 SSR 客户端。
- `public.profiles` 保存用户资料。
- `public.check_ins` 保存每日打卡，并使用 `version` 做乐观并发控制。
- 私有图片 bucket、上传预约、容量和频率限制。
- API 统一成功/失败 envelope、请求 ID、单元测试、集成测试、数据库测试和端到端测试。

本设计不替换现有认证、打卡或图片存储方案，也不改变现有前端 API 的成功响应结构。

## 3. 已确认的产品范围

### 3.1 首版包含

- 输入仅为一个公开 HTTP/HTTPS 网页链接。
- 对普通文章、公开视频页、课程页和动态页面做尽力解析。
- 登录页、付费墙、内网地址、无法合法抓取或无法提取正文的页面返回明确失败。
- 任务异步处理，前端轮询状态。
- DeepSeek 官方 API，模型固定为 `deepseek-v4-pro`。
- 始终开启思考模式，首版 `reasoning_effort` 使用 `high`。
- AI 输出只回填当前草稿，不自动创建或覆盖正式打卡。
- 网页正文仅在 worker 内存中处理，不长期保存。
- `reasoning_content` 不保存、不记录日志、不返回前端。
- 每位用户每天最多 5 个进入模型调用阶段的生成任务。

### 3.2 首版不包含

- 用户上传 PDF、图片、音频或视频作为 AI 输入。
- 需要账号登录或绕过付费墙的内容。
- 通用无头浏览器或第三方网页解析供应商。
- AI 生成历史对比、版本选择或知识库检索。
- 订阅、付费额度和用户自助账单。
- 自动保存 AI 输出或无人工确认的内容发布。
- 管理后台 UI。首版通过数据库、平台日志和指标完成运维。

动态页面兼容性采用尽力而为策略。若普通 HTTP 抓取和静态内容提取无法获得足够正文，首版直接返回不支持，不尝试绕过站点限制。

## 4. 总体架构

```text
Browser
  │
  ├─ POST /api/ai/generations
  │    └─ Next API：会话、URL、幂等键、功能开关校验
  │          └─ service-role RPC（单事务）
  │                ├─ 预留每日额度
  │                ├─ 创建 private.ai_generation_jobs
  │                └─ pgmq.send(ai_generation_jobs, { job_id })
  │
  └─ GET /api/ai/generations/:jobId
       └─ Next API：只返回当前用户的任务状态和临时结果

Supabase Cron 或创建任务后的 best-effort 触发
  └─ Supabase Edge Function worker
       ├─ 从 Supabase Queue 领取消息
       ├─ 原子认领任务
       ├─ 安全抓取和提取正文
       ├─ 开始模型调用并消耗额度
       ├─ DeepSeek V4 Pro Chat Completions
       ├─ JSON + Zod 校验
       └─ 写入成功结果或稳定失败码
```

Supabase Queue 使用 Postgres `pgmq` 的持久消息、可见性超时和重试语义。队列只保存 `job_id`，不保存网页正文或完整 URL。

创建任务后，Next API 可以 best-effort 调用 worker 以减少首轮等待；Supabase Cron 是可靠兜底，定期触发 worker 消费批次。即时触发失败不影响已经入队的任务。

## 5. 阶段一：现有后端加固

阶段一不改变产品功能，重点降低在 AI 功能加入前的已知风险。

### 5.1 数据库权限与健康检查

- 运行 Supabase Database Advisors。
- 复核 `public` 暴露 schema 中所有表均已启用 RLS。
- 复核 `SECURITY DEFINER` 函数都设置空 `search_path`，并显式撤销 `PUBLIC`、`anon`、`authenticated` 的执行权限。
- 只向 `service_role` 授予必须的函数执行权限。
- 复核 Storage policy、对象路径约束、上传预约表和配额函数。
- 保留现有迁移历史，通过新迁移增量修改，不重写已经应用的迁移。

### 5.2 打卡统计性能

现有连续打卡统计会读取用户的所有打卡日期后在应用层计算。阶段一改为数据库侧聚合或受控 RPC：

- 单次查询返回总记录数、当前连续天数和今天是否打卡。
- 保留 `(user_id, checkin_date desc)` 索引。
- API 响应契约保持不变。
- 使用具有多年数据的测试样本验证结果与原实现一致。

### 5.3 Storage 生命周期

- 定时删除已经过期且未形成 Storage 对象的上传预约。
- 检测长期未被 `check_ins.image_path` 引用的孤儿图片。
- 孤儿清理采用先记录、后删除的安全流程，且删除失败可重试。
- 所有清理日志只记录对象路径摘要、用户 ID 摘要、任务 ID和错误码，不记录签名 URL。

### 5.4 API 与日志

- `requestId` 贯穿路由、service、repository 和错误日志。
- 错误日志使用结构化字段，不直接打印请求体、邮箱、恢复码、图片签名 URL 或 Supabase/DeepSeek 密钥。
- 对外错误继续使用稳定 `code`、用户可理解的 `message` 和可选 `details`。
- 服务器异常细节只进入受控日志，不进入 API 响应。

## 6. 数据库设计

### 6.1 `private.ai_generation_jobs`

该表是任务状态、临时结果、提供商用量和排障元数据的唯一业务事实来源。表不通过 Data API 暴露给客户端。

主要字段：

| 字段 | 类型与约束 | 用途 |
| --- | --- | --- |
| `id` | `uuid primary key default gen_random_uuid()` | 任务 ID |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` | 所属用户 |
| `target_date` | `date not null` | 回填草稿对应日期 |
| `idempotency_key` | `uuid not null` | 防止重复点击创建重复任务 |
| `source_url` | `text not null`，最长 2048 | 规范化后的输入 URL |
| `source_host` | `text not null` | 日志和兼容率聚合使用的主机名 |
| `source_title` | `text`，最长 300 | 成功提取的页面标题 |
| `content_digest` | `bytea` | 正文摘要指纹，不保存正文 |
| `status` | `text` + check | 任务状态 |
| `attempt_count` | `smallint not null default 0` | worker 处理次数 |
| `provider_call_count` | `smallint not null default 0` | DeepSeek 实际调用次数 |
| `attention` | `varchar(120)` | 临时生成标题 |
| `summary` | `text`，最长 5000 | 临时知识小结 |
| `inspiration` | `text`，最长 2000 | 临时灵感 |
| `warnings` | `jsonb not null default '[]'` | 受 schema 校验的字符串数组 |
| `error_code` | `text` | 稳定失败码 |
| `error_message` | `text` | 可向当前用户展示的安全消息 |
| `provider` | `text not null default 'deepseek'` | 提供商审计 |
| `model` | `text not null default 'deepseek-v4-pro'` | 实际模型 |
| `thinking_enabled` | `boolean not null default true` | 模型模式 |
| `reasoning_effort` | `text not null default 'high'` | 思考强度 |
| `prompt_version` | `text not null` | 可追踪提示词版本 |
| `prompt_tokens` | `integer` | 输入 token 总量 |
| `prompt_cache_hit_tokens` | `integer` | 缓存命中输入 token |
| `prompt_cache_miss_tokens` | `integer` | 缓存未命中输入 token |
| `completion_tokens` | `integer` | 生成 token 总量 |
| `reasoning_tokens` | `integer` | 其中的推理 token |
| `created_at` | `timestamptz not null default now()` | 创建时间 |
| `started_at` | `timestamptz` | 首次开始时间 |
| `finished_at` | `timestamptz` | 终态时间 |
| `result_expires_at` | `timestamptz` | 临时结果清理时间 |
| `metadata_expires_at` | `timestamptz` | 任务元数据清理时间 |
| `updated_at` | `timestamptz not null default now()` | 最后更新时间 |

约束和索引：

- `unique (user_id, idempotency_key)`。
- `status` 只允许 `queued`、`fetching`、`generating`、`retryable`、`succeeded`、`failed`、`cancelled`。
- 成功状态必须包含三个结果字段，失败状态必须包含 `error_code`。
- token 字段不得为负数。
- 索引 `(status, created_at)` 支持 worker 和运维查询。
- 索引 `(user_id, created_at desc)` 支持用户任务查询。
- 索引 `result_expires_at`、`metadata_expires_at` 支持清理任务。

### 6.2 `private.ai_daily_quotas`

| 字段 | 类型与约束 | 用途 |
| --- | --- | --- |
| `user_id` | `uuid references auth.users(id) on delete cascade` | 用户 |
| `quota_date` | `date` | `Asia/Shanghai` 的额度日期 |
| `reserved_count` | `smallint not null default 0` | 已排队但未调用模型 |
| `consumed_count` | `smallint not null default 0` | 已开始调用模型 |
| `updated_at` | `timestamptz not null default now()` | 更新时间 |

主键为 `(user_id, quota_date)`，并检查：

```text
reserved_count >= 0
consumed_count >= 0
reserved_count + consumed_count <= 5
```

### 6.3 原子服务函数

新增 service-role-only 的 `SECURITY DEFINER` RPC。函数放在可由服务端 RPC 调用的 schema 中，但必须：

- `set search_path = ''`。
- 创建后立即撤销 `PUBLIC`、`anon`、`authenticated` 权限。
- 只向 `service_role` 授予执行权限。
- 在函数体内验证所有用户 ID、任务 ID 和状态前置条件。

核心事务：

1. `create_ai_generation_job`：锁定或创建当日额度行，检查总数小于 5，增加 `reserved_count`，插入任务，并调用 `pgmq.send`。所有步骤同事务提交。
2. `begin_ai_generation`：仅当任务处于 `fetching` 时，把 `reserved_count - 1`、`consumed_count + 1`，并把任务切换为 `generating`。
3. `release_ai_generation_reservation`：只在尚未调用 DeepSeek 的终态失败或取消时减少 `reserved_count`。
4. `complete_ai_generation_job`：只允许从 `generating` 原子切换到 `succeeded` 或 `failed`。

函数必须以行锁或等效事务锁保护额度行，确保并发请求无法突破每日 5 次。

## 7. 任务状态机

```text
queued ──领取──> fetching ──开始模型调用──> generating ──校验成功──> succeeded
  │                 │                              │
  │                 ├─临时故障──> retryable ──────┤
  │                 └─永久故障──────────────────> failed
  └─用户取消────────────────────────────────────> cancelled
```

规则：

- 用户取消只允许发生在 `queued`。
- `retryable` 最多重新处理至 `attempt_count = 3`。
- DeepSeek 的内部重试保持同一个任务和同一个用户额度，但增加 `provider_call_count` 并累计 token。
- 每个状态迁移使用条件更新或受控 RPC，重复消息不得造成重复扣额或重复写入。
- Queue visibility timeout 必须大于单次 worker 的最大处理时间。
- 成功处理后删除或归档消息；失败抛出时消息保留，等待可见性超时后重试。

## 8. 网页抓取与正文提取

### 8.1 URL 安全

创建任务时做语法校验，worker 抓取前做最终网络校验：

- 只允许 `https:` 和 `http:`。
- 禁止 URL 中的用户名、密码和片段。
- 首版只允许 80、443 或未显式指定端口。
- 拒绝 `localhost`、环回、私网、链路本地、组播、保留地址和云元数据地址。
- DNS 解析后的每个 A/AAAA 地址都必须通过检查。
- 每次重定向重新规范化、解析 DNS 并检查目标，最多 5 次。
- DNS 校验后发起请求时必须防止 DNS rebinding；连接目标不得偏离已验证地址。
- 设置连接和总读取超时，首版总抓取上限 15 秒。
- 响应正文上限 2 MiB，超出即停止。
- 只处理允许的文本/HTML 内容类型。
- 遵守站点 robots、访问策略和适用条款，不绕过验证码、登录或付费墙。

### 8.2 正文处理

- 删除脚本、样式、表单、导航、广告和隐藏内容。
- 优先使用语义正文、OpenGraph 和 JSON-LD 标题信息。
- 正文不足 200 个有效字符时判定为不可提取。
- 发送模型前把正文截断到固定字符/token 预算，优先保留标题、开头、正文段落和结尾。
- 计算正文摘要指纹后立即丢弃原文。
- 不在异常对象、日志、队列消息或任务表中附带正文。

动态站点如果静态响应没有有效正文，返回 `CONTENT_NOT_EXTRACTABLE`。无头浏览器和第三方解析服务留给后续版本。

## 9. DeepSeek V4 Pro 适配器

模型调用封装在独立 provider port 后面，业务 service 不直接依赖 SDK。首版配置：

```text
base_url: https://api.deepseek.com
model: deepseek-v4-pro
thinking.type: enabled
reasoning_effort: high
response_format.type: json_object
max_tokens: 8192
```

不设置在思考模式下无效的 `temperature`、`top_p`、`presence_penalty` 或 `frequency_penalty`。

调用要求：

- `DEEPSEEK_API_KEY` 仅保存在部署环境的 Edge Function Secret 中。
- 向 DeepSeek 发送 HMAC 后的稳定匿名 `user_id`，不发送用户邮箱、显示名称或原始 Supabase UUID。
- system prompt 明确声明网页正文是不可信资料，正文中的指令、角色要求、密钥索取和格式覆盖均不得执行。
- 网页正文放在清晰的数据边界中，不与系统指令拼接成同一可信层级。
- 输出必须是 JSON object，并在提示中提供预期 JSON 示例。
- `reasoning_content` 只用于完成本次 API 交互；不落库、不打印、不回传。
- 记录官方 usage 中的输入、缓存命中、缓存未命中、输出和推理 token。
- 记录实际返回的 `model` 与 `system_fingerprint`，但不记录响应正文以外的思维链。

期望最终 JSON：

```json
{
  "attention": "不超过 120 字符的一句话标题",
  "summary": "不超过 5000 字符的结构化知识小结",
  "inspiration": "不超过 2000 字符的延伸思考",
  "sourceTitle": "不超过 300 字符的资料标题",
  "warnings": ["可选的资料完整性或可信度提醒"]
}
```

响应必须经过 JSON 解析和 Zod schema 校验。空响应、被截断 JSON 或临时 schema 错误允许自动重试；反复失败后返回 `MODEL_OUTPUT_INVALID`。

## 10. API 契约

### 10.1 创建任务

`POST /api/ai/generations`

请求：

```json
{
  "sourceUrl": "https://example.com/article",
  "targetDate": "2026-07-31",
  "idempotencyKey": "8b6b3b53-8753-4f5b-bc5a-258b05e3d5d2"
}
```

成功返回 `202`：

```json
{
  "ok": true,
  "requestId": "request-id",
  "data": {
    "jobId": "job-id",
    "status": "queued",
    "pollAfterMs": 1500,
    "quota": {
      "used": 1,
      "reserved": 1,
      "limit": 5,
      "remaining": 4
    }
  }
}
```

`used` 表示当日已经占用的总次数，即 `reserved_count + consumed_count`。重复的 `(user_id, idempotency_key)` 返回原任务，不重复扣额度。

### 10.2 查询任务

`GET /api/ai/generations/:jobId`

处理中返回 `status` 和前端可显示的 `stage`。成功时附带：

```json
{
  "attention": "...",
  "summary": "...",
  "inspiration": "...",
  "sourceTitle": "...",
  "warnings": []
}
```

失败时附带：

```json
{
  "errorCode": "CONTENT_NOT_EXTRACTABLE",
  "message": "未能从该页面读取足够的公开正文",
  "retryable": false
}
```

只有当前会话用户可以读取自己的任务。过期结果返回 `RESULT_EXPIRED`，不再返回生成正文。

### 10.3 取消任务

`DELETE /api/ai/generations/:jobId`

仅 `queued` 状态可取消。成功后释放预留额度。已经开始抓取或生成时返回 `409 JOB_ALREADY_STARTED`。

### 10.4 通用错误码

| HTTP | 错误码 | 含义 |
| --- | --- | --- |
| 401 | `SESSION_EXPIRED` | 登录失效 |
| 403 | `FEATURE_DISABLED` | AI 功能未开放 |
| 403 | `FORBIDDEN_JOB` | 无权访问任务 |
| 409 | `JOB_ALREADY_STARTED` | 已无法取消 |
| 422 | `VALIDATION_ERROR` | 请求格式错误 |
| 422 | `URL_NOT_ALLOWED` | URL scheme、端口或地址不允许 |
| 429 | `DAILY_AI_LIMIT_REACHED` | 当天 5 次已用完 |
| 429 | `RATE_LIMITED` | 短时请求过快 |
| 503 | `AI_SERVICE_UNAVAILABLE` | 队列或提供商暂不可用 |

任务内部错误进一步区分：

- `FETCH_TIMEOUT`
- `TOO_MANY_REDIRECTS`
- `RESPONSE_TOO_LARGE`
- `UNSUPPORTED_CONTENT_TYPE`
- `CONTENT_NOT_EXTRACTABLE`
- `CONTENT_BLOCKED`
- `MODEL_RATE_LIMITED`
- `MODEL_OUTPUT_INVALID`
- `MODEL_SERVICE_ERROR`
- `TASK_RETRY_EXHAUSTED`

错误消息不得包含内部地址、DNS 结果、SQL、堆栈、密钥或 DeepSeek 原始响应。

## 11. 前端交互

- “生成知识小结”按钮创建稳定 `idempotencyKey`，网络重试继续复用该键。
- 活跃 `jobId` 与目标日期写入现有本地草稿存储，以便刷新后恢复轮询。
- 轮询间隔从 1.5 秒开始，逐步增加到 5 秒；页面隐藏时降低频率。
- UI 显示 `排队中`、`正在读取资料`、`正在生成小结`、`正在校验结果`。
- 超过两分钟仍未完成时显示“仍在处理中”，但不把任务判为失败。
- 成功结果回填当前日期的本地草稿；用户仍可编辑所有字段。
- 只有用户点击现有“保存打卡”后，结果才进入 `public.check_ins`。
- 若目标日期已经切换，结果保存到对应日期草稿，不覆盖当前正在编辑的其他日期。
- 失败时保留原 URL 和用户已有草稿内容。

## 12. 额度与短时限流

每日额度控制成本，短时限流控制滥用和队列压力：

- 每位用户每天最多 5 个进入模型调用阶段的生成任务。
- 合法任务创建时先预留 1 次。
- 抓取阶段永久失败或用户在排队时取消，释放预留次数。
- worker 即将调用 DeepSeek 时，把预留转为已消耗。
- DeepSeek 超时、限流、服务错误或无效输出仍视为已消耗，因为已经产生提供商调用。
- 同一任务的内部重试不再占用新的用户次数，但每次调用都累计实际成本指标。
- 创建任务另加每用户和 IP 的短时速率限制。
- 查询任务使用单独、较宽松的轮询速率限制。

## 13. 数据生命周期

- 网页正文：worker 内存中存在，处理完成后立即释放。
- `reasoning_content`：不保存。
- 成功结果字段：终态后保留 24 小时，之后置空。
- 失败用户消息：随结果保留 24 小时。
- 任务状态、URL 主机、内容指纹、错误码、模型、prompt 版本和 token 用量：保留 90 天。
- 90 天后删除任务元数据。
- Queue archive 仅保留定位可靠性所需的短周期，不把它作为长期业务历史。
- 清理任务幂等、可重试，并记录删除数量与失败码。

完整 `source_url` 属于用户数据。API 只向任务所有者返回；平台日志只记录 `source_host` 和 URL 的不可逆摘要。

## 14. 安全设计

### 14.1 身份和授权

- 所有 AI API 必须有有效 Supabase 会话。
- API 从会话确定 `user_id`，不接受客户端传入的用户 ID。
- 私有表不直接暴露给 `anon` 或 `authenticated`。
- service-role RPC 显式检查任务所有权和状态。
- DeepSeek 密钥永远不进入浏览器 bundle、公开环境变量、数据库或日志。

### 14.2 Prompt Injection

- 抓取内容一律标记为不可信资料。
- system prompt 的优先级和固定输出契约不可由网页正文覆盖。
- 模型没有数据库、网络、Storage 或任意函数工具权限。
- 首版不让 DeepSeek 自主抓取网页；抓取由受控 worker 完成。
- 输出只接受预定义 JSON 字段，超长、额外类型或无效内容直接拒绝。

### 14.3 数据最小化

- 不把邮箱、显示名称、恢复码、图片或其他打卡历史发送给 DeepSeek。
- DeepSeek `user_id` 使用带服务端 pepper 的 HMAC 匿名标识。
- 不保存网页正文或思维链。
- 运维日志默认不含用户输入和模型完整输出。

## 15. 可观测性

`requestId` 和 `jobId` 贯穿 API、数据库状态、队列和 worker 日志。需要监控：

- Queue 深度和最老可见任务年龄。
- `queued`、`fetching`、`generating` 各阶段耗时分布。
- 成功率、网页提取成功率、失败码和重试次数。
- DeepSeek provider latency、429、5xx、资源不足和内容过滤。
- 输入 token、缓存命中/未命中 token、推理 token、输出 token。
- 每日用户额度使用量、全站调用量和异常突增。
- 清理任务、额度 RPC、入队和消息删除失败数。

首版告警基线：

- 最老 `queued` 任务超过 2 分钟。
- 滚动 15 分钟成功率低于 90%，且样本量达到告警阈值。
- DeepSeek 429 或 5xx 连续突增。
- 单任务 token 超过配置上限。
- 额度事务、队列入队或生命周期清理失败。

具体阈值必须配置化，并在灰度期根据真实流量校准。

## 16. 测试设计

### 16.1 单元测试

- URL 规范化、协议/端口/IP 检查、DNS 与重定向验证。
- 正文提取、字符预算和摘要指纹。
- 状态机允许与禁止的迁移。
- DeepSeek 请求参数、思考模式、匿名 `user_id`。
- JSON 解析、Zod 校验、空响应和截断响应。
- 提供商错误到稳定任务错误码的映射。
- 额度的预留、消耗、释放和剩余次数计算。

### 16.2 数据库测试

- 6 个并发创建请求最多只有 5 个成功占用额度。
- 重复幂等键只返回一个任务。
- 抓取失败和排队取消正确释放额度。
- DeepSeek 调用开始后失败不退额度。
- `anon`、`authenticated` 无法直接读取或修改私有任务、额度或队列。
- 非所属用户无法通过 RPC 读取、取消或完成任务。
- 非法状态迁移、负 token、无结果成功状态被约束拒绝。

### 16.3 集成测试

- 使用本地 Supabase 和 Queue，网页服务器与 DeepSeek API使用可控 mock。
- 覆盖成功、超时、429、5xx、无效 JSON、内容过短、重定向和重试耗尽。
- 验证 Queue visibility timeout、重复投递和 worker 幂等。
- 验证结果 24 小时清理与元数据 90 天清理。
- 验证阶段一统计 RPC 与现有统计语义一致。

### 16.4 端到端测试

- 登录用户提交 URL、观察进度、成功回填、编辑后保存。
- 刷新页面后恢复进行中的任务。
- 切换日期时结果只回填目标日期草稿。
- 当日第 6 次请求展示额度耗尽。
- 抓取失败不清空用户已有草稿。
- 任务过期、会话失效、功能开关关闭和取消任务。

### 16.5 安全测试

- IPv4/IPv6 私网、十进制/十六进制 IP、DNS rebinding、重定向到内网、云元数据地址。
- 页面正文中的 Prompt Injection 和输出格式覆盖指令。
- 越权任务读取和取消。
- 日志中不出现密钥、网页正文、邮箱、完整 URL 或 `reasoning_content`。

## 17. 发布与回滚

发布顺序：

1. 完成阶段一加固并验证现有测试全部通过。
2. 部署新增 schema、函数和 Queue，但保持 `AI_GENERATION_ENABLED=false`。
3. 部署 worker、Cron、DeepSeek Secret 和监控。
4. 部署后端 API 和前端轮询逻辑。
5. 用内部测试账号开启功能，完成真实网页和真实 DeepSeek 小流量验证。
6. 按配置逐步扩大灰度范围。
7. 观察成功率、延迟、token 和失败分布后再全量开放。

回滚时先关闭 `AI_GENERATION_ENABLED`，停止新任务；允许已进入 `generating` 的任务完成或安全失败。现有手动打卡、认证和图片功能不依赖 AI 表、Queue 或 DeepSeek，因此保持可用。

## 18. 验收标准

- 现有认证、手动打卡、统计和图片功能无行为回归。
- 连续打卡统计不再读取用户全部日期到应用层。
- 并发情况下每日额度无法超过 5 次。
- 重复请求不会创建重复任务或重复扣额。
- 任务在 API 请求中断后仍可由 Queue 恢复处理。
- 用户只能读取和取消自己的任务。
- 普通公开文章可以生成结构合法的草稿并由用户手动保存。
- 内网地址、重定向绕过和 Prompt Injection 测试被阻止。
- 网页正文和 `reasoning_content` 不进入数据库或日志。
- DeepSeek token 用量、阶段延迟、成功率和失败码可观测。
- 功能可以通过配置立即停止新任务，而不影响手动打卡。

## 19. 官方能力依据

- [Supabase Queues](https://supabase.com/docs/guides/queues)
- [使用 Edge Functions 消费 Supabase Queue](https://supabase.com/docs/guides/queues/consuming-messages-with-edge-functions)
- [DeepSeek V4 更新说明](https://api-docs.deepseek.com/updates)
- [DeepSeek V4 Pro Chat Completion API](https://api-docs.deepseek.com/api/create-chat-completion)
- [DeepSeek 思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)
