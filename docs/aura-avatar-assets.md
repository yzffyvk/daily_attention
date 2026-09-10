# 知序 Aura 头像素材记录

生成日期：2026-09-10。使用内置 Image Gen，共五次生成调用；未使用 CLI/API key 模式。图 2–5 以图 1 为材质、灯光和构图的风格参考，不复用其云朵造型。

## 保存路径与编号

编号仅为原有用户资料的数值映射，不新增数据库字段。

| 现有编号 | 形象 | 项目内素材 |
| --- | --- | --- |
| 1 | 白日梦家 | `public/avatars/aura-dreamer.png` |
| 2 | 学者 | `public/avatars/aura-scholar.png` |
| 3 | 技术发烧友 | `public/avatars/aura-technophile.png` |
| 4 | 摸鱼家 | `public/avatars/aura-lounger.png` |
| 5 | 行动派 | `public/avatars/aura-doer.png` |

素材原稿为 1254 × 1254 PNG，完整保留生成结果；源文件也保留在 Codex generated_images 中。五张共约 6.9 MB，页面使用原生懒加载和异步解码。上线弱网优化时可另行制作小尺寸 WebP/AVIF 派生文件；本次未压缩或裁切原图。原有 avatar-1.svg 至 avatar-5.svg 未删除，但新的展示组件不再引用它们。

## 最终生成提示词

### 1 · 白日梦家

```text
Use case: stylized-concept. Asset type: one square user avatar for 知序 Aura, a premium attention-focused learning journal. Create one original genderless non-human digital spirit, sculptural collectible character, sophisticated minimal 3D product render, satin silver-white ceramic body, a little translucent smoked glass, warm champagne-gold micro-light accents. Neutral black #080a0d seamless background, no scenery, no text, no logo, no border, no watermark. Center the complete character and its single signature prop inside a circle-safe central 76% of a square canvas; slightly elevated three-quarter view, consistent soft upper-left studio light and silver rim light, subtle floor shadow. Strong readable silhouette and large simple eyes, no realistic human face, no hair, no gendered anatomy or clothing, no eyelashes, no beard. Quiet playful personality, technological elegance, not busy cartoon clipart. Prefer a compact 512x512 square deliverable.
Subject: DAYDREAMER. A buoyant little cloud-shaped ceramic spirit, three rounded cloud lobes form its head/body, two tiny dark oval eyes gently looking up. One small glass orbit with a single tiny champagne-gold star circles diagonally above the cloud. Floating peacefully, imaginative and serene. The cloud is the character itself, not an ordinary humanoid standing on a cloud. Full silhouette visible, cloud and star occupy the central circle safely.
```

### 2 · 学者

```text
Use case: stylized-concept. Asset type: one square user avatar for 知序 Aura, a premium attention-focused learning journal. Create one original genderless non-human digital spirit, sculptural collectible character, sophisticated minimal 3D product render, satin silver-white ceramic body, a little translucent smoked glass, warm champagne-gold micro-light accents. Neutral black #080a0d seamless background, no scenery, no text, no logo, no border, no watermark. Center the complete character and its single signature prop inside a circle-safe central 76% of a square canvas; slightly elevated three-quarter view, consistent soft upper-left studio light and silver rim light, subtle floor shadow. Strong readable silhouette and large simple eyes, no realistic human face, no hair, no gendered anatomy or clothing, no eyelashes, no beard. Quiet playful personality, technological elegance, not busy cartoon clipart. Prefer a compact 512x512 square deliverable.
Input image 1 is STYLE REFERENCE ONLY, not an edit target. Make a NEW individual avatar, match its ceramic/glass materials, studio lighting, black backdrop, gentle eye styling and restrained warm microglow. Preserve the premium coherent series feel; do not copy the cloud character.
Subject: SCHOLAR. A rounded egg-shaped ceramic knowledge spirit with two simple dark oval eyes gazing thoughtfully at an open book held by its small mitten-like appendages. A few luminous translucent glass pages rise gently from the open book. One character, one book. No glasses, no clothing, no graduation hat, no cloud and no orbit. Contemplative and curious; distinct from the reference cloud but clearly from the same sculptural spirit collection.
```

### 3 · 技术发烧友

