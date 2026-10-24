# 海报 HTML Schema（poster-html schema）

> 版本：v1（2026-10-24）
> 配套规范：`configs/poster-html/spec.css`
> 渲染环境锁：`configs/poster-html/render-env.lock.yaml`
> 字体锁：`configs/poster-html/fonts.yaml`
> 计划文档：`docs/v0/v0.1/01-html-poster-pipeline.md`（P2 阶段）

本文件定义**海报 HTML 真源的 DOM 结构、变量契约与可编辑边界**。
HTML/CSS 管线是海报的正式出图链路；SVG 管线（`src/lib/poster-renderer.ts`）在迁移期
作为**像素对照件**保留，切换正式出口后只做回归比对，不再改它的渲染逻辑。

---

## 0. 三条总原则

| # | 原则 | 落地方式 |
|---|---|---|
| 1 | **CSS 是几何唯一真源** | 所有尺寸写成 `--poster-w` 的比例；SVG ↔ HTML diff 只用于发现回归，不用于反向抄几何 |
| 2 | **调色板唯一真源** | 颜色来自 `PALETTES`（`src/lib/poster-renderer.ts`），运行时注入为 `--tone-*`；CSS 只做语义别名，不复制颜色表 |
| 3 | **纯色底必须真平涂** | `data-bg="solid"` 的背景层只有一个颜色值，无渐变 / 网格 / 粒子 / 光束 / 光晕 / 暗角 / 噪点 |

---

## 1. 渲染契约（坐标模型）

HTML 管线沿用 SVG 管线的两段式模型：**内容按布局宽度排版 → 整体缩放放进成品画布**；
背景层与品牌位/角标直接按成品像素绘制，不参与缩放。

```
成品画布 (outW × outH, 成品像素)
├── .poster__bg        背景层      尺寸 = 成品画布
├── .poster__content   内容层      布局单位（W = --poster-w），transform: scale(--scale)
├── .poster__brand     品牌位      成品像素坐标
└── .poster__mark      右下角角标   成品像素坐标
```

### 1.1 根元素注入变量（渲染器写 inline style，优先级最高）

| 变量 | 含义 | 来源 |
|---|---|---|
| `--poster-w` | 排版基准宽度 W（布局单位） | `PosterOptions.width` |
| `--canvas-w` / `--canvas-h` | 成品画布宽高（成品像素） | `fit.width` / `fit.height`；无 fit 时为自然高度 |
| `--scale` | 内容层缩放系数 | `min(canvasW / W, canvasH / naturalH)` |
| `--layout-h` | 内容层在布局单位下的高度 | `canvasH / scale` |
| `--tone-*` | 调色板槽位（见 §3） | `PALETTES[tone]` |

### 1.2 几何常量（`spec.css` 固定，LLM 不可改）

| 变量 | 值 | 与 SVG 对齐 |
|---|---|---|
| `--pad-x` | `0.067 × --poster-w` | `renderPoster` 的 `padX` |
| `--pad-top` | `0.085 × --poster-w` | `renderContent` 的 `topPad` |
| `--pad-bottom` | `0.06 × --poster-w` | `renderContent` 的 `bottomPad` |
| `--content-w` | `--poster-w - 2 × --pad-x` | `contentW` |
| `--block-gap` | `0.058 × --poster-w` | `renderContent` 的 `blockGap` |

> `padding.top` / `padding.bottom`（配置项）以**布局单位**注入到 `.poster__content` 的
> `padding-top` / `padding-bottom`，与 SVG 的 `renderContent(..., options.padding)` 语义一致。

### 1.3 块间距规则

SVG 侧 `blockGapOf()` 的优先级是 `next.gapBefore → cur.gapAfter → 默认`。
HTML 侧由渲染器把「某块之后的间距」写进**下一块**的 `--gap-before`：

```ts
gapAfter(i) = blocks[i + 1]?.gapBefore ?? blocks[i]?.gapAfter ?? 0.058 * W
```

CSS：`.blk { margin-top: var(--gap-before, 0); }`，`.blk:first-child { margin-top: 0; }`。

