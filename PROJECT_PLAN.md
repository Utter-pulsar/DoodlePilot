# DoodlePilot — 架构 & 路线图

这份文档是项目的"地图"：先讲清楚底层怎么搭的、AI/harness 以后怎么接，再给你一份
分阶段的待办，告诉你每个功能往下能加哪些细节。

---

## 1. 总体架构

三个进程，两个窗口，一套"按名字调用"的 API。

```
┌─────────────────────────── Electron 主进程 (Node) ───────────────────────────┐
│  Store(JSON 持久化)                                                            │
│  AppCore = { store, events, hooks, queries, commands, broadcast }             │
│    ├─ collection-service   注册 collections.* / records.* / task.complete      │
│    ├─ alarm-service        注册 alarms.*                                       │
│    ├─ overlay-service      注册 overlay.* / rocket.* / banner.show             │
│    └─ scheduler            读闹钟，到点 → 跑 hooks → commands.execute('banner') │
│  WindowManager  ── 主窗口(看板/闹钟) + 透明覆盖层窗口(火箭/横幅)               │
│  registerIpc    ── 把 IPC 的 query/command 路由到 registries                   │
│  integrations   ── ★ 未来 AI/harness/OAuth 在这里 register hook，无需改业务码   │
└───────────────────────────────────────────────────────────────────────────────┘
        ▲  IPC: 只有 3 个通道 dp:query / dp:command / dp:event
        │
┌───────┴─────────── preload (contextBridge) ───────────┐
│  window.api = { query, command, on, onAny }           │  ← 类型来自 shared/api/contract
└───────────────────────────────────────────────────────┘
        ▲                                   ▲
┌───────┴──────────┐                ┌───────┴───────────────────┐
│ renderer/app     │                │ renderer/overlay          │
│ React + Rough.js │                │ PixiJS 透明舞台           │
│ zustand store    │                │ RocketScene / BannerScene │
│ 看板 / 闹钟 UI   │                │ 火箭·小车·飞机·横幅·烟花  │
└──────────────────┘                └───────────────────────────┘
```

### 三条总线（`src/shared/bus`）—— 这是"为 AI 预留接口"的核心

- **events**（`event-bus.ts`）：业务发生了什么（`task.completed`、`rocket.launched`…）。
  主进程 emit 后自动广播给所有窗口。`onAny` 可一次性监听全部事件（适合 AI 记录/回放）。
- **hooks**（`hook-bus.ts`）：业务的"可拦截时机"。瀑布式执行，handler 可**改写**载荷或返回
  `VETO` **否决**动作。这是 AI/harness 注入逻辑的主缝。点位见 `shared/api/hooks.ts`：
  `record.beforeCreate` / `task.beforeComplete` / `task.afterComplete` /
  `rocket.beforeLaunch` / `alarm.beforeTrigger` / `banner.resolveText`。
- **registry**（`registry.ts`）：`queries`(读) 和 `commands`(写) 两张表。**同一张表既被 IPC
  调用，也能在进程内被 AI 直接调用**——这就是"整个 app 可被脚本/AI 驱动"的来源。

### 为什么这样设计能"无痛接 LLM/OAuth"

未来在 `src/main/integrations/index.ts` 里：
```ts
// 让 LLM 改写横幅文案
core.hooks.register('banner.resolveText', async ({ alarm, defaultText }) => {
  return { text: await llm.rewrite(defaultText) }   // 你的 API 调用
}, { owner: 'llm-banner' })

// 让 AI 自动补全新任务的字段
core.hooks.register('record.beforeCreate', async (input) => { /* ... */ return input })

// AI 主动驱动应用（和 UI 走完全相同的入口）
await core.commands.execute('records.create', { collectionId, fields })
```
- LLM 调用、OAuth token 全部放**主进程**（密钥不进渲染层）。
- OAuth 回调：注册自定义协议 `doodlepilot://callback` 或起本地 loopback 服务器；
  token 用 Electron `safeStorage` 加密存储。这些都加在 `integrations/` 下，不动业务代码。

---

## 2. 数据模型（看板）

Lark 多维表格式（`src/shared/types/collection.ts`）：

- **Collection**（竖列/lane）：`{ name, icon, kind, fields[], archiveCollectionId }`。
  `kind` 只影响可选行为（`dailyTasks`→桌面火箭、`archive`→归档目标），**字段完全自定义**。
- **FieldDef**（列定义）：`text/longText/number/select/multiSelect/status/date/
  dateRange/checkbox/url/person/relation`。`relation`/`person` 带 `targetCollectionId`
  和可选 `reverseFieldId`。
- **RecordItem**（格子/卡片）：`{ fields: {fieldId: value}, archived, order, rocket? }`。
- **联动**：`relation` 字段存正向 id 数组；`syncReverse` 自动维护反向字段；`records.withLinks`
  还会扫描出所有**反向引用(backlinks)**——所以"项目里有某人"和"某人名下有该项目"天然双向。

