# 深浅主题验收记录

2026-09-17，当前工作区实现，尚未部署。

## 产品行为

- 默认使用原有深色版；登录、注册、找回密码、身份设置、学习空间均可切换。
- 浅色使用暖白底 `#FBF8F1`，主蓝 `#16538D`、点缀红 `#E7472A`、黄色 `#F4B72D`；正文和错误提示采用满足对比度的深色。
- 主页面、日历、知识库、概念图谱、原始记录、弹窗、输入与选中状态均已适配。
- 浏览器保存主题，刷新与同源标签页同步；禁止本地存储时仍可在当前页面切换。切换不清空草稿。
- 5 个头像保留原有 ID 与角色，随主题切换图片。深色原图未覆盖。
- 本地示例：http://127.0.0.1:4300/?demo=1&theme=light 。仅使用虚构资料，编辑保存在当前页面内存中。

## 验证

- 主题/头像/账户组件测试：25 项通过。
- TypeScript、相关文件 ESLint、生产构建通过。
- 页面结构检查：9 项通过。
- 1440、768、390、320 像素浏览器检查通过：主题切换、刷新持久化、无横向溢出、主要文本对比度、知识图谱和原始记录、输入状态。
- 深浅两套头像验证通过：5 个头像及 ID、选择保存/取消、键盘焦点、短视口、减少动画偏好。
- 实际双标签页：主题与头像双向同步通过。
- 实际 /login：HTTP 200，保存的浅色偏好正确初始化，无浏览器运行错误。开发服务曾缓存尚未创建样式文件时的加载失败，模块重新加载后已恢复。
- 本地示例：头像保存、切换主题保留草稿、320 像素标题单行显示、知识库示例检查通过；未向业务服务器发送请求。
- 三份主题 CSS 移除新增颜色变量包装后，与修改前快照逐字一致，深色原始值完整保留。
- 全量单元测试：784/785 通过。既有 `mode-restore-race.test.tsx` 中 1 项 AI 草稿恢复时序测试在整套执行时失败；单独重跑该文件 3/3 通过。未因此修改草稿业务逻辑。
- 截图与对比度记录位于 `/tmp/aura-theme-qa`；头像截图位于 `/tmp/aura-light-avatars` 与 `/tmp/aura-dark-after`。

## 头像资产与生成记录

使用内置 image_gen 工具，以原有同角色 PNG 作为编辑参考，每个角色独立生成后复制到项目；不是 CLI 模式。以下均为实际应用引用的最终文件。每条提示词均为最终使用的完整提示词。

### dreamer

保存路径：`/Users/yanzifeng/Documents/今天你Ai了吗？/public/avatars/aura-dreamer-light.png`

> Create ONE square production avatar asset, editing the attached original character into the light-theme companion for Aura, a thoughtful learning journal. Preserve this character's recognizable silhouette, pose, proportions, simple cute face and 3D sculptural identity. Art direction: premium satin ivory ceramic/vinyl rather than luminous glass; solid confident palette cobalt blue #16538D, vermilion red #E7472A, marigold yellow #F4B72D for accessories. Soft neutral daylight, subtle realistic contact shadow, crisp legibility at 40px and 200px. Background must be completely uniform warm white #FBF8F1, no scene, no black, no vignette, no gradient background, no gold glow, no text or labels, no frame. Fully visible centered character about 76% of canvas width and height, safe margin on every side, one character only. Specific character: a rounded cloud-shaped daydreamer with two oval navy eyes, floating in a thin cobalt-blue orbit with one marigold-yellow star and a tiny vermilion bead

### scholar

保存路径：`/Users/yanzifeng/Documents/今天你Ai了吗？/public/avatars/aura-scholar-light.png`

> Create ONE square production avatar asset, editing the attached original character into the light-theme companion for Aura, a thoughtful learning journal. Preserve this character's recognizable silhouette, pose, proportions, simple cute face and 3D sculptural identity. Art direction: premium satin ivory ceramic/vinyl rather than luminous glass; solid confident palette cobalt blue #16538D, vermilion red #E7472A, marigold yellow #F4B72D for accessories. Soft neutral daylight, subtle realistic contact shadow, crisp legibility at 40px and 200px. Background must be completely uniform warm white #FBF8F1, no scene, no black, no vignette, no gradient background, no gold glow, no text or labels, no frame. Fully visible centered character about 76% of canvas width and height, safe margin on every side, one character only. Specific character: the chubby bean-shaped scholar with two oval navy eyes holding an open book with cobalt-blue cover, cream pages, a vermilion bookmark and a small marigold binding

### technophile

保存路径：`/Users/yanzifeng/Documents/今天你Ai了吗？/public/avatars/aura-technophile-light.png`

> Create ONE square production avatar asset, editing the attached original character into the light-theme companion for Aura, a thoughtful learning journal. Preserve this character's recognizable silhouette, pose, proportions, simple cute face and 3D sculptural identity. Art direction: premium satin ivory ceramic/vinyl rather than luminous glass; solid confident palette cobalt blue #16538D, vermilion red #E7472A, marigold yellow #F4B72D for accessories. Soft neutral daylight, subtle realistic contact shadow, crisp legibility at 40px and 200px. Background must be completely uniform warm white #FBF8F1, no scene, no black, no vignette, no gradient background, no gold glow, no text or labels, no frame. Fully visible centered character about 76% of canvas width and height, safe margin on every side, one character only. Specific character: the little rounded robot with a cobalt-blue face visor, two warm yellow eyes, cream body, cobalt-blue joints, vermilion antenna tip and marigold chest chip

### lounger

保存路径：`/Users/yanzifeng/Documents/今天你Ai了吗？/public/avatars/aura-lounger-light.png`

> Create ONE square production avatar asset, editing the attached original character into the light-theme companion for Aura, a thoughtful learning journal. Preserve this character's recognizable silhouette, pose, proportions, simple cute face and 3D sculptural identity. Art direction: premium satin ivory ceramic/vinyl rather than luminous glass; solid confident palette cobalt blue #16538D, vermilion red #E7472A, marigold yellow #F4B72D for accessories. Soft neutral daylight, subtle realistic contact shadow, crisp legibility at 40px and 200px. Background must be completely uniform warm white #FBF8F1, no scene, no black, no vignette, no gradient background, no gold glow, no text or labels, no frame. Fully visible centered character about 76% of canvas width and height, safe margin on every side, one character only. Specific character: the relaxed sleepy bean-shaped character reclining in a cobalt-blue lounge chair with a small marigold cushion and a vermilion side detail; same languid half-closed eyes

### doer

保存路径：`/Users/yanzifeng/Documents/今天你Ai了吗？/public/avatars/aura-doer-light.png`

> Create ONE square production avatar asset, editing the attached original character into the light-theme companion for Aura, a thoughtful learning journal. Preserve this character's recognizable silhouette, pose, proportions, simple cute face and 3D sculptural identity. Art direction: premium satin ivory ceramic/vinyl rather than luminous glass; solid confident palette cobalt blue #16538D, vermilion red #E7472A, marigold yellow #F4B72D for accessories. Soft neutral daylight, subtle realistic contact shadow, crisp legibility at 40px and 200px. Background must be completely uniform warm white #FBF8F1, no scene, no black, no vignette, no gradient background, no gold glow, no text or labels, no frame. Fully visible centered character about 76% of canvas width and height, safe margin on every side, one character only. Specific character: the eager round-headed character connecting two large jigsaw pieces, one cobalt-blue and one vermilion with a small marigold joining edge, keeping the original pose
