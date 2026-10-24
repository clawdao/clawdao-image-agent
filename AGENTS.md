# ClawDao 图像工厂

AI 驱动的直播间视觉素材生成器。

技术栈：React 18 + Vite + TypeScript + Tailwind + Ant Design 5（前端） / Bun + 原生 fetch（后端）
多模态：ClawDao 网关 → MiniMax-M3（Anthropic 兼容端点 https://api.minimaxi.com/anthropic）
图像生成：MiniMax image-01（API 端点 https://api.minimaxi.com/v1/image_generation）
任务队列：内存 Map（MVP；未来可平滑替换为 Bull/Redis）
数据库：SQLite（bun:sqlite 零依赖，默认 outputs/clawdao.db）→ PostgreSQL（生产规划）
端口：后端 18795 / 前端 5182（由 .clawdao/project.json 配置）

> 历史 egg.js / server-egg-legacy 方案已在 .archive/ 归档，Bun 单进程是当前主线。

---

## 平台合规规范（视频号小店 / 视频号、抖音尚品）— 必读

适用于本仓库所有「小店商品图 + 商品详情文案」类产出（`outputs/shop-listing*`）。
当前交付版为 **V8**（`outputs/shop-listing-v8/`），历史版 V1/V2/V3/V4/V7 仅保留作审核前后对照。

### 1. 类目红线

两个平台的「教育培训」类目都**暂不开放售卖教授使用 AI 开展商业活动或营利的课程**，例如：
使用 AI 创业 / 提升营业额 / 开展副业 / 赚钱 / 获客 / 变现 / 涨粉 / 带货等。

允许的是**纯技术类**：AI 工具操作、技术原理、提示词、代码开发、模型与系统搭建。

因此本项目所有对外产出必须满足：

| 允许（技术口径） | 禁止（商业/营利口径） |
| --- | --- |
| 工具安装配置、参数调试 | 赚钱 / 变现 / 副业 / 增收 / 接单 |
| 提示词结构、需求模板 | 获客 / 引流 / 爆单 / 月入 / 躺赚 |
| 系统搭建、流程编排、自动化 | 涨粉 / 打赏 / 带货 / 付费转化 |
| 复盘方法、验收标准、清单 | 返佣 / 佣金 / 分销 / 招商 / 加盟 / 私域 |

> **具体条款编号、判定口径以视频号小店与抖音尚品后台最新规则为准，上架前必须人工核对一次。**
> 本仓库只沉淀通用规则与本项目被驳回的真实经验，不臆造条款号或链接。

### 1.1 语义红线（机审是语义分类，不是关键词命中）— V7 驳回教训

V7《AI数智化系统自我进化实战营》被平台机审直接判为 **【AI盈利课程】**，理由：
「涉及【AI盈利课程】，平台暂未开放售卖……请仔细检查课程是否涉及教授使用AI开展商业活动或营利等内容」。

关键教训：**它一个禁用词都没命中**，纯粹是「AI 数智化 + 系统 + 自我进化 + 实战营」这组词
读起来像一个「企业自动运转、自己生钱的东西」，机审按语义归到了营利课程。
**允许清单 ≠ 机审会放行**——只要整体读起来像商业闭环，命中的是分类器，不是词典。

因此 V8 把三个词根**连根拔掉**，并在检查器里加了断言，防止后续改动写回来：

| 词根 | V7 对外出现次数 | V8 口径（0 次） | 替换说法 |
| --- | --- | --- | --- |
| 系统 | 59 | 0 | 流程 / 机制 / 工具链 / 配置 / 组织协作 |
| 自我进化 | 29 | 0 | 持续优化 / 反馈—调整—再验证 |
| 数智化 | 27 | 0 | AI 原生 / 数字化工具 |

配套的语义换轨：
- 标题主语从「系统」换成「**组织**」，「自我进化」换成「**实训营**」。
- 案例从「公众号运营自动化系统」换成「**公众号内容生产流程**」（去「运营」去「系统」）。
- 受众从「创业者 / 实体老板 / 自媒体」换成**组织内角色**（企业高管 / 中小企业负责人 /
  小团队负责人 / 内容策划岗），去掉「一个人干一支团队的活」这类省钱增效暗示。
