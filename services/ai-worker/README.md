# 常驻 AI Worker

应用创建任务后立即返回 `202`。本服务独立轮询单日提炼队列与知识脉络任务，复用现有模型配置和每日 5 次共享额度。

## Railway 生产部署

网站继续运行在 Cloudflare，数据库继续使用 Supabase。在同一个 Railway 项目中按顺序创建 `safe-fetch-gateway`、`ai-worker` 两个服务，源码均连接本仓库中包含本次部署配置的分支。两者都使用 Dockerfile 的默认启动入口，无需填写网站的构建或启动命令。

### 1. 安全抓取服务

| 设置 | 值 |
| --- | --- |
| Root Directory | `/services/safe-fetch-gateway` |
| 构建方式 | Dockerfile，自动识别该目录中的 `Dockerfile` |
| Healthcheck Path | `/healthz` |
| Healthcheck Timeout | `60` 秒 |
| 实例数 | `1` |
| Serverless / 休眠 | 关闭 |
| Draining time | `30` 秒 |

在 Variables 中配置 `SAFE_FETCH_GATEWAY_TOKEN`（32–512 字符的随机密钥）。容器默认监听 `0.0.0.0`，端口读取 Railway 注入的 `PORT`。不要把本地的 `HOST=127.0.0.1` 带到生产环境。

部署成功后，在 Settings → Networking → Public Networking 点击 Generate Domain，取得 `https://…up.railway.app` 地址。访问该地址的 `/healthz` 应返回 `{"ok":true}`；未携带令牌请求 `/v1/fetch` 应被拒绝。生成的域名自带 HTTPS，无需另外购买域名。

### 2. AI Worker

| 设置 | 值 |
| --- | --- |
| Root Directory | `/`，必须包含共享源码 |
| Dockerfile 路径 | `services/ai-worker/Dockerfile` |
| Healthcheck Path | `/readyz` |
| Healthcheck Timeout | `600` 秒，启动后首批任务可能包含长文生成 |
| 实例数 | `1` |
| Serverless / 休眠 | 关闭，后台需要持续读取任务 |
| Draining time | `600` 秒，覆盖程序内部的 580 秒退出等待 |

在 Variables 中设置：

| 变量 | 内容 |
| --- | --- |
| `RAILWAY_DOCKERFILE_PATH` | `services/ai-worker/Dockerfile` |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | `600` |
| `SUPABASE_URL` | 生产项目地址 |
| `SUPABASE_SECRET_KEY` | 对应项目的服务端密钥 |
| `DEEPSEEK_API_KEY` | 可用的模型密钥 |
| `AI_USER_ID_PEPPER` | 与网站一致、至少 32 字符的密钥 |
| `SAFE_FETCH_GATEWAY_URL` | 上一步的 HTTPS 根地址，不带路径或查询参数 |
| `SAFE_FETCH_GATEWAY_TOKEN` | 与抓取服务完全一致的密钥 |
| `AI_PROVIDER_MODE` | `deepseek` |

容器已经设置 `NODE_ENV=production`、`AI_WORKER_HEALTH_HOST=0.0.0.0`，并优先读取平台 `PORT`。不要设置本地验收用的 `AI_WORKER_USER_ID`、`AI_WORKER_CREATED_AFTER`，也不需要 `AI_WORKER_TRIGGER_TOKEN`。AI Worker 不需要公网域名；健康接口不返回密钥或用户数据。

Docker 镜像只安装本服务锁定的运行依赖，包含正文解析用的 `linkedom`；构建上下文使用白名单，排除本地环境文件。密钥只在平台 Variables 中配置，不能写入镜像或 Git。

Node 直接作为容器主进程接收 SIGTERM。收到信号后立即取消就绪状态、停止后续领取，等待已领取任务完成；重复停止信号不会打断等待。平台必须实际允许 600 秒退出时间；容器的 `STOPSIGNAL` 本身不会延长平台的强制终止期限。崩溃或强制终止仍有下文所述的任务恢复边界。

### 3. 上线验收

确认抓取服务健康、Worker 的 `/readyz` 通过、日志没有持续的队列读取错误，再在 Cloudflare 为 AI 功能设置所需密钥与 `AI_GENERATION_ENABLED=true`。心得润色由网站服务直接调用模型，因此 Cloudflare 也需要 `DEEPSEEK_API_KEY` 和 `AI_USER_ID_PEPPER`。

