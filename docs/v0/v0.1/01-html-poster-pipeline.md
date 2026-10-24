# 01 · HTML/CSS 海报真源迁移开发计划

> **状态**：阶段 0 ✅ · 阶段 1 ✅（T1~T4 全绿）· 阶段 2 待启动（仅 T1 完成）
> **起草**：2026-10-22
> **最近更新**：2026-10-24（阶段 1 收尾）
> **范围**：`clawdao-image-factory` 全部海报类产出（通用海报 / 商品图 / 其它素材 / Web 海报工作室）
> **关联文档**：`AGENTS.md`（平台合规规范，**本计划任何产出都不得违反**）· `docs/v0/v0.1/README.md`

---

## 0. 一句话结论

**把海报真源从「自研 SVG 排版器」换成「HTML + CSS」，用固定画布 + 绝对定位 + 受约束的 CSS 变量承载排版，
把 AI 主视觉当图片资源挂进去，让出图与编辑器预览共用同一份 DOM。**
阶段 0 已实测证明该链路可用，并顺带发现现有 SVG 渲染器存在**中文避头尾缺陷**（行首标点），HTML 天然修好。

---

## 1. 背景与问题

### 1.1 当前四条产出路径

| 路径 | 入口 | 产物 | 渲染方式 |
| --- | --- | --- | --- |
| **A** 通用海报 / 直播间封面 | `bun run scripts/gen-poster.ts <id>` | `outputs/poster/**.png` | `renderPoster()` → SVG → `sharp` → PNG |
| **B** 小店商品图 | `bun run scripts/gen-shop-listing.ts v8` | `outputs/shop-listing-v8/**.png` | 同 A（共用 `renderPoster()`） |
| **C** 其它视觉素材 | `bun run scripts/gen-asset.ts <id>` | `outputs/assets/**` | `image-01` 底图 → `banner-compositor` / `text-overlay` → JPEG/PNG |
| **D** Web 海报工作室 | `http://localhost:5182` | `outputs/poster/drafts/<id>.json` + 导出 PNG | Fabric.js 2（`DDNPosterEditor`） |

A/B/C 产物是**光栅图片**，D 是**结构化画布**。D 的图片白名单（`src/lib/poster-ops.ts`）已允许 `/outputs/`，
所以 A/B/C 成品可以低成本塞进 D；但那是**像素级编辑**，不是结构级编辑。

### 1.2 三个真实痛点

1. **字宽估算不准**
   `src/lib/poster-renderer.ts` 用 `textUnits()` 估算字宽（汉字 `1.0` / 空格 `0.3` / 大写字母与数字 `0.62` / 其它 `0.52`），
   与浏览器真实字体度量存在偏差。合成用例实测：长链接断点 SVG 断在 `?ref` / `=shop`，浏览器断在 `?` / `ref=shop`。

2. **中文避头尾缺失（现网正在发生的缺陷）**
   估算式逐字折行会把「、」甩到行首，违反 UAX #14。`promo-blue` 四个卡片说明里 **3 个** 被折成
   「下载安装、账号权限」/「**、**基础配置」这种行首标点。这是**已上线海报里的排版硬伤**。

3. **两套渲染器并存**
   出图走 SVG（估算度量），编辑预览走 Fabric/CoreText（真度量）——同一张图两个样子，
   预览所见非所得，且差异无法在生成期被发现。

### 1.3 为什么不是「继续修 SVG」

修 1、2 意味着在自研排版器里重写一遍 UAX #14 断行 + 真实字体度量；浏览器已经实现了，且
**编辑器预览本来就是浏览器**。继续修 SVG 等于让自研排版器追平浏览器，且永远追不平。

---

## 2. 架构决策

### 2.1 决策（ADR-001）

> **采用 HTML/CSS 作为海报的唯一真源。** 保持「配置驱动」这一项目既有原则不变：
> YAML 配置仍是内容与版式的唯一入口，只是把渲染后端从 SVG 换成 HTML。
> 迁移期 SVG 管线**并行保留**，做像素级 diff；阶段 3 验收通过后才切换正式出口。