- 品牌背景里的**商业成绩数字**（300+ 家 / 72%↓ / 92%）也要删——数字型商业成绩同样会被读成效果承诺。
- 否定句、类目建议、内部备注里的「赚钱/变现/副业」等词也不要在对外文案出现；
  内部备注若要粘贴进详情页必须整段删除（见 `商品文案.md` 末尾的 HTML 注释分界）。

### 2. 写文案/出图时的硬性禁令

- **不写死售价**：图片与文案均不出现具体价格，售价以后台设置为准。
- **不做效果承诺**：不出现「回本」「多久见效」「保证」「一定」等承诺性表述；只讲工具怎么用、系统怎么搭、步骤怎么验收。
- **不出现 `ddn.net`**（旧域名已下线）。
- **主题词「工作流」在 V4/V8 公开内容中出现 0 次**（平台反馈该表述已过时）；「流程」「全流程」「公众号内容生产流程」属于允许的技术表达，**可以保留**。
- **「公众号」不是禁词**，但公众号案例的语汇必须锁定在技术流程（选题—写作—作图—排版—发布），不得出现涨粉、变现、引粉等运营类词。
- **语义红线词根**（V8 起对外文案与海报中 0 次）：`系统`、`自我进化`、`数智化`。检查器 `v8` 会硬断言，命中即 `exit 1`。
- **交付口径必须与实际一致（r7 新增，事实性陈述风险）**：本课程真实交付是 **10+ 节实操课 + 作业模板 + 直播答疑 + 班级群交流**，**从来没有 3 天连播**。对外内容（商品字段 / 海报 / 详情页）中「连播」「三天」「3 天」必须 **0 次**——这与用词违规不同，是**与实际交付不符的虚假宣传**，平台一旦核对即可能驳回。检查器 `v8` 已加硬断言。
- **改交付口径不要做词语替换**：旧文案里的「3 天连播」不是换个词就行——它连带着「D1/D2/D3 三天安排」「每天一个主题连播」「数值卡 3天/连播实操」「FAQ 3 天怎么安排」整条结构。改法是**把整条口径重写**（模块结构取代天数结构），再逐段读一遍是否读起来就是真的。
- **否定句里也尽量不写敏感词**（例如不写「不承诺赚钱」），避免机器审核按关键词误命中。
- **图与文案同源**：所有标题、卡片、FAQ、交付形式共用同一份内容常量（**`configs/shop-listing/<版本>.yaml` 的 `content` 段**），海报 blocks 与商品文案都引用它（`{{content.modules.M1.title}}` 这类引用），改一处两处同步，禁止在图上写一套、在详情页写另一套。

### 3. 商品字段与类目

- 商品属性：`虚拟商品 · 数字课程（技术实战）`
- 类目建议：**人工智能 / 软件技术 / IT 技能**等纯技术方向；**不要**选副业、创业、营销、电商等盈利导向类目。
- 品牌位：右上角统一「Logo + 亿检链」；完整品牌串「利姆斯科技 · 亿检链团队」只允许出现在重要提醒页（`main-4-notice.png`）。

### 4. 上架前必检

```bash
export PATH="$HOME/.bun/bin:$PATH"
bun run scripts/check-listing-compliance.ts        # 默认检查当前交付版 v8
bun run scripts/check-listing-compliance.ts v3     # 历史版回归
bun run scripts/check-listing-compliance.ts v4     # 历史版回归
bun run scripts/check-listing-compliance.ts v7     # 历史版回归（已被驳回，仅供对照）
bun run scripts/check-listing-compliance.ts v2     # 反面样本：V2 含盈利导向表述，预期 exit 1
```

检查器（`scripts/check-listing-compliance.ts`）覆盖：

> **关于 v7 为什么仍然 exit 0**：v7 版的**词库**自查确实全部通过 —— 它一个禁用词都没命中，
> 平台是按**语义**（「数智化 + 系统 + 自我进化 + 实战营」这组词读起来像商业闭环）判的。
> 也就是说：**检查器绿灯 ≠ 能上架**，V8 的语义红线词根（系统 / 自我进化 / 数智化）是专门为这件事加的。

商品字段 → 全部海报可见文本 → 对外展示部分的商品文案；命中即 `exit 1`。
商品字段 → 全部海报可见文本 → 对外展示部分的商品文案；命中即 `exit 1`。

