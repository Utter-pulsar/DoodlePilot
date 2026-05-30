# DoodlePilot — Codex 生图提示词清单（Q版像素风 · v4）

> 工作流：把每个素材下面**整段**提示词丢给 Codex → 拿到透明 PNG → 按"保存为"放好 → 告诉我，我接代码。
> 像素图我用 NEAREST 放大。带背景就追加：`transparent background, no backdrop, crisp pixel edges`。

## ⚠️ 头号铁律：重心绝对不动，Q弹只靠"改边缘"

之前抖成帕金森,是因为帧里**物体整体在上下跳(重心在晃)**。这次**严禁**任何"整体平移/上下浮动"。
所有"活/Q弹"的感觉,**只能**靠**轮廓的挤压与拉伸(squash & stretch)**和**边缘的轻微抖动**来做:
身体可以变矮变胖、变高变瘦、边缘起伏,但**锚点(地面物体=底部,空中物体=中心)必须在每一帧里都钉在完全相同的像素位置**。

> 每段提示词里都已嵌入这句英文铁律(请勿删):
> `CRITICAL: in EVERY frame the subject's anchor stays at the EXACT same pixel position — it must NOT drift, bob, slide, float, or translate between frames. All life comes ONLY from squash-and-stretch of the silhouette and edge wobble (the body gets shorter+wider or taller+thinner, outlines ripple) while the anchor is pinned. Think jelly pinned to the floor, NOT an object hopping. Do not move the whole object up/down/around.`

帧数：可以多给,越多越顺。我按网格切片。

## 本轮要(重)做什么

| 素材 | 状态 | 关键 |
| --- | --- | --- |
| **运输车组 transport-rig** | 🆕 合并重做 | 牵引车+平板**画成一体**(钩子本就连着),轮子贴在固定地线、**车身不上下跳**;甲板平整留空给火箭站 |
| **火箭·升空 rocket-fly** | 🔁 重做 | **底部喷口钉在同一条线**,身体只向上挤压/拉伸 + 火焰跳动,整体不平移;16 帧更顺 |
| **火箭·下台子 rocket-dismount** | 🔁 重做逻辑 | 顺序：站→**蓄力变矮(底部钉死)**→**伸长(底部仍钉死)**→**才起跳(此时才位移)**→落地压扁→站稳 |
| **飞机·飞行 plane-fly** | 🔁 重做 | **机身中心钉死**,只有螺旋桨转 + 机翼/尾翼边缘轻颤,机身不上下晃 |
| 烟花 a/b/c · 喷烟 smoke · 火箭站立 rocket-classic · 图标 icon | ✅ 保留 | 不用重做 |

---

## 统一画风（每段已自带）

```
2D pixel-art game sprite in a cute Q-version (chibi / super-deformed) style: short stubby charming proportions, big readable silhouette. Crisp hard-edged pixels, NO anti-aliasing, limited palette (~12-16 colors), pixel-cluster shading with selective dithering, clean 1px darker outline. Polished indie pixel-game look (Stardew Valley / Eastward quality), warm and lively. Fully transparent background (PNG alpha), pixels grid-aligned, clean edges, no ground plane, no caption text. Avoid: 3D render, photorealistic, ambient occlusion, soft shadows, gradient shading, blur, vector art, hand-drawn or sketch look.
```

---

## 1) 运输车组 TRANSPORT-RIG（合并重做 · 行驶循环）
**保存为：** `assets/sprites/rig/transport-rig.png` · **尺寸：** 1280×400（2×2，每格640×200，透明）

```
<统一画风>
A side-view tow tractor HOOKED to a long flat low platform trailer behind it (drawn as ONE connected rig: the tractor's tow bar physically links to the platform's ring — they are joined, never detached), facing right. The platform deck on top is a flat, clear, empty surface (NO rocket drawn) where cargo would stand. Industrial yellow tractor, steel-gray deck with yellow hazard stripes, chunky charcoal rubber wheels. A 4-frame driving loop laid out on a 2-columns by 2-rows grid (each cell 640x200), read left-to-right top-to-bottom: only the WHEELS rotate (spokes/tread at a new angle each frame) and a tiny exhaust puff flickers.
CRITICAL: in EVERY frame the subject's anchor stays at the EXACT same pixel position — it must NOT drift, bob, slide, float, or translate between frames. The wheels sit on the SAME ground line in all 4 cells; the rig body does NOT bounce up/down. All life comes ONLY from wheel rotation and the exhaust puff. Do not move the whole rig up/down.
The flat deck top surface should sit at a consistent height in every frame so a separate rocket sprite can be placed standing on it.
```
> 钩子本来就连在平板上(一体画),火箭由代码单独放在甲板上。车身绝不上下跳。

## 2) 火箭·升空 ROCKET-FLY（重做 · 16 帧）
**保存为：** `assets/sprites/rocket/rocket-fly.png` · **尺寸：** 1024×1024（4×4，每格256，透明）