### 2.2 混合架构各层职责

| 层 | 载体 | 职责 | 约束 |
| --- | --- | --- | --- |
| 排版与文案 | **HTML + CSS** | 标题/卡片/表格/页脚/FAQ 的位置与折行 | 固定 px 画布、**绝对定位**、CSS 变量令牌化 |
| AI 主视觉 | `<img>` | AI 生成的底图 / 人物 / 场景 | 只能是图片，不参与文字渲染 |
| 主视觉内拼贴 | `<canvas>` | 主视觉内部的自由拼贴（可选） | 仅限 `<img>` 内部，不影响排版层 |
| 艺术字兜底 | 内嵌 `<svg>` | C 类 banner 的 `clipPath` 描边艺术字 | CSS 做不到的效果才用 SVG |
| 二维码 | `<img>`（data-uri） | 可扫二维码 | **禁止**把二维码 path 当普通文本/路径搬运 |

> **HTML 是「用 CSS 写 SVG」，不是「用 CSS 写网页」。** 不能使用纵向文档流——海报需要精确填充、
> 局部编辑稳定、元素坐标确定。

### 2.3 被否决的方案

| 方案 | 否决原因 |
| --- | --- |
| `poster-fabric.ts` adapter（配置 → Fabric → 草稿） | 若 HTML 为真源，等于同时维护两套渲染引擎，且**不能**解决「出图与预览不一致」；降级为备选 |
| 直接用 GrapesJS / Craft.js / Puck 等开源编辑器 | 只能借鉴通用基建（渲染、拖拽、撤销栈）；固定画布、图层树、属性面板、品牌令牌、纯色背景、合规校验这些**海报语义仍需自写** |
| 继续用 OCR / 版面反推把 A/B/C 成品变成可编辑结构 | 反推不可靠，文字层丢失，违背「图与文案同源」 |
| 让 LLM 直接生成任意 DOM | 不可控、不可复现、易踩合规红线；LLM 只允许改文案、颜色变量、间距 |

### 2.4 编辑器形态：DOM 主 + Fabric 辅

| 需求 | 归属 | 实现 |
| --- | --- | --- |
| 改文案、换标题、换主视觉、换配色 | **DOM 模式** | `contenteditable` + DOM 图层树 + 属性面板 |
| AI 改版 | **DOM 模式** | LLM 输出局部 HTML diff，只允许改白名单字段 |
| 任意拼贴、缩放、旋转、自由拖拽 | **Fabric 模式**（保留） | 现有 `DDNPosterEditor` 不动 |
| 预览一致性 | **DOM 模式** | 浏览器直接渲染，与出图同源同度量 |

### 2.5 不可越界的红线

- **商品图对外内容必须过 `configs/compliance/*.yaml`**：`系统` / `自我进化` / `数智化` = 0 次；
  「连播 / 三天 / 3 天」= 0 次；无售价、无效果承诺。
- **礼物 / 推荐位必须纯色平涂**：`background: solid`，无渐变 / 网格 / 粒子 / 光束 / 暗角 / 透明 PNG。
- **D 导出必须补合规闸门**：目前 D 导出的 Fabric 图片**不在** `check-listing-compliance.ts` 扫描范围内，
  无论走 DOM 还是 Fabric 都要堵上。
- **LLM 不得自由生成 DOM**：只允许改文案、颜色变量、间距。
- **A/B/C 正式出图链路在阶段 3 验收前保持 YAML → SVG 不变**。

---

## 3. 阶段 0 实测结论（✅ 已完成）

命令：`bun run scripts/html-poster-probe.ts promo-blue`（产物在 `outputs/_tmp/html-probe/`）