**规则全部外置在 `configs/compliance/<版本>.yaml`**（基线 `configs/compliance/_base.yaml`，
版本配置用 `extends` 继承后只写差异项），检查器本身不含任何版本分支：

| 规则段 | 作用 |
| --- | --- |
| `forbidden` | 词库五类：直接禁用词 / 间接话术 / 关联高危词 / 英文高危词 / 平台高危词；V8 另加 `platformBinding` / `businessHint` / `promise` |
| `themeForbidden` | 「工作流」等主题词，对外 0 次 |
| `semanticForbidden` | **V8 语义红线（系统 / 自我进化 / 数智化 = 0 次）** |
| `acronymForbidden` | 英文缩写等正则断言（`\bAI\b`） |
| `staleDelivery` | 旧交付节奏（连播 / 三天 / `3\s*天`）断言 |
| `assertions.brandSlot` | 品牌位：右上角统一 Logo + 品牌名，全称只允许出现在 `main-4-notice` |
| `assertions.title` | 标题结构：商品名 = 主标题单段、封面槽位 = 修饰词、页脚一致、交付口径含「实操课 / 直播答疑」 |
| `positiveHints` | 正向词覆盖提示（不阻断） |

另有一项固定断言：**图文同源一致性**（对外文案必须包含 content 段的模块标题 / FAQ /
目标客户 / 作者资历），由检查器直接读配置校验。

> 词典能拦住的只是「用词」，拦不住「语义」。**每次新增对外文案后，除了跑检查器，
> 还要自己念一遍：整段话读起来像不像一个「帮企业自动生钱的东西」？像就重写。**

### 5. 纯色底图规则（礼物 / 推荐位）

视频号小店在「送礼 / 推荐」等场景需要**纯色底图**。

- 平台的 AI 编辑工具会把深底海报抠成「主体 + 白底」，白字消失、字变虚影 → **不可用**。
- 只能用**本地 SVG 重排 + 平涂背景**（`background: 'solid'`），真正不透明平涂。
- 禁止：透明 PNG、渐变、网格、粒子、光束、光晕、暗角、噪点。
- 浅底必须从源头改用深色文字，不能沿用深底海报的白字。
- 元素必须与 `main-0-title.png` 保持一致，并做**像素采样**验证背景唯一色，再看缩小到礼物/推荐卡后的可读性。

---

## 配色方案（三套主题，生成时可选）

主题注册表在 `src/lib/poster-themes.ts`，海报内容用 `themeSlot` 指定档位（`main` / `plainLight` / `plainDeep`），不写死 tone。

| 主题 id | 名称 | 视觉 | 浅底纯色 | 深底纯色 |
| --- | --- | --- | --- | --- |
| `warm` | 暖色琥珀 | 奶油米 `#FFF9F0` + 琥珀金 `#F5A623` + 暖橙 `#F08A24` + 珊瑚 `#FF6B5C` | 暖白 | 深棕 `#4A2C10` |
| `blue` | 经典商务蓝 | 深宝蓝 `#123A86`→`#0A2455`→`#050F28` + 经典金 `#E8B24C` | 纯白 | 深宝蓝 `#123A86` |
| `fresh` | 清新绿（默认） | 奶油底 `#FDFCF0` + 有机浅绿块 `#CDE9A8` + 亮黄 `#FFC93C` + 草绿标题 `#5CB02F` | 纯白 | 纯绿 `#1F6B45` |

```bash
bun run scripts/gen-shop-listing.ts v8 --theme fresh    # 默认就是 fresh
bun run scripts/gen-shop-listing.ts v8 --theme blue
bun run scripts/gen-shop-listing.ts v8 --theme warm

# 换输出目录，避免覆盖当前交付版
bun run scripts/gen-shop-listing.ts v8 --theme blue --out ./outputs/shop-listing-v8-blue

# 列出所有可用配置
bun run scripts/gen-shop-listing.ts --list
```

换主题时 `main-5-plain-light` / `main-6-plain-deep` 会自动换成对应方案的浅底 / 深底纯色平涂图（文件名与主题解耦）。

### 浅底配色铁律（清新绿）

