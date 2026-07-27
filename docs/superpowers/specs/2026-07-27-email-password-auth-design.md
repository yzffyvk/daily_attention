# 邮箱密码认证设计

## 目标

将第一期账号体系从“中国大陆手机号 + 密码”改为“邮箱 + 密码”。注册、登录和找回密码
均不发送邮件，继续使用一次性恢复码完成密码找回。用户首次注册后仍获得
`Attention_001` 形式的默认名称，并可在登录后修改名称和头像。

## 范围

### 包含

- 注册、登录和找回密码统一使用邮箱。
- Supabase Auth 使用原生邮箱密码身份，但仅允许应用服务端创建账号。
- 服务端创建用户时直接设置 `email_confirm: true`，不发送验证邮件。
- `profiles.phone` 迁移为唯一的 `profiles.email`。
- 页面、API、领域模型、数据库函数、测试和运维文档移除手机号认证语义。
- 保留默认名称、头像、恢复码、限流、会话、RLS、打卡和图片功能。

### 不包含

- 邮箱验证邮件、Magic Link 或邮件 OTP。
- SMTP 服务。
- 手机号、短信验证码或 Phone Provider。
- 修改登录邮箱。
- 旧手机号账号到邮箱账号的数据迁移。
- 管理后台或人工账号恢复。

当前生产项目没有正式账号和业务数据，因此本次只迁移结构，不提供旧账号兼容层。

## 方案选择

采用 Supabase 原生邮箱密码认证，由应用服务端 Admin API 创建已确认邮箱用户。

未采用的方案：

- 公共 `signUp`：会绕过 profile、默认名称和恢复码事务，因此保持禁用。
- 自建密码哈希表：会重复承担密码存储、会话和令牌安全职责，不适合当前约 100 名用户的
  产品规模。
- 手机号映射为内部邮箱：虽然可以绕过短信服务商，但用户已决定直接使用真实邮箱登录，
  无需保留手机号界面和数据模型。

## 身份模型

### 邮箱规范化

页面接收常规 ASCII 邮箱地址。服务端在校验前执行 NFKC 规范化、去除首尾空白并转为
小写。规范化后的邮箱最长 254 个字符，必须通过邮箱格式校验。

同一邮箱的大小写形式只对应一个账号，例如 `User@Example.com` 与
`user@example.com` 均写入和登录为 `user@example.com`。

### Supabase Auth

注册接口使用服务端 Supabase secret key 调用：

```ts
admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});
```

Admin `createUser` 不发送注册确认邮件，`email_confirm: true` 使账号可立即使用密码登录。
登录接口调用 `signInWithPassword({ email, password })`。浏览器只调用应用自己的认证 API，
不能接触 secret key。

Supabase 项目保持 Email Provider 开启、Phone Provider 关闭、公共用户注册关闭。应用不调用
`signUp`、`signInWithOtp`、`resetPasswordForEmail` 或任何邮件发送接口。

### `public.profiles`

`profiles` 使用以下身份字段：

```text
id            uuid primary key -> auth.users.id
email         varchar(254) not null unique
display_name  varchar(20) not null
avatar_key    smallint not null
created_at    timestamptz not null
updated_at    timestamptz not null
```

`email` 保存规范化小写值，不参与公开查询。RLS 继续只允许登录用户读取自己的 profile。
`display_name` 不参与登录，也不要求唯一。

数据库迁移将空生产库中的 `phone` 列改名为 `email`，删除手机号格式约束并新增邮箱长度、
小写和基本结构约束。`complete_registration`、`resolve_phone` 改为
`complete_registration`、`resolve_email` 的邮箱参数语义；恢复凭据私有表结构保持不变。

### 默认名称与恢复凭据

默认名称序列继续生成：

```text
Attention_001
Attention_002
...
Attention_999
```

恢复码仍由服务端生成 26 位随机值，只向用户展示一次。数据库只保存 SHA-256 摘要。
密码恢复使用“邮箱 + 恢复码 + 新密码”，成功后轮换恢复码并自动建立会话，不发送邮件。

## 用户流程

### 注册

1. 用户输入邮箱、选择头像并输入两次密码。
2. 服务端规范化邮箱、校验密码并执行注册限流。
3. Supabase Admin API 创建并确认邮箱用户。
4. 数据库事务生成默认名称并写入 profile 和恢复码摘要。
5. 服务端使用邮箱和密码创建会话。
6. 页面展示一次性恢复码，用户确认保存后进入打卡主页。

邮箱重复时返回“该邮箱已注册”。若 profile 创建或首次登录失败，服务端删除刚创建的 Auth
用户，避免孤立账号。

### 登录

用户输入邮箱和密码。账号不存在与密码错误统一返回“邮箱或密码不正确”，避免暴露邮箱是否
已经注册。