| 项 | 结果 |
| --- | --- |
| HTML 出图 | 可用；headless shell 单张 **275–285 ms**（含浏览器冷启动），复用常驻浏览器可再降 |
| 文本块比对 | 17 个文本块，**行数全部一致**；**3 处断行位置不同**（均为 SVG 行首标点问题） |
| 合成用例 | 6 条中 5 条逐行一致；长链接断点不同（SVG `?ref`/`=shop` ↔ 浏览器 `?`/`ref=shop`） |
| 像素差 | 灰阶 >8 占 **5.89%**，>64 占 **3.83%**；差异集中在网格区竖向偏移与字体抗锯齿 |
| 二维码 | 两版**像素级一致**（黑模块跨度 375 vs 376 px） |
| 合规闭环 | 直接扫 HTML 渲染后的 DOM 可见文本 → v8 规则 **0 命中** |

**已落地的验证件**

| 文件 | 作用 |
| --- | --- |
| `scripts/lib/html-render.ts` | Playwright 渲染封装：Chromium 定位、字体就绪、基线对齐脚本 |
| `scripts/html-poster-probe.ts` | 阶段 0 对照探针：出图 + 断行比对 + 像素差 + 合规闭环 |
| `configs/poster-html/probe-promo-blue.html` | 手写复刻模板（**不是**通用 block 映射器） |

---

## 4. 阶段划分

| 阶段 | 目标 | 出口条件 |
| --- | --- | --- |
| **P0** 阶段 0 验证 | 证明 HTML 能出图、能度量、能闭环 | ✅ 已完成 |
| **P1** 渲染环境固化 | 锁死渲染环境，保证同配置同产出 | 同一配置连跑 5 次 sha256 一致 |
| **P2** block → HTML 映射器 | `configs/poster/*.yaml` 的 block 映射成 HTML 模板 | 16 种 block 全部有 HTML 渲染，与 SVG 并行 diff |
| **P3** D 编辑器切 DOM 模式 | 预览 = 出图 | DOM 模式预览与出图 PNG 逐像素一致 |
| **P4** 迁移 B（商品图） | 商品图走 HTML 链路 | 方图严格 1080×1080、纯色底可采样、v8 合规 0 命中 |
| **P5** 迁移 C（素材） | banner / 艺术字迁移 | 艺术字走内嵌 SVG 兜底，效果不劣化 |

---

## 5. 完整 Todo 清单

> 验收列写的是**可自动判定**的通过标准。凡是「人工看一眼」也算验收的，都写了判定口径。
> 每项都标注了产出物，产出物落在项目源码目录（`src/` / `scripts/` / `configs/` / `web/`），
> 运行产物才落 `outputs/`。

### P1 · 渲染环境固化 ✅

| ID | 任务 | 产出物 | 验收命令 | 通过标准 | 实测结果 |
| --- | --- | --- | --- | --- | --- |
| P1-T1 | 建渲染环境锁文件（Chromium revision、Playwright 版本、`deviceScaleFactor`、locale、时区、颜色方案、字体栈及每级回退） | `configs/poster-html/render-env.lock.yaml` | `bun run scripts/check-render-env.ts --probe` | 报告打印的锁值与锁文件逐项一致 | ✅ Chromium 1248 / Playwright 1.64.1 / DSF 1 / zh-CN / Asia-Shanghai |
| P1-T2 | 字重回退显式化：声明每级字重的实际可用性，禁止 PingFang SC 900 静默回退 | `configs/poster-html/fonts.yaml` + 渲染前校验 | `bun run scripts/check-render-env.ts --probe` | 每级字体/字重标注 `resolved` 或 `fallback`，无静默回退 | ✅ 12 档逐档核对（`native` / `nearest` / `synthesized`） |
| P1-T3 | 常驻浏览器：复用 Playwright Browser 实例 + 同一个 context，批量出图不重复冷启动 | `scripts/lib/html-render.ts` 增 `getSharedBrowser()` + `context` 复用；`scripts/check-render-bench.ts` | `bun run scripts/check-render-bench.ts` | 只冷启动 1 次；N 张总耗时 ≤ 冷启动单张 + N × 稳态单张；稳态单张 ≤ 200 ms | ✅ 10 张合计 ~1.0 s（若每张冷启动需 ~4.4 s，省 77%）；稳态 77~88 ms/张 |
| P1-T4 | 确定性验证：同配置连跑 5 次 | `scripts/check-render-determinism.ts` | `bun run scripts/check-render-determinism.ts` | 5 次 HTML 产物 sha256 完全一致 | ✅ `ae190049…` × 5 |