- 草绿 `#5CB02F` 对奶油底只有约 **2.67:1**，只能用于**标题与装饰**；小字标签一律压深到 `#3E8E1F` / `#357C18` / `#2A6E12`。
- 浅底标题**不加描边、不加发光阴影**（否则出现「脏点」）。
- 浅底主题关闭网格 / 粒子 / 光束 / 暗角。
- 有机 blob 路径用**固定种子**（`mulberry32(20260318)`）确定性生成，保证重复渲染一致。
- 有机背景装饰只落在画布外圈（顶部约 30–40% 保持奶油底、主体落在边缘/底部），中心阅读区保持干净；长图（高宽比 > 1.4）只在首尾两端放色块，中段彻底留白。

### 排版实测约束（W=1080）

- `renderTitle` 的 stats 标签为单行不换行（`labelSize = W*0.0215`）。
- `renderCards`（`columns=3`）：标题 ≤ 约 7 个汉字、正文约 9 个汉字/行；标题最多折 2 行、每条正文最多折 4 行，卡片等高。
- `renderNote`：字号 `W*0.025`，可用宽度 `contentW - W*0.06`，约 32 个汉字/行、最多 4 行。
- `wrapText()` 的 `maxLines` 是整段文本总上限，显式 `\n` 各段共享该上限。

---

## 配置驱动架构（r8 起）

**一份脚本 + N 份配置**。新增一个商品图版本 / 一种视觉素材，都不再写脚本。

### 目录结构

```
configs/
  shop-listing/          商品图配置（内容 + 海报 + 详情页文案）
    v2.yaml v3.yaml v4.yaml v7.yaml v8.yaml
  compliance/            合规规则（词库 + 断言）
    _base.yaml           基线：五类词库 + 通用断言（版本用 extends 继承）
    v2.yaml v3.yaml v4.yaml v7.yaml v8.yaml
  assets/                其它视觉素材（广告条 / IP 母版 / 抠图）
    top-banner.yaml center-banner.yaml brand-lobster.yaml brand-cutout.yaml

scripts/
  gen-shop-listing.ts    **商品图统一入口**（--config / 版本 id / --theme / --out）
  check-listing-compliance.ts  **合规检查统一入口**（规则来自 configs/compliance/）
  gen-asset.ts           **其它素材统一入口**（--config / --title / --count / --tone）
  shop-listing-render.ts 共享渲染流水线（商品图）
  lib/
    config.ts            JSON/YAML 加载 + `{{path}}` 变量引用解析
    listing-config.ts    商品图配置模型 + 校验
    listing-content.ts   配置 → 海报 blocks + 商品详情文案
    compliance.ts        合规规则模型 + extends 继承
```

### 两个统一入口

```bash
# 商品图
bun run scripts/gen-shop-listing.ts --list                 # 列出所有配置
bun run scripts/gen-shop-listing.ts v8                     # 按 id 出图
bun run scripts/gen-shop-listing.ts --config configs/shop-listing/v8.yaml
bun run scripts/gen-shop-listing.ts v8 --theme blue --out ./outputs/shop-listing-v8-blue

# 合规检查
bun run scripts/check-listing-compliance.ts v8

# 其它素材
bun run scripts/gen-asset.ts --list
bun run scripts/gen-asset.ts top-banner --title "新标题" --subtitle "副标题" --count 3
bun run scripts/gen-asset.ts brand-lobster --count 2
```

### 变量引用语法（图与文案同源的实现）

配置里所有文本都可写 `{{路径}}`，解析时替换成实际内容：

| 写法 | 含义 |
| --- | --- |
| `{{vars.titleMain}}` | 顶层 `vars` 段 |
| `{{product.name}}` | 商品字段 |
| `{{author.bullets}}` | 讲师资历数组（整段替换） |
| `{{content.modules.M1.title}}` | 按 label 查数组（等价于 `{{content.modules.0.title}}`） |
| `{{content.audience}}` | 整段数组替换（海报卡片 / 目标客户） |

- **整串就是一个引用** → 替换成原值（可以是对象 / 数组）
- **字符串里内嵌引用** → 做字符串插值

因此「模块标题」只存在于 `content.modules` 一处，海报卡片与详情页都引用它。

### 商品详情页文案排版指令（`copy.blocks`）

