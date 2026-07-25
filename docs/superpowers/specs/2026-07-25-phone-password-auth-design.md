# 手机号密码认证设计

## 目标

将当前“名称 + 密码”账号改为“中国大陆手机号 + 密码”账号。注册时不再要求填写名称，
系统为新用户自动生成 `Attention_001` 形式的昵称，用户登录后可以修改昵称。

本次同时清空旧测试账号及其数据，不提供旧名称账号迁移或手机号绑定流程。

## 范围

### 包含

- 注册、登录和恢复密码统一使用手机号。
- 注册页面移除名称输入，保留五个头像选择。
- 注册页面增加返回登录页面的按钮。
- `profiles` 同时保存 `phone` 和 `display_name`。
- 使用数据库原子序列生成默认昵称。
- 用户可修改昵称和头像。
- 清空旧账号、打卡记录和图片。
- 删除旧名称登录映射。

### 不包含

- 短信验证码。
- 国际手机号。
- 修改已注册手机号。
- 旧账号绑定手机号。
- 管理后台或人工账号恢复。

## 身份模型

### Supabase Auth

Supabase Auth 使用原生手机号密码认证。页面接收 11 位中国大陆手机号，服务端规范化为
E.164 格式，例如 `13800138000` 转换为 `+8613800138000`。

注册接口继续由服务端使用 Supabase secret key 创建用户，并设置 `phone_confirm: true`。
浏览器只能获得 Supabase publishable key，不能接触 secret key。

### `public.profiles`

`profiles` 保留并明确拆分两个字段：

```text
id            uuid primary key -> auth.users.id
phone         varchar(11) not null unique
display_name  varchar(20) not null
avatar_key    smallint not null
created_at    timestamptz not null
updated_at    timestamptz not null
```

`phone` 必须匹配中国大陆手机号格式 `^1[3-9][0-9]{9}$`。RLS 继续只允许登录用户读取
自己的 profile。手机号不会出现在公开查询中。

`display_name` 不参与登录，也不要求唯一。用户修改昵称时不再需要重新输入密码。

### 默认昵称

在 `private` schema 创建数据库序列。注册事务通过 `nextval` 原子分配序号，并格式化为：

```text
Attention_001
Attention_002
...
Attention_999
```

序号全局递增、不回收。超过 `999` 时注册明确失败；当前约 100 名用户的产品范围不会触及
该上限。

### 恢复凭据

删除 `private.login_aliases`。恢复码摘要迁移为职责单一的
`private.account_recovery_credentials`：

```text
user_id               uuid primary key -> auth.users.id
recovery_code_digest  bytea not null
recovery_rotated_at   timestamptz not null
created_at            timestamptz not null
updated_at            timestamptz not null
```

密码恢复接口先根据 `profiles.phone` 解析用户 ID，再读取和条件替换恢复码摘要。私有表不向
`anon` 或 `authenticated` 暴露，只允许经过校验的 service-role RPC 使用。

## 用户流程

### 注册

1. 用户输入 11 位手机号。
2. 用户选择一个头像。
3. 用户输入并确认密码。
4. 服务端校验手机号格式、密码长度和限流。
5. Supabase Auth 创建并确认 `+86` 手机号用户。
6. 数据库事务生成默认昵称，并写入 profile 和恢复码摘要。
7. 服务端使用手机号和密码创建会话。
8. 页面展示一次性恢复码，关闭后进入打卡主页。

手机号重复时注册接口返回明确的“该手机号已注册”。若 profile 创建失败，服务端删除刚创建
的 Auth 用户，避免孤立账号。

### 登录

登录页输入手机号和密码，服务端直接调用 Supabase `signInWithPassword({ phone,
password })`。账号不存在和密码错误统一返回“手机号或密码错误”，避免登录接口泄露账号
是否存在。

### 找回密码

找回页面将“名称”改为“手机号”，继续使用“手机号 + 恢复码 + 新密码”。账号不存在、
恢复码错误和恢复码已使用均返回现有的统一恢复失败语义。

### 编辑资料

资料弹窗显示只读的脱敏登录手机号，例如 `138****8000`，并允许修改昵称和头像。修改昵称
不再要求当前密码；手机号本期不可修改。