首次启动会 seed 一套示例（人员/项目/每周/每日/归档，已互相连好线，每日任务自带火箭）。

---

## 3. 现状：哪些能跑，哪些是占位

✅ 已经能跑：
- 三进程/双窗口、透明可穿透覆盖层、IPC、持久化、事件广播。
- 看板：增删分类/记录、改标题、状态点击轮换、关系链显示、归档/删除、每日任务火箭开关。
- 闹钟：增删/启停、调度器按 提前量+重复间隔 触发、横幅预览。
- 覆盖层：小车送火箭、左键喷烟、右键完成→升空→烟花、飞机拉横幅(宽度随字数变)。

🟡 占位/待替换（**有意留的扩展点**）：
- 覆盖层全部是 PixiJS `Graphics` 手绘占位 → 等你出图后换成精灵图（见下方阶段二）。
- 关系字段在 UI 里只**显示**，还不能在卡片里**编辑选择**（需要一个关系选择弹层）。
- 闹钟只做了 `daily`，`once`/`weekly` 类型已在类型里、UI 待补。
- 没有托盘图标；关主窗口=退出整个 app。
- 持久化是单 JSON 文件（足够，量大再换 SQLite，Store 接口已隔离好）。

---

## 4. 路线图（建议顺序）

### 阶段一 · 跑起来 & 验证手绘味（现在）
1. `pnpm install && pnpm dev`，确认两个窗口都起、火箭/横幅动画能看。
2. 出**第一套手绘图**：图标 + 火箭单帧 + 飞机 + 横幅三段（见 `assets/ASSET_PROMPTS.md`）。
   先用这几张就能把"手绘味对不对"定下来。

### 阶段二 · 接入真实美术
3. 我加 `src/renderer/overlay/lib/assets.ts`：按 `assets/sprites/manifest.json` 用
   `Assets.load` 载入 PNG、把图集切成帧（`AnimatedSprite`）。
4. 把 `Rocket/Plane/Banner/Firework/Smoke` 的 `Graphics` 替换为精灵；横幅用三段 9-slice
   按文字宽度拼接。
5. 出火箭升空图集、烟花图集，替换粒子占位。

### 阶段三 · 看板做扎实
6. 关系字段编辑弹层（搜索目标记录、勾选、双向落库——后端 `records.link/unlink` 已就绪）。
7. 字段管理 UI（加/改/删列、配置 select 选项与颜色、设主字段）。
8. 归档视图 / 历史看板（按时间筛 `archived` 记录；可做"完成即归档"的 hook 开关）。
9. 卡片拖拽排序、跨 lane 拖拽。

### 阶段四 · 闹钟做全
10. `once`/`weekly` 的 UI；多时间点；提醒音；横幅点击可"知道了/稍后"。
11. 横幅排队（多个闹钟同时到点不重叠）。

### 阶段五 · 产品化
12. 托盘图标 + 开机自启 + 关窗到托盘（桌面小工具应当常驻）。
13. 多显示器：每个屏幕一个覆盖层。
14. 设置页：画风/调色板、字体、覆盖层开关、数据导入导出。
15. 打包三平台、签名/公证（CI 已就绪，补 secrets 即可）。

### 阶段六 · AI / harness
16. 在 `integrations/` 接 LLM：自动拆解每日任务、改写横幅、根据看板生成周报。
17. OAuth 接入（同步日历→自动建闹钟等）。

---

## 5. 怎么加一个新功能（固定套路）

1. 在 `shared/api/contract.ts` 给 `QueryMap`/`CommandMap`/`EventMap` 加条目（先定契约）。
2. 在某个 `*-service.ts` 里 `queries.register` / `commands.register` 实现它；该改数据就
   `store.mutate`，该通知就 `events.emit`。
3. 需要可被 AI 拦截就在 `shared/api/hooks.ts` 加 hook 点，并在实现里 `hooks.run`。
4. 渲染层用 `api.query/command` 调用，用 `api.on` 订阅事件刷新（zustand store 已示范）。
- **不需要动 IPC**（永远只有 3 个通道）。

---

## 6. 生产化注意事项（先记着，别现在做）

- **CSP**：现在的 `index.html` 是开发宽松版，发版前收紧（去掉 `unsafe-inline`、
  localhost、改用本地字体）。
- **字体**：把 Excalifont/手写体 + 一款中文手写体**本地打包**，别依赖 Google Fonts 联网。
- **签名**：Windows 可用证书签名免 SmartScreen；macOS 加 Apple 开发者证书做公证（CI 加 secrets）。
- **安全**：所有外部 API/密钥只在主进程；渲染层永远只通过 IPC 拿结果。