| type | 作用 |
| --- | --- |
| `heading` | 标题（level 1~4） |
| `text` / `list` / `ordered` / `table` / `quote` / `hr` | 正文 / 列表 / 表格 / 引用 / 分隔线 |
| `fields` | 商品字段清单（从 `product` 渲染） |
| `moduleOverview` | 模块概览（label｜title + summary） |
| `modules` | 模块详解（label｜title + lines） |
| `faq` | FAQ 问答 |
| `targetTable` | 目标客户「你能带走什么」表 |
| `author` | 讲师署名 + 资历清单 |
| `raw` | 原样 markdown（逃生舱） |

### 新增一个商品图版本

1. 复制一份 `configs/shop-listing/v8.yaml` 改内容，改 `id` / `outputDir` / `label`
2. 复制一份 `configs/compliance/v8.yaml` 改规则差异（`extends` 基线），改 `id`
3. `bun run scripts/gen-shop-listing.ts <新id>` 出图
4. `bun run scripts/check-listing-compliance.ts <新id>` 自查

---

## 通用海报出图链路（HTML 阶段 0 + 阶段 1 已完成，2026-10-24）

**正式出图链路仍然是 YAML → SVG → sharp → PNG**（`bun run scripts/gen-poster.ts <id>`）。
HTML 链路目前是**并行验证件**，尚未接管正式出口；两者同时保留，便于做像素级 diff。

> 完整开发计划见 `docs/v0/v0.1/01-html-poster-pipeline.md`（P0 ~ P5 + 横切项）。
> 当前进度：**P0 ✅ / P1 ✅（T1~T4 全绿）/ P2 仅 T1 完成**。

### 为什么要做

评估「把海报真源从自研 SVG 排版器换成 HTML + CSS」的可行性。核心动机有三个：

1. **字宽估算不准**：SVG 侧用 `textUnits()` 估算字宽（汉字 1.0 / 数字 0.62 / 其它 0.52），
   与浏览器真实字体度量有偏差；
2. **中文避头尾缺失**：估算式折行会把「、」甩到行首（违反 UAX #14），浏览器不会；
3. **两套渲染器并存**：出图（SVG）与编辑预览（Fabric/CoreText）度量不同，同一张图两个样子。

### 阶段 0 结论（`promo-blue` 800×2000 实测）

| 项 | 结果 |
| --- | --- |
| HTML 出图 | 可用；headless shell 单张 **281 ms**（含冷启动），复用常驻浏览器可再降 |
| 文本块比对 | 17 个文本块，行数全部一致；**3 处断行位置不同**（都是 SVG 的行首标点问题） |
| 合成用例 | 6 条中 5 条逐行一致；长链接断点不同（SVG 断 `?ref`/`=shop`，浏览器断 `?`/`ref=shop`） |
| 像素差 | 灰阶 >8 占 5.89%，>64 占 3.83%；差异集中在网格区竖向偏移与字体抗锯齿 |
| 二维码 | 两版**像素级一致**（黑模块跨度 375 vs 376 px） |
| 合规闭环 | 直接扫 HTML 渲染后的 DOM 可见文本 → v8 规则 **0 命中** |

### 阶段 1 结论（渲染环境固化，2026-10-24）

| 项 | 结果 |
| --- | --- |
| 渲染环境锁 | `configs/poster-html/render-env.lock.yaml`：Chromium 1248 / Playwright 1.64.1 / DSF 1 / zh-CN / Asia-Shanghai |
| 字体锁 | `configs/poster-html/fonts.yaml`：12 档字重逐档登记 `resolved` / `nearest` / `synthesized`，**无静默回退** |
| 确定性 | 同配置连跑 5 次，PNG sha256 **完全一致**（`ae190049…`） |
| 常驻浏览器 | 冷启动 1 次（实测 427~1335 ms，受系统缓存影响）；批内稳态 **77~88 ms/张**，10 张合计 ≈ 1.0 s（若每张都冷启动需 ≈ 4.4 s，省 77%）|

> 本机实测注记：**PingFang SC 未安装**，旧 SVG 字栈第一项是空转；Hiragino Sans GB 只装了 W3/W6 两档。
> 所以 HTML 侧标题体用优设标题黑（仅 400）、正文用 Hiragino Sans GB。

### 用法