> **口径说明（P1-T3 的「热态」）**：常驻浏览器的**首张**会多付一次字体命中探针（像素级比对，约 170ms，
> 按浏览器实例缓存），这是一次性开销。因此「稳态」从第 2 张起统计；但**总耗时判定仍含首张**（口径更严）。
>
> **口径修正（2026-10-24）**：原验收写的是「N 张总耗时 ≤ 单张冷启动 × 2」。实测冷启动耗时受
> OS 缓存 / JIT 影响在 **427 ~ 1335ms** 之间浮动，拿它做**比值**闸门会偶发翻车（冷启动侥幸快的那次
> 预算就卡死了，实测踩中过一次）。改为**加法**形式：「冷启动单张 + N × 稳态单张 × 1.15 容差」——
> 表达的仍是同一件事（这批图只付了一次冷启动，其余是边际成本），但稳定。原始比值仍会打印做参考。
>
> **待办（阶段 2 开工时处理）**：`live-cover` 的 HTML 模板要等 P2-T2 的 block 映射器完成后才能接进基准；
> 目前基准用阶段 0 的 `probe-promo-blue.html`（800×2000），测的是渲染管线本身，与内容无关。

### P2 · block → HTML 映射器

| ID | 任务 | 产出物 | 验收命令 | 通过标准 |
| --- | --- | --- | --- | --- |
| P2-T1 | 定义 HTML schema 与 `poster-spec.css`：颜色 / 字号上限 / 间距收敛到 CSS 变量 | `configs/poster-html/spec.css` + `schema.md` | 人工 review | 变量清单覆盖三套主题（`warm` / `blue` / `fresh`）；LLM 可改范围明确为「文案 / 颜色变量 / 间距」 |
| P2-T2 | 实现 block → HTML 模板映射（覆盖 `hero` `title` `section` `cards` `timeline` `rows` `profile` `note` `footer` `centerTitle` `features` `grid` `panel` `qr` `visual` `spacer`，共 16 种） | `scripts/lib/poster-html-blocks.ts` | `bun run scripts/gen-poster-html.ts live-cover` | 16 种 block 全部渲染成功，无 fallback 分支 |
| P2-T3 | 通用入口脚本（对齐 `gen-poster.ts` 的参数面） | `scripts/gen-poster-html.ts` | `bun run scripts/gen-poster-html.ts --list` / `<id>` | `--list` / `--out` / `--sizes` / `--count` / `--title` 与 SVG 入口同义可用 |
| P2-T4 | SVG ↔ HTML 并行 diff（复用阶段 0 探针的断行比对 + 像素差统计） | `scripts/poster-diff.ts` | `bun run scripts/poster-diff.ts live-cover` | 报告给出：断行不一致数、像素差占比、二维码一致性三项 |
| P2-T5 | 断行差异归零 | — | 同 P2-T4 | `live-cover` + `promo-blue` 两配置的**断行不一致 ≤ 2 处且均为已登记的已知项**（登记在报告里） |
| P2-T6 | 二维码在 HTML 链路中保持像素级一致 | — | 同 P2-T4 | 两版二维码黑模块跨度差 ≤ 1 px，模块边长为整数 |
| P2-T7 | 合规检查器支持扫 HTML 可见文本 | `scripts/lib/poster-html-compliance.ts` | `bun run scripts/check-poster-html-compliance.ts live-cover` | 命中即 `exit 1`；对 `promo-blue` 报 0 命中 |

### P3 · D（海报工作室）切 DOM 模式