## 页面调整

- 登录表单：名称输入改为手机号输入，使用 `inputMode="numeric"`、
  `autoComplete="tel"` 和 `maxLength={11}`。
- 注册表单：移除名称输入，新增手机号输入，保留头像、密码和确认密码。
- 注册操作区：主按钮“注册并进入”，次级按钮“返回登录”并链接 `/login`。
- 找回表单：名称输入改为手机号输入。
- 登录、注册和找回页面文案统一使用“手机号”。
- 资料设置增加只读脱敏手机号，昵称字段继续使用“名称”。

## API 与领域模型

- `registerInputSchema`：`{ phone, password, avatarKey }`
- `loginInputSchema`：`{ phone, password }`
- `recoverInputSchema`：`{ phone, recoveryCode, newPassword }`
- `profilePatchSchema`：`{ displayName?, avatarKey? }`
- `AccountProfile`：`{ id, phone, displayName, avatarKey }`

认证端口改为手机号语义：

- `createAuthUser({ phone, password })`
- `signIn({ phone, password })`
- `resolvePhone(phone)`
- `completeRegistration({ userId, phone, avatarKey, recoveryDigest })`
- `updateProfile({ userId, displayName, avatarKey })`

限流桶使用规范化手机号，不记录明文手机号；继续通过现有 HMAC pepper 生成摘要。

## 数据库迁移与清理

旧数据明确不保留，执行顺序如下：

1. 暂停本地写入并确认目标 Supabase 项目。
2. 使用 Storage API 清空 `checkin-images` bucket。
3. 使用 Supabase Auth Admin API 删除所有旧 Auth 用户；外键级联删除 profiles、打卡和
   私有登录映射。
4. 应用新的数据库迁移：新增 `profiles.phone`、重建注册和资料 RPC、创建昵称序列与恢复
   凭据表、删除 `login_aliases`。
5. 重新生成并提交 Supabase TypeScript 类型。
6. 创建一个测试账号，验证注册、登录、昵称修改、打卡和恢复流程。

清理脚本必须在执行前输出将删除的账号、打卡和图片数量，并要求显式的项目 ID 参数。脚本
不打印手机号、恢复码摘要或任何密钥。

## 安全与错误处理

- Secret key 仅用于服务端 Auth Admin 和 RPC。
- 所有 public 表保持 RLS。
- `profiles` 只允许本人读取，手机号不会被其他用户查询。
- 所有 SECURITY DEFINER RPC 固定空 `search_path`、检查调用者参数，并撤销
  `PUBLIC`、`anon`、`authenticated` 的执行权限。
- 登录和恢复接口使用统一失败文案。
- 注册、登录、恢复和恢复码轮换继续受限流保护。
- 资料更新不能修改 `id` 或 `phone`。

## 测试计划

### 单元测试

- 手机号格式规范化与错误提示。
- 注册服务使用 E.164 手机号并生成 profile。
- 登录和恢复服务使用手机号。
- 昵称修改不要求当前密码。
- 头像更新与恢复码轮换保持原行为。

### 数据库测试

- `profiles.phone` 非空、唯一且满足格式约束。
- 默认昵称并发分配不重复且按序号递增。
- 只有 service role 可调用注册和恢复凭据 RPC。
- 用户只能读取自己的手机号和 profile。
- 昵称可更新，手机号不可由普通用户更新。

### 集成与端到端测试

- 手机号注册后自动登录并显示 `Attention_001` 形式昵称。
- 重复手机号不能注册。
- 手机号和密码可以重新登录。
- 注册页可以返回登录页。
- 用户可以修改昵称和头像。
- 刷新页面后 profile 与打卡数据仍正确。
- 使用手机号和恢复码可以重置密码。
- 390×844、1024×768 和 1440×900 下登录注册表单不溢出。

## 完成标准

- 页面不再要求用名称登录或注册。
- 新用户获得数据库生成的默认昵称。
- `profiles` 同时包含手机号和可编辑昵称。
- 注册页具有返回登录页面的明确操作。
- 旧测试账号和数据已清空。
- 本地、云端数据库迁移一致。
- 单元、数据库、集成、端到端测试、Lint、类型检查和构建全部通过。