```text
Use case: stylized-concept. Asset type: one square user avatar for 知序 Aura, a premium attention-focused learning journal. Create one original genderless non-human digital spirit, sculptural collectible character, sophisticated minimal 3D product render, satin silver-white ceramic body, a little translucent smoked glass, warm champagne-gold micro-light accents. Neutral black #080a0d seamless background, no scenery, no text, no logo, no border, no watermark. Center the complete character and its single signature prop inside a circle-safe central 76% of a square canvas; slightly elevated three-quarter view, consistent soft upper-left studio light and silver rim light, subtle floor shadow. Strong readable silhouette and large simple eyes, no realistic human face, no hair, no gendered anatomy or clothing, no eyelashes, no beard. Quiet playful personality, technological elegance, not busy cartoon clipart. Prefer a compact 512x512 square deliverable.
Input image 1 is STYLE REFERENCE ONLY, not an edit target. Make a NEW individual avatar, match its ceramic/glass materials, studio lighting, black backdrop, gentle eye styling and restrained warm microglow. Preserve the premium coherent series feel; do not copy the cloud character.
Subject: TECH ENTHUSIAST. A compact rounded-square ceramic mechanical spirit, with a smoked-glass horizontal visor showing two tiny cool silver lights, and one visible square microchip core in its torso, minimal silver seams and a single short antenna. Thoughtful tinkerer, strong machine-like silhouette but friendly. No book, no cloud, no star orbit, no weapons. Keep the circuitry simple, readable at avatar size; no printed symbols or text.
```

### 4 · 摸鱼家

```text
Use case: stylized-concept. Asset type: one square user avatar for 知序 Aura, a premium attention-focused learning journal. Create one original genderless non-human digital spirit, sculptural collectible character, sophisticated minimal 3D product render, satin silver-white ceramic body, a little translucent smoked glass, warm champagne-gold micro-light accents. Neutral black #080a0d seamless background, no scenery, no text, no logo, no border, no watermark. Center the complete character and its single signature prop inside a circle-safe central 76% of a square canvas; slightly elevated three-quarter view, consistent soft upper-left studio light and silver rim light, subtle floor shadow. Strong readable silhouette and large simple eyes, no realistic human face, no hair, no gendered anatomy or clothing, no eyelashes, no beard. Quiet playful personality, technological elegance, not busy cartoon clipart. Prefer a compact 512x512 square deliverable.
Input image 1 is STYLE REFERENCE ONLY, not an edit target. Make a NEW individual avatar, match its ceramic/glass materials, studio lighting, black backdrop, gentle eye styling and restrained warm microglow. Preserve the premium coherent series feel; do not copy the cloud character.
Subject: RELAXED LOUNGER. A smooth capsule-shaped ceramic spirit reclining diagonally in a curved translucent glass cushion, two half-closed dark eyes and tiny relaxed feet, content and unhurried. A gentle lounging posture is the entire idea. No clothing, no hair, no human anatomy, no phone, no book, no orbit. One character on one curved cushion, circle-safe compact composition.
```

### 5 · 行动派

```text
Use case: stylized-concept. Asset type: one square user avatar for 知序 Aura, a premium attention-focused learning journal. Create one original genderless non-human digital spirit, sculptural collectible character, sophisticated minimal 3D product render, satin silver-white ceramic body, a little translucent smoked glass, warm champagne-gold micro-light accents. Neutral black #080a0d seamless background, no scenery, no text, no logo, no border, no watermark. Center the complete character and its single signature prop inside a circle-safe central 76% of a square canvas; slightly elevated three-quarter view, consistent soft upper-left studio light and silver rim light, subtle floor shadow. Strong readable silhouette and large simple eyes, no realistic human face, no hair, no gendered anatomy or clothing, no eyelashes, no beard. Quiet playful personality, technological elegance, not busy cartoon clipart. Prefer a compact 512x512 square deliverable.
Input image 1 is STYLE REFERENCE ONLY, not an edit target. Make a NEW individual avatar, match its ceramic/glass materials, studio lighting, black backdrop, gentle eye styling and restrained warm microglow. Preserve the premium coherent series feel; do not copy the cloud character.
Subject: DOER / HANDS-ON LEARNER. A small rounded ceramic spirit leaning forward with intent, two dark oval eyes and two simple mitten-like appendages actively joining two translucent modular glass blocks together. A small warm champagne-gold glow appears only at the connection between the blocks. Energetic constructive pose, not an aggressive robot. No cloud, no orbit, no book, no visor, no tools or extra props. One character, exactly two joined modules.
```