```
<统一画风>
A looping flight animation of the SAME chibi rocket as rocket-classic, on a 4-columns by 4-rows grid (16 frames, each cell 256x256), read left-to-right top-to-bottom. A bright FIRE jet (orange-yellow-white flames, NOT smoke) shoots downward from the bottom nozzle and flickers/changes shape each frame. The rocket body does a lively springy Q-bounce — it squashes shorter+wider then stretches taller+thinner — but ONLY by deforming its silhouette.
CRITICAL: in EVERY frame the subject's anchor stays at the EXACT same pixel position — it must NOT drift, bob, slide, float, or translate between frames. The rocket's BOTTOM (the nozzle exit) is pinned to the SAME Y line in all 16 cells; the body squashes/stretches UPWARD from that pinned base; the whole rocket never moves up or down. Think jelly pinned to the floor. Loop-friendly. Identical rocket design/palette every frame.
```
> 喷口底边每帧同一条线;只有身体向上挤压拉伸 + 火焰跳动。

## 3) 火箭·下台子 ROCKET-DISMOUNT（重做逻辑 · 16 帧）
**保存为：** `assets/sprites/rocket/rocket-dismount.png` · **尺寸：** 1024×1024（4×4，每格256，透明）

```
<统一画风>
A one-shot dismount animation of the SAME chibi rocket as rocket-classic, on a 4-columns by 4-rows grid (16 frames, each cell 256x256), read left-to-right top-to-bottom, in this EXACT logical order:
- Frames 1-2: standing tall and still.
- Frames 3-5: SQUASH — crouch down, body compresses shorter and wider to gather power (anticipation). Base pinned.
- Frames 6-7: STRETCH — spring tall and thin, fully extended, about to jump. Base STILL pinned.
- Frames 8-11: LEAP — NOW the rocket leaves the ground and rises into the air (stretched, airborne). This is the ONLY part where it moves up.
- Frames 12-13: LAND — comes down and squashes hard on impact.
- Frames 14-16: SETTLE — wobble-overshoot back to standing tall and still.
CRITICAL: for ALL grounded frames (1-7 and 12-16) the rocket's BASE is pinned to the EXACT same Y line — it must NOT drift or bob; the squash/stretch happens by deforming the silhouette only. The whole-object rising is allowed ONLY during the LEAP frames (8-11). Identical rocket design/palette every frame. No flame.
```
> 顺序必须是：蓄力变矮 → 伸长 → 才起跳位移 → 落地压扁 → 站稳。落地前后底边都钉死,只有起跳那几帧才离地。

## 4) 飞机·飞行 PLANE-FLY（重做 · 螺旋桨转,机身不晃）
**保存为：** `assets/sprites/plane/plane-fly.png` · **尺寸：** 1440×400（4×2，每格360×200，透明）

```
<统一画风>
A looping flight animation of a cute Q-version pixel-art propeller plane, side view, nose pointing RIGHT, on a 4-columns by 2-rows grid (8 frames, each cell 360x200), read left-to-right top-to-bottom. The 3-blade nose propeller rotates — blades at a clearly different angle each frame, crisp pixel blades, no motion-blur smear. The wing tips and tail edges may wobble/flutter a tiny bit. No face. A small dark tow-hook at the tail (left).
CRITICAL: in EVERY frame the subject's anchor stays at the EXACT same pixel position — the plane's body CENTER is pinned to the EXACT same point in all 8 cells; it must NOT bob up/down, drift, or translate. ONLY the propeller spins and the wing/tail edges flutter slightly. Do not move the fuselage. Identical plane design/palette every frame; frame 8 loops to frame 1.
```
> 机身中心钉死,只有螺旋桨转 + 翼尖轻颤。绝不上下晃。

---

## 保存位置与格式总表

| 资产 | 路径 | 尺寸 |
| --- | --- | --- |
| 运输车组 | `assets/sprites/rig/transport-rig.png` | 1280×400（2×2） |
| 火箭·升空 | `assets/sprites/rocket/rocket-fly.png` | 1024×1024（4×4） |
| 火箭·下台子 | `assets/sprites/rocket/rocket-dismount.png` | 1024×1024（4×4） |
| 飞机·飞行 | `assets/sprites/plane/plane-fly.png` | 1440×400（4×2） |
| （保留）火箭站立 | `assets/sprites/rocket/rocket-classic.png` | 256×256 |
| （保留）烟花 a/b/c | `assets/sprites/firework/firework-*.png` | 1024×1024（4×4） |
| （保留）喷烟 | `assets/sprites/smoke/smoke.png` | 768×384（4×2） |
| （保留）图标 | `resources/icon-source.png` | 1024×1024 |

> 生成好告诉我,我会按"**运动=代码平滑移动 / 形变=帧(重心钉死)**"重新接：
> 运输车组开进来 → 火箭蓄力→伸长→**代码做平滑起跳弧线**把它从甲板送到地面槽位（落地压扁帧）→ 站稳；
> 升空时**代码平滑上升+缩小**,身体用钉底的 fly 帧做 Q弹;飞机平飞,螺旋桨转、机身不晃。
> 旧的 `tractor.png / platform.png / car.png / plane.png` 用合并的 rig 接好后可删。