### 1.4 弹性占位（`spacer` with `fill: true`）

SVG 会把多余高度平均分给 `fill: true` 的 spacer。HTML 侧等价实现：

- `.poster__content` 是 `display: flex; flex-direction: column;`，高度 = `--layout-h`；
- `.blk--spacer.is-fill { flex: 1 1 0; min-height: 0; }`；
- 其它块 `flex: 0 0 auto`（不允许被压缩）。

若内容自然高度超过 `--layout-h`，内容溢出并被 `.poster__content { overflow: hidden }` 裁掉——
与 SVG 的画布裁切行为一致。

---

## 2. DOM 骨架

```html
<div class="poster" data-bg="solid" data-theme="fresh" data-palette="main"
     style="--poster-w:1080px; --canvas-w:1080px; ...; --tone-text:#...; ...">
  <div class="poster__bg"></div>

  <div class="poster__content">
    <section class="blk blk--hero" data-kind="hero" style="--gap-before:62px">
      ...
    </section>
    <section class="blk blk--cards" data-kind="cards" style="--cols:3">
      ...
    </section>
    <section class="blk blk--spacer is-fill" data-kind="spacer"></section>
  </div>

  <div class="poster__brand brand brand--chip" data-position="top-right">
    <img class="brand__logo" src="data:image/png;base64,...">
    <span class="brand__text">ClawDao</span>
  </div>

  <div class="poster__mark" data-position="bottom-right">
    <img class="mark__logo" src="...">
    <span class="mark__text">亿检链</span>
  </div>
</div>
```

约定：

- 每块是 `<section class="blk blk--{kind}" data-kind="{kind}">`；
  `data-kind` 便于合规扫描与 diff 工具按块定位。
- 块级实例差异（列数、宽度比例、最小高度、图标尺寸等）通过元素上的
  **inline 自定义属性**表达（`--cols`、`--width-ratio`、`--min-height`、`--qr-size`…），
  不用行内 `style` 写死几何。
- 所有文本节点必须是**真实可见文本**（禁止 `::before` 生成正文、禁止 canvas 画字），
  这样 P2-T7 的合规扫描扫 DOM 可见文本即可覆盖「图上的字」。

---

## 3. 调色板注入契约（`--tone-*`）

渲染器把 `PALETTES[tone]` 展开成下列自定义属性，写在 `.poster`（主调色板）
与 `.blk--panel`（面板反色板，`data-palette="card"`）的 inline style 上。

| 变量 | 来源字段 | 用途 |
|---|---|---|
| `--tone-text` / `--tone-text-dim` / `--tone-text-faint` | `text` / `textDim` / `textFaint` | 正文三级 |
| `--tone-gold` / `--tone-gold-soft` / `--tone-gold-faint` | `gold` / `goldSoft` / `goldFaint` | 强调色三级 |
| `--tone-card-fill` / `--tone-card-stroke` | `cardFill` / `cardStroke` | 卡片面 / 描边 |
| `--tone-chip-fill` / `--tone-chip-text` | `chipFill` / `chipText` | 小标签 |
| `--tone-rail` / `--tone-divider` | `rail` / `divider` | 时间轴竖线 / 分隔线 |
| `--tone-brand-text` | `brandText` | 品牌位文字 |
| `--tone-title-gradient` | `titleStops` + `titleGradient` | 标题渐变（已转成 CSS `linear-gradient()`） |
| `--tone-title-stroke` / `--tone-title-stroke-width` | `titleStroke` / `titleStrokeWidth` | 标题描边（浅底为 0） |
| `--tone-title-shadow` | `titleShadow` | 标题发光阴影（浅底为 `none`） |
| `--tone-accent-stops` | `accentStops` | 卡片顶部强调条渐变 |
| `--tone-card-opacity` | `cardOpacity` | 卡片填充不透明度 |
| `--tone-bg-top` / `--tone-bg-mid` / `--tone-bg-bottom` | `bg.top` / `bg.mid` / `bg.bottom` | 背景三段 |
| `--tone-organic-*` | `organic` | 有机背景（base / base2 / shapeA / shapeB / accent / dot） |
| `--tone-aurora-*` | `aurora` | 极光背景（base / ground / glows） |