```bash
export PATH="$HOME/.bun/bin:$PATH"

# 阶段 0 对照探针（断行比对 + 像素差 + 合规闭环）
bun run scripts/html-poster-probe.ts promo-blue      # 也可 bun run poster:probe

# 阶段 1 三件套（环境体检 / 确定性 / 性能基准）
bun run scripts/check-render-env.ts --probe           # 也可 bun run render:env
bun run scripts/check-render-determinism.ts           # 也可 bun run render:determinism
bun run scripts/check-render-bench.ts                 # 也可 bun run render:bench
```

产物在 `outputs/_tmp/html-probe/`（探针）与 `outputs/_tmp/determinism/`、`outputs/_tmp/bench/`（阶段 1）。

### 关键文件

| 文件 | 作用 |
| --- | --- |
| `scripts/lib/html-render.ts` | Playwright 渲染封装：常驻浏览器池、**context 复用**、字体就绪、基线对齐脚本 |
| `scripts/lib/render-env.ts` | 环境锁 / 字体锁的加载与启动参数 |
| `scripts/lib/font-probe.ts` | 像素级字体命中探针（判定 family / 字重是否真命中） |
| `scripts/html-poster-probe.ts` | 阶段 0 对照探针：出图 + 断行比对 + 像素差 + 合规闭环 |
| `scripts/check-render-env.ts` | 阶段 1：环境 + 字体锁体检（命中项逐档核对） |
| `scripts/check-render-determinism.ts` | 阶段 1：同配置 5 连跑 sha256 一致性 |
| `scripts/check-render-bench.ts` | 阶段 1：常驻浏览器冷/热态性能基准（P1-T3 验收） |
| `configs/poster-html/render-env.lock.yaml` | 渲染环境锁（浏览器 / 上下文参数） |
| `configs/poster-html/fonts.yaml` | 字体锁（family + 每档字重的实际命中） |
| `configs/poster-html/spec.css` | 视觉规范：几何 / 颜色 / 间距令牌（P2-T1） |
| `configs/poster-html/schema.md` | DOM 契约：16 种 block 的结构与变量边界（P2-T1） |
| `configs/poster-html/probe-promo-blue.html` | 手写复刻模板（**不是**通用 block 映射器） |
| `scripts/_scratch/` | 开发期一次性分析脚本归档区（不参与正式链路） |

### 正式化前必须解决（现状）

- ✅ **锁定渲染环境** —— 已锁（`render-env.lock.yaml` + `fonts.yaml`），5 连跑产物一致。
- ✅ **常驻浏览器** —— 已落地（浏览器 + context 复用），稳态 77~88 ms/张。
- ⬜ **block → HTML 映射器**（P2-T2）—— 要把 `configs/poster/*.yaml` 的 16 种 block 映射成 HTML 模板，
  保留 SVG 管线并行输出做 diff；当前 `probe-promo-blue.html` 是手写复刻，只验证了渲染能力。
- ✅ **受约束的 `poster-spec.css`** —— 已落地（`spec.css` + `schema.md`），LLM 只允许改文案、
  颜色变量和间距，不允许生成任意 DOM。
- ⬜ **合规检查器扫 HTML 可见文本**（P2-T7）—— 阶段 0 已验证可行，尚未做成常驻检查器。
- ⬜ **D 导出合规闸门**（P3-T5）—— 当前 D 海报工作室的 Fabric 导出**不过** v8 检查，是真实缺口。

---

## 商品图产出目录

| 版本 | 目录 | 状态 |
| --- | --- | --- |
| V1 | `outputs/shop-listing/` | 历史版（含价格等违规项） |
| V2 | `outputs/shop-listing-v2/` | 历史版（含盈利导向表述） |
| V3 | `outputs/shop-listing-v3/` | 历史合规版（琥珀暖色） |
| V4 | `outputs/shop-listing-v4/` | 历史合规版（经典商务蓝） |
| V7 | `outputs/shop-listing-v7/` | 历史版（清新绿）——**被平台判【AI盈利课程】，勿再上架** |
| V8 | `outputs/shop-listing-v8/` | **当前交付版**（清新绿）——「亿检智能体零基础实操训练营」（r8） |

每个版本目录包含：方图（严格 1080×1080）+ 长图（宽 1080，高度随内容自然增长）+ `商品文案.md`（对外文案与内部运营备注用 HTML 注释分隔）。