使用真实账号分别验证文章提炼、知识脉络和润色；`/readyz` 成功只代表两类队列能够读取，不代表模型密钥或余额有效。不要同时启用旧 Supabase Edge 消费者。定时清理任务需另行配置。

Railway 当前新服务使用控制台设置或 Infrastructure as Code；本项目不新增已弃用的 `railway.json` / `railway.toml`。

参考：[Dockerfile 部署](https://docs.railway.com/builds/dockerfiles)、[健康检查](https://docs.railway.com/deployments/healthchecks)、[退出等待](https://docs.railway.com/deployments/deployment-teardown)、[公网域名](https://docs.railway.com/networking/public-networking)、[配置方式](https://docs.railway.com/infrastructure-as-code)。

## 本地运行

### AI 提炼实时预览

单日提炼使用模型 SSE 流式响应，Worker 每约 800 毫秒将已生成的公开正文预览写入当前任务；页面在生成期间每秒读取一次，展示排队、读取资料、生成正文、校验整理及等待时长。模型首段正文返回前显示等待提示，格式修复时清空首稿预览并显示修复阶段。原始 JSON、引用编号和模型内部推理不展示。

预览单独暂存，不写入可编辑草稿；只有完整结果通过原有格式和引用校验后才填入小结。刷新可恢复同一任务的最新预览；重试、取消、失败或完成会清理暂存内容。网页隐藏时降低轮询频率，回到页面或网络恢复后立即更新。进度写入失败不会中断正式生成。

本地验收前执行 `npx supabase db push --local`，应用 `20261013175012_ai_generation_stream_progress.sql`，然后按下文启动网页、抓取网关与 Worker。该迁移仅增加临时预览字段和仅服务端可调用的进度 RPC。生产发布需先应用迁移，再发布网页/API 与 Worker；旧服务兼容新增字段。

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

均应返回 `{"ok":true}`。`/healthz` 只检查 Worker 进程；`/readyz` 检查两类任务轮询是否成功，不保证上游模型可用。

### 使用已有账号连接托管数据库验收

本地页面连接托管数据库时，使用账号限定入口，避免领取其他用户的任务。先应用 `20260927123108_scoped_local_ai_worker.sql`。在已被 Git 忽略的 `.dev.vars.acceptance` 中放入与页面、抓取网关一致的数据库与密钥配置，再设置：

```dotenv
AI_WORKER_USER_ID=验收账号的用户UUID
AI_WORKER_CREATED_AFTER=本轮验收开始时间的ISO格式
```

运行 `npm run dev:ai-worker:acceptance` 并保持进程运行。缺失账号或时间会直接报错，不会退回全队列模式。它只领取指定账号在指定时间之后的单日提炼任务，不启动知识脉络消费者；复用队列租约、最多三次重试和既有额度。此模式的 `/readyz` 仅检查指定账号的单日队列。重启后台可以继续排队任务，只有页面在运行并不能生成结果。

GitHub `blob` 页面中的 Markdown / TXT 文件直接通过同一安全网关读取对应的 `raw.githubusercontent.com` 原文，保留任务中的用户原始链接。纯文本保留标题、列表、缩进及代码，不按 HTML 删除示例标签。仍执行原有 URL、DNS、公网地址、重定向、响应大小和正文长度校验，每次任务重新抓取，不复用旧总结。

真实验收使用 `npm run dev` 输出的应用地址，并确认 `.dev.vars` 连接的是预期数据库。`npm run demo` 的 `4300` 端口只返回固定示例，不会读取输入链接或调用模型。若 `3000` 已被其他验收实例占用，可以单独启动本地真实入口：

```sh
APP_ORIGIN=http://127.0.0.1:3001 npm run dev -- --hostname 127.0.0.1 --port 3001
```

随后在 `http://127.0.0.1:3001` 使用该数据库的账号登录，选择「AI 提炼」，填写实际资料链接和提炼要求。抓取网关和 Worker 仍使用上面的启动命令。

如果网页可以打开，但点击 AI 提炼立即失败，应同时检查上述两个地址。Worker 队列正常不代表抓取网关仍在运行；`8788` 无响应时，重新启动 `npm run dev:gateway`。连接网关失败会按既有退避规则最多尝试 3 次，最终显示「网页读取服务暂时不可用，请稍后重试」。在调用模型之前失败的任务不消耗生成额度。已失败的任务需重新点击生成。

## 行为与边界

- 每秒轮询；队列读取失败按 1、2、4、8、16、30 秒退避。
- 单日提炼每批最多领取 2 条、并发 2 条，队列可见性租期为 600 秒，覆盖长文模型请求、抓取与结果落库。
- 网关总抓取上限 15 秒；连接失败会尝试本次 DNS 查询的其他已验证公网地址。每个重定向重新验证，HTTP 拒绝不会触发地址回退。
- 单日提炼、知识脉络与 AI 润色均使用 `deepseek-flash`（DeepSeek V4.1 Flash）。提炼和脉络的思考模式为 `high`，提炼格式修复及润色关闭思考。常驻 Worker 的单日提炼模型调用（首稿及一次格式修复合计）上限为 480 秒；知识脉络与旧 Edge 消费者仍为 120 秒。长文可能等待数分钟，前端持续轮询同一任务。
- 问题结构的首轮输出预算为 32768 token，包含思考与 JSON 正文；一次非思考修复仍为 16384 token。此前 16384 总预算可能被思考耗尽。小结篇幅只由系统提示词引导；生成、读取、编辑、保存和后续 AI 输入不再拒绝超过 12000 字符的小结，结构与来源依据继续校验。
- 问题结构的模型输入带连续原文片段编号。模型选择编号，程序还原为真实原文后再做完整校验，避免 Markdown 加粗/代码符号或标点变化导致引用抄写失败。编号不作为正文保存。关系视图引用有遗漏或错位时，只将已有关系挂到已包含两端节点的视图；跨问题的已有关系也可按端点归属进入问题间导航，不添加概念或事实关系。模型返回的“约束”类别规范为“条件”，方向、命题、限定与证据不变，图示类型 tradeoff 规范为 comparison；其他未知类别仍拒绝。跨题导航挂错的已有关系按原端点归属重新安排，不生成新的事实关系。
- 系统提示词建议说明文字控制在 4000 字符以内、含引用和格式的小结尽量控制在 12000 字符以内；超过建议篇幅仍完整接收，不触发长度修正或裁剪。上线前应用 `20261013145413_remove_summary_character_limit.sql`，移除保存表、任务表和完成 RPC 的小结长度限制。
- 退出时停止新读取，最多等待 580 秒让当前任务完成。当前维护任务只清理已结束任务；若强制退出打断 `fetching` / `generating`，该任务不会自动恢复，需要人工排查后重新生成。不能承诺模型请求跨进程崩溃的严格 exactly-once。
- 成功结果仍是待用户确认的草稿，不自动保存打卡。

## 知识脉络

- 先应用 `20260910122608_knowledge_narratives.sql`，再启动本版本 Worker。新表保存日期、输入快照、任务状态和完整结果。
- 知识脉络每个独立轮询循环领取 1 条，单日提炼仍保留原有并发。两者共用每天 5 次额度；重试同一任务不重复扣次数。
- 每条任务领取时获得 180 秒租约和独立标识，模型请求上限 120 秒；失败最多尝试 3 次。进程崩溃后租约到期可恢复，过期任务的迟到结果不能覆盖新结果。
- 知识脉络以选定的 2–14 天已保存文字为基础；不会读取未保存草稿、图片正文或重新抓取来源链接。新生成结果使用 `schemaVersion: 2`：同主题返回 `concept_map`，概念跨日期归纳，关系和讲述提纲引用同一组概念；最多补充 3 个明确标记的 AI 概念，不伪造对应的学习日期。概念、主干、关系、提纲引用和日期覆盖经过结构校验，语义准确性仍需结合原文判断。
- 多领域混合或材料不足返回 `source_records`；模型仅提供标题、原因枚举和来源日期，页面直接读取原始快照，正文不会被改写。
- 脉络结果自动、长期保存，用户可以编辑总结、复制、删除、回看来源快照或重新生成。重新生成创建新记录；原笔记更新时，旧结果显示来源变更提示。
- 列表管理还需要 `20260910151515_narrative_library_management.sql`。编辑使用版本检查；复制保留来源快照并创建独立结果，以 `cp` 结尾，重名自动编号。编辑与复制均不调用模型或消耗额度。
- 删除未开始的排队任务会退回预约额度；已开始的任务保留实际消耗，删除后迟到的模型结果不会重新出现。删除前由页面明确确认不可恢复。
- `AI_PROVIDER_MODE=fake` 继续只允许既有测试环境规则，并且不会调用真实模型；结果明确标记为测试内容。
- 云端上线需要部署这次数据库迁移、前端/API 和本版本常驻 Worker，旧版 Worker 不会消费新的脉络任务。已有单日结果的 24 小时清理规则不应用于知识脉络。

### 2026-09-17 概念图谱版本升级

新版图谱沿用现有 JSON 结果字段，无需转换旧数据。上线前先应用仓库中的待执行迁移，包括 `20260917114824_index_knowledge_narrative_quota_reference.sql` 补齐额度关联索引；再发布支持新旧两种结果的前端/API，最后更新并重启常驻 Worker。应用与 Worker 的顺序不可反转，旧 API 无法解析新版结果。旧记录仍可查看、编辑和复制；用户选择重新生成时会创建独立的新版结果。

模型请求保留 `deepseek-v4-pro`、`high` 与 120 秒上限，失败按原有规则重试。真实模型验证采用虚构学习材料，不读真实用户笔记；同主题和混合主题分流通过，首次同主题试跑触发超时，复测约 64 秒成功。详见 `docs/knowledge-map-qa.md`。

## 部署提醒

### 2026-09-27 按问题组织提炼

先发布本版本前端/API（兼容新旧文档及 12000 字符小结），再更新并重启支持 `knowledge-questions-v1` 的常驻 Worker，最后应用 `20260927035322_question_led_distillation.sql`。这一步将新任务的提示词默认版本切换为问题结构；不要让旧 Worker 消费新版本任务。已有任务保留创建时的版本，已有笔记不转换、不重新生成。

迁移扩展记录、任务和完成 RPC 的小结上限，不新增表或公开 RPC 权限。模型按原文生成问题、局部视图和跨问题引用；完整结构、引用与原文证据均校验通过后才能保存，失败最多进行一次格式修复。资料截断提醒写入文档，不截断序列化后的结构。

本次已在连接的 `daily_attention` 项目应用迁移并完成回滚式数据库检查；线上应用与常驻 Worker 未在本次工作中发布。后续本地排障已增加并启动指定验收账号的消费者，详见上面的账号限定入口。正式启用前必须核对实际部署的 API 和 Worker 版本，数据库迁移完成不代表模型服务已上线。

界面隔离检查：启动 `npm run demo`，然后运行 `node --experimental-strip-types tests/visual/verify-question-reader.mjs fixture OUTPUT_DIR`。`fixture` 使用明确的虚构数据，不调用模型。将第一个参数换为已保存的真实成功任务 JSON，可以检查真实生成的每个问题和局部视图；测试页本身不写服务器或创建账号。具体结果见 `docs/ai-question-reader-qa-2026-09-27.md`。

### 2026-09-23 提炼要求升级

先升级并重启本版本 Worker（兼容旧数据库和 `ai-summary-v1` 任务），确认旧消费者已停止；再应用 `20260923113957_ai_record_user_prompt.sql`，最后发布前端/API。新迁移创建的任务使用 `knowledge-skeleton-user-prompt-v1`，不要让旧 Worker 消费这些任务，否则用户要求会被忽略。迁移只为旧记录增加空要求，不重写已有任务的提示词版本。

当前可编辑的要求保存在 AI 记录的 `user_prompt`，已生成内容的要求与版本保存在 `ai_generation_context`；后台任务另存不可变快照。清空输入代表下次使用默认方式，原总结与其快照保留到新结果生成。每次任务仍只发起一次模型生成（失败重试沿用原有规则），没有新增规划或改写调用。手动记录不保存这些 AI 字段。

本地浏览器验收：启动 `npm run demo` 后运行 `node tests/visual/verify-ai-user-prompt.mjs`。此验收使用虚构数据和固定生成结果，只验证交互、保存恢复及响应式布局，不代表真实模型的个性化效果。

本次修复验收的是 localhost。线上需要单独部署常驻 Node 服务并配置进程守护；执行 `NODE_ENV=production node --experimental-strip-types services/ai-worker/index.ts` 时由部署环境注入密钥。线上网关必须 HTTPS，HTTP 回环例外仅在开发模式开启。

当前 Worker 复用 `supabase/functions/ai-generation-worker/index.ts` 导出的处理逻辑；导入不会启动 Edge 服务，也不依赖 Deno 全局。旧 HTTP 入口只为兼容保留，应用不再触发它。部署时停用旧消费者的 Cron，保留 `ai-generation-maintenance` 的过期数据清理调度；它不负责恢复执行中被中断的单日提炼任务。独立容器打包与线上验收不包含在本次本地修复结果内。