语义色角色（`--c-*`）在每个 `data-palette` 作用域内重新声明，
因此面板里的文字自动切到反色板：

```css
[data-palette] {
  --c-text: var(--tone-text);
  --c-accent: var(--tone-gold);
  /* … */
}
```

---

## 4. 三套主题

主题只承载**风格规则**，不承载第二份颜色。渲染器注入 `data-theme` 时会校验
它与实际 `tone` 一致，不一致直接抛错（防止主题表与调色板漂移）。

| `data-theme` | 期望 tone | 说明 |
|---|---|---|
| `warm` | `warm_amber` | 暖色琥珀：奶油米 + 琥珀金 + 暖橙 + 珊瑚 |
| `blue` | `classic_blue` | 经典商务蓝：深宝蓝 → 经典金 |
| `fresh` | `fresh_green` | 清新绿（默认）：奶油底 + 有机浅绿块 + 亮黄 |

主题槽位（`main` / `plainLight` / `plainDeep`）的真源是 `src/lib/poster-themes.ts`，
海报配置用 `themeSlot` 指定档位，**不写死 tone**。

主题专属规则（`spec.css` §8）：

- 浅底（`data-bg="solid"` / `"organic"`）：标题**不加描边、不加发光阴影**；
- 浅底：关闭网格 / 粒子 / 光束 / 暗角；
- `fresh` 浅底：小字标签压深（`--c-accent-soft` 兜底 `#3E8E1F` / `#2A6E12` 三档）。

---

## 5. 背景模式

| `data-bg` | 组成 | 允许的装饰 |
|---|---|---|
| `none` | 透明（外部底图垫底） | — |
| `solid` | **单一平涂色** | **无**（纯色底铁律） |
| `gradient` | 底色渐变 + 网格 + 斜向光束 + 三团光晕 + 暗角 | 全套 |
| `organic` | 奶油底 + 中心柔光 + 边缘有机色块 + 圆点 | 禁网格 / 粒子 / 光束 / 暗角 |
| `aurora` | 近白底 + 三团极光柔光 + 底部渐变地台 | 极光 + 地台 |

背景层的**装饰开关**属于「不可改」项，LLM 不得增删。

---

## 6. 16 种 block 的 DOM 契约

`PosterBlock`（`src/lib/poster-renderer.ts`）共 16 种 kind，**一一对应，不允许 fallback**。

| kind | 根元素 | 子元素（class） | 关键实例变量 |
|---|---|---|---|
| `hero` | `.blk--hero` | `.hero__kicker`(`.hero__kicker-bar`) `.hero__title` `.hero__subtitle` `.hero__badges > .chip` | `--fs-hero-title`（自适应） |
| `title` | `.blk--title` | `.title__enlabel` `.title__eyebrow` `.title__main` `.title__subtitle` `.title__stats > .title__stat(.title__stat-value/.title__stat-label)` | `--fs-title-main`（自适应） |
| `section` | `.blk--section` | `.section__label` `.section__title` `.section__desc` | — |
| `cards` | `.blk--cards` | `.cards__list > .card(.card__tag/.card__title/.card__body)` | `--cols` |
| `timeline` | `.blk--timeline` | `.timeline__rail` `.timeline__list > .tl-item(.tl-item__node/.tl-item__time/.tl-item__title/.tl-item__body)` | — |
| `rows` | `.blk--rows` | `.rows__head(.rows__title/.rows__label)` `.rows__list > .row(.row__index/.row__main > .row__title/.row__body)` | — |
| `profile` | `.blk--profile` | `.profile__avatar` `.profile__main > .profile__name/.profile__role/.profile__bullets > .profile__bullet` | — |
| `note` | `.blk--note` | `.note__bar` `.note__text` | — |
| `footer` | `.blk--footer` | `.footer__main` `.footer__sub` | — |
| `centerTitle` | `.blk--centerTitle` | `.ct__kicker` `.ct__title` `.ct__subtitle` `.ct__note` | `--fs-ct-title`（自适应） |
| `features` | `.blk--features` | `.features__list > .feature(.feature__icon/.feature__title/.feature__desc)` | `--cols` |
| `grid` | `.blk--grid` | `.grid__list > .grid-item(.grid-item__title/.grid-item__desc)` | — |
| `panel` | `.blk--panel` | `.panel__inner`（内含子块） | `--width-ratio` `--min-height` |
| `qr` | `.blk--qr` | `.qr__frame > img.qr__img` `.qr__title` `.qr__caption` | `--qr-size` |
| `visual` | `.blk--visual` | `img.visual__img` `.visual__caption` | `--visual-w` |
| `spacer` | `.blk--spacer` | — | `--spacer-h`；`fill: true` 时加 `.is-fill` |