> **V8 r8（2026-10-21）**：**架构重构——从「一版一脚本」改为「一份脚本 + N 份配置」。**
> - 旧结构：`gen-shop-listing-v3/v4/v7/v8.ts` + `shop-listing-content-v3/v4/v7/v8.ts`，
>   加一个版本要加两个脚本；渲染流水线被复制 5 遍各自漂移；合规检查器里全是
>   `if (VERSION === 'v8')` 硬编码分支。
> - 新结构：
>   - `configs/shop-listing/<版本>.yaml` —— 内容常量（商品字段 / 模块 / 受众 / FAQ /
>     海报 blocks / 详情页文案排版指令）全部变成配置；海报与文案用 `{{...}}` 引用同源。
>   - `configs/compliance/<版本>.yaml` —— 词库与断言全部外置成数据，`extends` 继承基线；
>     检查器不再含任何版本分支。
>   - `configs/assets/*.yaml` —— 顶部广告条 / 居中 banner / IP 母版 / 抠图统一到
>     `scripts/gen-asset.ts`（`pipeline: banner | ip-master | cutout | preview`）。
>   - 两个统一入口：`scripts/gen-shop-listing.ts` 与 `scripts/check-listing-compliance.ts`。
> - **迁移零风险（逐字节验证）**：重构前后比对，海报 PNG 的 sha256 与商品详情文案
>   **v2 7 张 / v3 7 张 / v4 9 张 / v7 10 张 / v8 10 张全部一致**，文案也逐字节一致
>   （v8 仅内部运营备注里 2 条命令引用更新为新入口）。
> - 旧脚本归档至 `.archive/scripts-legacy-20261021/`（不参与构建）。
> - **本轮没有改动任何对外文案口径**：交付口径仍是 r7 的「10+ 节实操课 + 直播答疑」。