| ID | 任务 | 产出物 | 验收命令 | 通过标准 |
| --- | --- | --- | --- | --- |
| P3-T1 | DOM 图层树（由 HTML 节点树生成，可选中/高亮/锁定） | `web/src/modules/poster/core/domLayerTree.ts` | `bun run scripts/e2e-poster-studio.mjs` | 能在 DOM 模式下列出并选中每个文本块 |
| P3-T2 | 属性面板：文案、字号（受上限约束）、颜色变量、间距 | `web/src/modules/poster/ui/DomInspector.tsx` | 同上 | 改文案后预览实时更新，且不越出 CSS 变量允许范围 |
| P3-T3 | AI 局部编辑：LLM 只输出白名单字段的 diff，不产出任意 DOM | `web/src/modules/poster/core/domOps.ts` | 同上 | 注入非法 DOM 的响应被拒绝并报错，不落库 |
| P3-T4 | DOM 模式导出 PNG = 出图链路同源 | `web/src/modules/poster/core/domExport.ts` | 同上 | DOM 预览截图与 `gen-poster-html.ts` 产物逐像素一致 |
| P3-T5 | **D 导出合规闸门**（当前缺口） | `scripts/check-listing-compliance.ts` 增导出前检查 | `bun run scripts/check-listing-compliance.ts v8` | D 导出前必过 v8 规则，命中即拒绝导出 |
| P3-T6 | Fabric 模式保留（任意拼贴/缩放/旋转），与 DOM 模式共存 | — | 人工验收 | Fabric 能力不回归；草稿 `outputs/poster/drafts/<id>.json` 两种模式都能加载 |

### P4 · 迁移 B（商品图）

| ID | 任务 | 产出物 | 验收命令 | 通过标准 |
| --- | --- | --- | --- | --- |
| P4-T1 | 商品图 block → HTML 模板 | `configs/poster-html/shop-listing-v8/` | `bun run scripts/gen-shop-listing-html.ts v8` | 10 张图全部产出，命名与 `outputs/shop-listing-v8/` 对齐 |
| P4-T2 | 固定方形 1080×1080 | — | 同上 | 全部方图严格 1080×1080（不是 1081） |
| P4-T3 | 纯色底可采样验证（礼物 / 推荐位） | `scripts/check-solid-bg.ts` | 同上 | 背景像素采样为唯一色；无渐变 / 网格 / 粒子 / 光束 / 暗角 / 噪点 |
| P4-T4 | 浅底铁律：草绿 `#5CB02F` 仅用于标题装饰，小字压深到 `#3E8E1F` 系 | `configs/poster-html/spec.css` | 人工 review 浅底两图 | 小字标签对比度 ≥ 4.5:1；浅底标题无描边无发光 |
| P4-T5 | 合规闭环 | — | `bun run scripts/check-listing-compliance.ts v8` | 图文一致 26 项、正向词 18/18、**0 命中** |
| P4-T6 | AI 主视觉插槽（`image-01` 出底图 → HTML `<img>`） | `configs/poster-html/` 模板内 `<img>` 槽位 | `bun run scripts/gen-shop-listing-html.ts v8 --ai` | 底图正常挂载，文字仍由本地渲染，**无中文乱码** |

### P5 · 迁移 C（素材）

| ID | 任务 | 产出物 | 验收命令 | 通过标准 |
| --- | --- | --- | --- | --- |
| P5-T1 | banner 渐变标题 / 描边 / 发光用 CSS 近似 | `configs/poster-html/assets/` | `bun run scripts/gen-asset-html.ts top-banner` | 与现有 `gen-asset.ts` 产物人工对比，视觉不劣化 |
| P5-T2 | 艺术字 `clipPath` 效果用**内嵌 SVG** 兜底 | 同上 | 同上 | 描边艺术字与现有产物一致；`clipPath` 效果不丢失 |
| P5-T3 | 切换正式出口 | `scripts/gen-asset.ts` 增加 HTML 后端开关 | `bun run scripts/gen-asset.ts top-banner --backend html` | 两条链路产物可对比；切换有回滚开关 |