### 6.1 行数上限

SVG 侧用 `wrapText()` 的 `maxLines` 控制溢出。HTML 侧用 `-webkit-line-clamp`
（`.t-clamp`）——浏览器真实度量每行能装的字比估算多，因此同样上限下**不会截断更多内容**。

| 位置 | 上限 |
|---|---|
| `hero__title` | 3 |
| `title__main` | 3 |
| `section__title` / `section__desc` | 2 / 3 |
| `card__title` / `card__body` | 2 / 4 |
| `tl-item__body` | 4 |
| `note__text` | 4 |
| `ct__kicker` | 2 |

### 6.2 自适应字号

`title` / `centerTitle` / `hero` 的主标题按内容宽度自适应。
**自适应只能在 `spec.css` 规定的区间内取值**，渲染器算好后写 inline `--fs-*`：

| 元素 | 区间 |
|---|---|
| `title__main` | `[--fs-title-main-min, --fs-title-main-max]` = `[0.06W, 0.142W]` |
| `ct__title` | `[--fs-ct-title-min, --fs-ct-title-max]` = `[0.036W, 0.085W]` |
| `hero__title` | `[--fs-hero-title-min, --fs-hero-title-max]` = `[0.04W, 0.072W]` |

字号上限是「不可改」项；区间外的值一律拒绝。

---

## 7. 品牌位与角标

两者都按**成品像素坐标**钉在画布上，不随内容缩放（与 SVG 的 `brandSvg()` /
`cornerMarkSvg()` 一致）。

| 元素 | 位置 | 默认边距 | 尺寸 |
|---|---|---|---|
| `.poster__brand` | `top-right`（默认）/ `top-left` / `bottom-center` | `top 0.035W`、`right 0.055W` | Logo 高 `0.05W`、宽 `0.05W × 1.27`、文字 `0.028W`、字重 `heavy` |
| `.poster__mark` | `bottom-right`（默认）/ `bottom-left` | `0.016W` / `0.012W` | Logo 高 `0.03W`、文字 `0.02W`、字重 `strong` |

品牌位 `style: chip` 时用白底圆角卡片托底（`--brand-chip-h` 决定圆角），
`plain` 时不加底。商品图链路的品牌串规则（右上角统一「Logo + 品牌名」，
全称只允许出现在重要提醒页）由商品图链路的配置负责，不在本文件约束。

---

## 8. 字体与字重

字体真源 = `configs/poster-html/fonts.yaml`（family / TTC face / 真实字重 / 合成策略）。

| 语义档 | 变量 | family | 声明字重 | 浏览器实际 face |
|---|---|---|---|---|
| 正文 | `--w-body` | `Hiragino Sans GB` | 400 | W3 (300) |
| 中等 | `--w-medium` | `Hiragino Sans GB` | 500 | W3 (300) |
| 强调 | `--w-strong` | `Hiragino Sans GB` | 700 | W6 (600) |
| 重 | `--w-heavy` | `Hiragino Sans GB` | 800 | W6 (600) |
| 艺术标题 | `--w-art` | `YouSheBiaoTiHei` | 400 | native 400 |