### 找回密码

用户输入邮箱、恢复码和新密码。账号不存在、恢复码错误和恢复码已使用保持统一失败语义。
密码更新成功后生成新的恢复码并建立会话。

### 编辑资料

资料弹窗显示只读的完整登录邮箱，并允许修改显示名称和头像。邮箱第一期不可修改。

## API 与代码接口

- `registerInputSchema`：`{ email, password, avatarKey }`
- `loginInputSchema`：`{ email, password }`
- `recoverInputSchema`：`{ email, recoveryCode, newPassword }`
- `profilePatchSchema`：`{ displayName?, avatarKey? }`
- `AccountProfile`：`{ id, email, displayName, avatarKey }`

认证端口使用邮箱语义：

- `createAuthUser({ email, password })`
- `signIn(email, password)`
- `resolveEmail(email)`
- `completeRegistration({ userId, email, avatarKey, recoveryDigest })`
- `updateProfile({ userId, displayName, avatarKey })`

登录和恢复限流桶使用规范化邮箱。现有 HMAC pepper 继续把原始桶转换为不可逆摘要，日志和
错误响应不输出邮箱、密码、恢复码、摘要或 Supabase 密钥。

## 页面调整

- 登录页：手机号输入改为邮箱输入，使用 `type="email"` 和
  `autoComplete="username"`。
- 注册页：手机号输入改为邮箱输入，保留头像、密码、确认密码和“返回登录”。
- 找回页：手机号输入改为邮箱输入。
- 资料设置：只读手机号改为只读邮箱。
- 所有用户可见的错误、提示和辅助文案统一使用“邮箱”。
- 页面布局和视觉风格不在本次调整范围内。

## 数据库迁移与部署

1. 新增迁移，将 `profiles.phone` 改为 `profiles.email` 并更新约束、索引和 RPC。
2. 删除 `resolve_phone`，创建仅 service role 可执行的 `resolve_email`。
3. 重新生成 Supabase TypeScript 类型。
4. 将生产项目保持为 Phone Provider 关闭、Email Provider 开启。
5. 在生产项目关闭公共注册；服务端 Admin API 注册不受该开关影响。
6. 应用迁移后使用预期的首个正式邮箱完成注册、登录、资料修改、打卡和恢复码验收。

生产账号由用户本人在页面输入邮箱、密码和恢复码，验收过程不要求用户在对话中发送这些
秘密。

## 安全与错误处理

- Secret key 只存在于服务端运行时。
- Admin 创建用户时直接确认邮箱，但产品明确不声称邮箱已验证归属。
- 公共 Supabase 注册保持关闭，防止绕过 profile 和恢复码事务。
- 所有 public 表保持 RLS，邮箱只能由本人读取。
- SECURITY DEFINER RPC 固定空 `search_path`，并撤销 `PUBLIC`、`anon` 和
  `authenticated` 的敏感函数执行权限。
- 登录和恢复使用统一错误文案。
- 注册、登录、恢复和恢复码轮换继续受限流保护。
- 资料更新不能修改 `id` 或 `email`。

## 测试计划

### 单元测试

- 邮箱规范化、大小写折叠、长度和错误格式。
- 注册服务使用规范化邮箱创建 Auth 用户和 profile。
- 登录、恢复和恢复码轮换均使用邮箱。
- Supabase 适配器创建 `email_confirm: true` 用户并以邮箱密码登录。
- 用户可修改名称和头像，但不能修改邮箱。

### 数据库测试

- `profiles.email` 非空、唯一、最长 254 个字符并保存为小写。
- `complete_registration` 拒绝非法或重复邮箱。
- 只有 service role 可调用 `resolve_email` 和恢复凭据 RPC。
- 用户只能读取自己的邮箱和 profile。
- 昵称可更新，邮箱不能由普通用户更新。

### 集成与端到端测试

- 邮箱注册后自动登录并获得 `Attention_001` 形式名称。
- 大小写不同的相同邮箱不能重复注册。
- 邮箱和密码可以重新登录。
- 直接调用 Supabase 公共 `signUp` 被拒绝。
- 注册页可返回登录页。
- 资料修改、打卡和刷新读取保持正常。
- 邮箱和恢复码可以重置密码。
- 页面和 API 响应不泄露内部恢复摘要或密钥。

## 完成标准

- 页面和运行时代码不再要求手机号或 Phone Provider。
- 注册、登录和找回密码不发送短信或邮件。
- `profiles` 使用唯一邮箱和可编辑显示名称。
- 新用户获得数据库生成的默认名称。
- 本地和生产数据库迁移一致。
- 单元、数据库、集成、渲染、端到端测试、Lint、类型检查和构建全部通过。