### 横切项（贯穿 P1–P5）

| ID | 任务 | 产出物 | 验收命令 | 通过标准 |
| --- | --- | --- | --- | --- |
| X-T1 | 正式出口切换开关（默认仍走 SVG） | `scripts/lib/render-backend.ts` | `bun run scripts/gen-poster.ts live-cover` | 不加参数时行为与现在**逐字节一致** |
| X-T2 | 回归基线：SVG 管线产物 sha256 不变 | `outputs/_archive/` 基线快照 | `bun run scripts/gen-poster.ts live-cover --out ./outputs/_tmp/regress` | 与基线 sha256 一致 |
| X-T3 | 文档同步：`AGENTS.md` 记录新链路与命令 | `AGENTS.md` | 人工 review | 命令可直接复制执行 |
| X-T4 | 类型与构建零错误 | — | `bunx tsc --noEmit -p scripts/tsconfig.json && bunx tsc --noEmit` | 两条命令均 0 错误 |

---

## 6. 风险登记

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| HTML 与 SVG 几何不一致，diff 长期居高不下 | P2 卡住 | 几何只在 CSS 定义一次，SVG 侧不再作为参照系；diff 阈值逐版下调 |
| 批量出图性能 | 大批量任务变慢 | P1-T3 常驻浏览器；必要时多 worker 分片 |
| Chromium 版本漂移导致产物变化 | 复现失败 | P1-T1 锁文件 + P1-T4 确定性验证 |
| LLM 生成的 DOM 越界 | 合规事故 | P2-T1 白名单 + P3-T3 拒绝非法 DOM + P3-T5 导出闸门 |
| 迁移期双链路并存漂移 | 维护负担 | 阶段 3 验收即切正式出口；SVG 管线标 deprecated 但**不删**直到 P5 完成 |
| 商品图合规回退 | 平台驳回 | 每个阶段都跑 `check-listing-compliance.ts v8`；上架前人工语义复核不变 |

---

## 7. 命令速查

```bash
export PATH="$HOME/.bun/bin:$PATH"

# 阶段 0 对照探针
bun run scripts/html-poster-probe.ts promo-blue      # 也可 bun run poster:probe
bun run scripts/html-poster-probe.ts live-cover

# 阶段 1 三件套
bun run scripts/check-render-env.ts --probe           # 也可 bun run render:env
bun run scripts/check-render-determinism.ts           # 也可 bun run render:determinism
bun run scripts/check-render-bench.ts                 # 也可 bun run render:bench

# 现有正式链路（本计划落地前后均不变）
bun run scripts/gen-poster.ts --list
bun run scripts/gen-poster.ts live-cover
bun run scripts/gen-poster.ts live-cover --sizes 1600x2848,1080x1920
bun run scripts/gen-shop-listing.ts v8
bun run scripts/gen-asset.ts --list

# 合规
bun run scripts/check-listing-compliance.ts v8

# 类型检查
bunx tsc --noEmit -p scripts/tsconfig.json && bunx tsc --noEmit
```

---

## 8. 决策记录索引

| 编号 | 决策 | 状态 |
| --- | --- | --- |
| ADR-001 | 采用 HTML/CSS 作为海报唯一真源，SVG 迁移期并行保留 | 已定（阶段 0 支撑） |
| ADR-002 | 「配置 → Fabric → 草稿」adapter 降级为备选 | 已定 |
| ADR-003 | 开源编辑器只借鉴基建，海报语义自写 | 已定 |
| ADR-004 | LLM 不得自由生成 DOM，只改白名单字段 | 已定 |
| ADR-005 | 迁移顺序 A → D → B → C，C 最后迁并用内嵌 SVG 兜底 | 已定 |
| ADR-006 | 正式出口分阶段切换，SVG 管线保留至 P5 完成 | 已定 |