> **V8 r7（2026-10-21）**：**删除全部「3 天连播」表述——这是事实性错误陈述。**
> - 课程真实交付是 **10+ 节实操课 + 作业模板 + 直播答疑 + 班级群交流**，从来没有 3 天连播；
>   旧文案（商品字段 / 10 张海报 / 详情页）里的「3 天连播 / 3 天 / D1-D2-D3 / 每天一个主题
>   连播」属于**与实际交付不符的虚假宣传**风险，比用词违规更严重。
> - **不是词语替换，是整条交付口径重写**：
>   - 商品字段：交付形式 → 「10+ 节实操课 + 作业模板 + 直播答疑 + 班级群交流」；课程定位同步。
>   - 方图 2：从「三天安排（D1/D2/D3）」→ **课程安排（五个模块）**；行数据由 `DAY_PLAN`
>     换成从 `MODULE_CARDS` 派生的 `MODULE_OVERVIEW`（图文同源）。
>   - 详情页：原「3 天安排」一节 → **实操课安排**；「3 天」那句解释语直接删（它解释的是一个
>     不存在的交付形式）；课程性质说明 / 一句话说明 / 课程简介 / 上课流程 / FAQ 全改。
>   - 封面数值卡：3天 / 连播实操 → **10+ / 节实操课**；徽章「3天连播」→「**直播答疑**」。
> - 检查器新增 **旧交付节奏断言**：对外内容（商品字段 + 海报 + 对外文案）中
>   「连播」「三天」「3 天」**0 次**（命中即 `exit 1`）；交付形式必须含「实操课」与
>   「直播答疑」，对外文案必须出现「直播答疑」与「10+」。以后想改回连播口径会被直接拦下。
> - 上一版交付物已归档至 `outputs/_archive/shop-listing-v8-r6-20261021/`。
>
> **V8 r6（2026-10-21）**：商品标题改为「亿检智能体零基础实操训练营」，并**全面去掉英文缩写「AI」**。
> - **商品名 = 主标题常量单段**；4 张封面（main-0 / main-1 / main-5 / main-6）的主标题
>   上下两行：「亿检智能体」/「零基础实操训练营」（去空白后 == 商品名称）。
> - **「零基础」从副标题升进主标题**：它是这门课的门槛词，放进商品名等于直接告诉机审
>   「面向零基础学习者」；副标题因此改为「从下载安装到跑通第一个智能体」，不再重复。
> - **对外内容的英文缩写「AI」全部去掉**（海报 + 对外文案 + 商品属性）：
>   英文小标 `AI AGENT HANDS-ON CAMP` → `YIJIAN AGENT HANDS-ON CAMP`；
>   封面副标题、长图 detail-2 的「要不要用 AI」、文案里的「零基础 AI 智能体实操课」
>   「配套 AI 辅助…」「依托 AI 与数据能力」、目标客户表里的「借助AI工具 / 可引入AI工具 /
>   对 AI 工具感兴趣 / 对AI智能体工具」全部换口径；商品属性改为
>   「虚拟商品 · 数字课程（智能体工具技术实战）」。
> - **中文「人工智能培训」保留**：它是类目方向词（人工智能 / IT 技能），也是机审识别
>   「技术培训」类目的关键信号，删了等于自断类目归属。它继续放在 4 张封面的主标题上方
>   （eyebrow / kicker）与详情页「课程性质说明」里。
> - 检查器新增 **英文缩写断言**：`/\bAI\b/`（词边界，不会误伤 TRAINING / DETAIL）在商品字段 +
>   海报文本 + 对外文案中 0 次，命中即 `exit 1`。
> - 上一版交付物已归档至 `outputs/_archive/shop-listing-v8-r5-20261021/`。
>
> **V8 r5（2026-10-21）**：商品标题改为**单段**「亿检智能体小白实操训练营」。
> - **商品名 = 主标题常量单段**（不再用「|」分段）；4 张封面（main-0 / main-1 / main-5 / main-6）
>   的主标题按用户要求**上下两行**排：「亿检智能体」/「小白实操训练营」（去空白后 == 商品名称）。
> - **「亿检」与品牌位「亿检链」同源**，品牌识别度比 r4 的「AI智能体」更高。
> - **修饰词「人工智能培训」保留在海报主标题上方，但不再进商品名**：它仍是类目方向词
>   （人工智能 / IT 技能），也给机审一个明确的「技术培训」语义信号；同时补进详情页
>   「课程性质说明」（写作「人工智能培训方向的技术实操课程」），保证
>   **商品名 + 首图 + 详情页**三处都带类目信号。
> - **主标题仍不带「3天」**：3 天是交付节奏，写在交付形式 / 数值卡 / 文案里。
>   上一版交付物已归档至 `outputs/_archive/shop-listing-v8-r4-20261021/`。
> - 检查器标题断言同步改版：名称必须严格等于主标题常量、**不得再带「|」分段**、
>   名称内不许出现「3天」、封面主标题上方槽位必须仍是修饰词、对外文案必须同时出现
>   主标题与修饰词、页脚必须与商品名称一致；旧标题进 `STALE_TITLES` 防止漏改。
>
> **V8 r4（2026-10-21）**：商品标题改为**两段式**「人工智能培训 | AI智能体小白实操训练营」。
> - **修饰词「人工智能培训」**放在海报主标题上方（4 张封面：main-0 / main-1 / main-5 / main-6），
>   既是类目方向词（人工智能 / IT 技能），也给平台机审一个明确的「技术培训」语义信号。
> - **主标题「AI智能体小白实操训练营」**主语是工具，无 系统 / 自我进化 / 数智化。
> - **主标题不带「3天」**：3 天是交付节奏（连播天数），写在交付形式 / 数值卡 / 文案里；
>   短周期进商品名容易被读成「速成」承诺（V3/V4 是同样做法）。上一版交付物已归档至
>   `outputs/_archive/shop-listing-v8-r3-20261021/`。
> - 检查器新增 **标题结构断言**：名称必须严格等于「修饰 | 主标题」、名称内不许出现
>   「3天」等短周期、封面主标题上方槽位必须就是修饰词、页脚必须与商品名称一致。
>
> **V8 r3（2026-10-21）**：标题改为「亿检智能体小白实操3天训练营」；删除「流程搭建示例」
> （M4 相应改为「工具串接与流程编排」）；全量内容改写为「3 天连播 + 零基础」口径。
> 上一版交付物已归档至 `outputs/_archive/shop-listing-v8-r2-20261021/`。
> 新增「3 天」交付节奏后，检查器追加了 **承诺类词库**（速成 / 见效 / 包学会 / 立刻上手…）。