> **与 SVG 管线的已知差异（有意为之）**：SVG 的字体链以 `PingFang SC` 开头，
> HTML 侧改为**锁定 family 优先**（`Hiragino Sans GB` / `YouSheBiaoTiHei`）。
> 理由：本机 PingFang 未命中，且渲染环境已锁定，必须保证同一配置在任何机器上落到同一 face。
> 该差异登记在 P2 报告的「已知偏差」中。

> **合成粗体**：YouShe 只有 400 一个 face，SVG 侧请求 800 由 librsvg 落到 400；
> 浏览器请求 800 会**合成加粗**。因此 HTML 的艺术标题统一锁 `--w-art: 400`。

---

## 9. LLM 可编辑边界（白名单）

| 允许 | 载体 | 例 |
|---|---|---|
| ① 文案 | YAML 配置的字符串字段 | `blocks[0].title` |
| ② 颜色变量 | CSS 自定义属性 | `--c-text`、`--c-accent`、`--theme-*` |
| ③ 间距变量 | CSS 自定义属性 | `--sp-card-gap`、`--sp-panel-pad`、`--block-gap` |

| 禁止 | 原因 |
|---|---|
| `--poster-w` / `--pad-*` / `--fs-*` / `--r-*` | 几何与字号上限的唯一真源，LLM 改了就无法做像素级回归 |
| `--font-*` / `--w-*` / `--lh-*` | 字体与字重策略由 `fonts.yaml` 锁定 |
| `--tone-*` | 运行时由 `PALETTES` 注入，改了会出现第二份颜色真源 |
| `data-bg` 取值、背景装饰开关 | 纯色底铁律；装饰层不可增删 |
| DOM 层级与元素数量 | 结构由 block 契约固定，合规扫描依赖它 |
| `data-palette` / `data-theme` | 由 tone 推导，改了会与调色板不一致 |

允许修改的颜色变量只限 `--c-*` 与 `--theme-*`；`--c-*` 的底层仍是 `--tone-*`，
所以「改颜色」的正确做法是**改调色板配置**（`PALETTES`），不是改 CSS。

---

## 10. 新增 / 修改一个 block 的步骤

1. 在 `src/lib/poster-renderer.ts` 的 `PosterBlock` union 里加 kind 与字段；
2. 在 `src/lib/poster-renderer.ts` 的 `renderBlock()` 分派里加分支（SVG 对照件保持可渲染）；
3. 在 `configs/poster-html/spec.css` 里加 `.blk--{kind}` 样式，只用既有令牌
   （字号用 `--fs-*`、间距用 `--sp-*`、颜色用 `--c-*`），**不写死 px**；
4. 在本文件 §6 的表里补一行 DOM 契约；
5. 在 `scripts/lib/poster-html-blocks.ts` 里加映射函数，**不允许 fallback 分支**
   （未覆盖的 kind 必须抛错，不能悄悄降级成通用文本块）；
6. 跑 `bun run scripts/poster-diff.ts` 看断行与像素差，登记新的已知偏差。

---

## 11. 验收要点（P2）

| 项 | 指标 | 工具 |
|---|---|---|
| 断行一致 | `live-cover` / `promo-blue` 各 ≤ 2 处差异，且登记为已知项 | `scripts/poster-diff.ts` |
| 二维码 | 黑模块跨度差 ≤ 1 px，模块边长为整数 | `scripts/poster-diff.ts` |
| 合规 | HTML 可见文本命中 V8 规则时 `exit 1`；`promo-blue` 报 0 命中 | `scripts/check-poster-html-compliance.ts` |
| 确定性 | 同一 HTML 多次渲染 PNG 的 SHA-256 完全一致 | `scripts/check-render-determinism.ts` |
| 环境 | 静态 + 浏览器实测全过 | `scripts/check-render-env.ts --probe` |

**特别注意**：`configs/poster/promo-blue.yaml` 里的二维码仍是占位内容
`https://REPLACE-ME/agent-course`，正式上架前必须替换为真实落地页地址并重新出图。
