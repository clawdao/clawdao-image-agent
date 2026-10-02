# ClawDao 图像工厂 v0.1 开发文档

> 启动时间：2025-09-05
> 目标用户：imfly（ClawDao 创始人）
> 核心目标：让 ClawDao 直播间视觉素材（封面/广告条/Banner/福利弹窗）从"手工设计"升级为"AI 一键生成"。

---

## 1. 产品定位

**ClawDao 图像工厂** 是一个 Web 应用，输入 1~N 张参考图 + 直播间素材需求，AI 自动理解 ClawDao 品牌调性后，调用图像生成模型批量产出同风格、同品牌、可直接用于直播间的视觉素材。

### 1.1 核心场景

\`\`\`
用户上传 4 张参考图（直播封面/广告条/Banner/福利弹窗）
     ↓
选择"应用类别"（直播间封面/广告条/福利弹窗...）
     ↓
输入主题文案 + 用户上下文（自动注入 ClawDao 知识）
     ↓
AI Agent：分析参考图视觉 DNA + 组装提示词 + 调用图像模型
     ↓
输出：4 张同风格、套品牌 IP 的新素材
\`\`\`

### 1.2 4 张参考图归纳的设计语言

| 类别 | 比例 | 视觉 DNA |
|------|------|----------|
| 直播间封面 | 9:16 (1080×1920) | 蓝紫渐变底 + 居中留白主标题 + 卡通龙虾 IP 站电脑 + 3D 渲染未来感 |
| 顶部广告条 | 21:9 (1920×320) | 暗灰磨砂 + 金色书法字 + 多余留白放文案 |
| 中间广告条 | 16:5 (1920×600) | 黑底+金底光晕 + 大标题带下划线 + 4 个细分场景标签 |
| 福利弹窗 | 1:1 (1024×1024) | 黑金边框 + 3 张加赠卡片 + 礼盒图标 + 金色"福利一"角标 |

### 1.3 通用调性

- 色板：蓝紫（#667eea → #764ba2）+ 黑金（#FFD700 → #B8860B）
- 字体：金色书法体（主标题）+ 白色无衬线（副标题）
- 装饰：金色光晕/光斑/星点/丝带
- IP：橙色卡通龙虾吉祥物
- 留白：主标题区 ≥ 40% 留白

---

## 2. 技术选型

### 2.1 整体架构

\`\`\`
┌─────────────────────────────────────────────┐
│  React + Tailwind + Ant Design (前端)        │
│  egg.js (BFF/后端服务)                       │
└─────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│  ClawDao 统一 LLM 网关                        │
│  ├─ MiniMax M3 (多模态理解 + 文案生成)        │
│  └─ 阿里百炼 qwen-image-plus (图像生成)       │
└─────────────────────────────────────────────┘
        ↓
┌─────────────────────────────────────────────┐
│  文件存储：本地 + ClawDao attachments        │
│  Redis：会话/任务队列                          │
│  SQLite/PostgreSQL：元数据/历史/品牌资产       │
└─────────────────────────────────────────────┘
\`\`\`

### 2.2 决策说明

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 后端 | **egg.js** | 与 ClawDao 其他 agent 服务统一栈（已用 egg），插件生态成熟（mysql/redis/oss/jwt） |
| 前端 | **React + Vite + Tailwind + Ant Design** | Ant Design 5 企业后台组件丰富；Vite 构建快；React 18 生态最广 |
| 提示词组装 | **轻量自研 + 模板字符串** | LangChain 太重（~200MB），本应用只需要：模板渲染 + 变量替换 + Few-shot 选择，Node.js 自带 `String.prototype.replace` 够用 |
| 多模态 | **ClawDao 网关 → MiniMax M3** | 与 ClawDao 全栈统一模型，避免重复造轮子 |
| 图像生成 | **阿里百炼 qwen-image-plus** | 中文场景理解强，价格低（¥0.2/张），API 稳定 |
| 文件存储 | **本地 outputs/ + ClawDao attachments API** | 简单场景本地即可，未来扩展附件系统 |
| 任务队列 | **Bull + Redis** | egg.js 原生集成 |
| 数据库 | **SQLite（开发）→ PostgreSQL（生产）** | 单机启动免维护；后续可平滑迁移 |

### 2.3 提示词组装的"轻量化"方案

> LangChain 太重（200MB+ 依赖），本应用组装需求简单：
> 1. 读 YAML/JSON 模板 → 2. 替换 `{{var}}` → 3. 拼装 Few-shot examples → 4. 调 LLM

\`\`\`js
// 自研轻量组装器（30 行代码）
function renderTemplate(tpl, vars) {
  return tpl.replace(/\\{\\{(\\w+)\\}\\}/g, (_, k) => vars[k] ?? '');
}

// 使用
const prompt = renderTemplate(\`
你是 {{role}}。
任务：{{task}}
参考图：{{refImages}}
输出：{{format}}
\`, {
  role: 'ClawDao 图像工厂',
  task: '生成直播间封面',
  refImages: '4 张参考图',
  format: 'JSON',
});
\`\`\`

> **好处**：0 依赖、0 启动延迟、可单测；后续如需复杂 Agent 行为再考虑 LangChain。

---

## 3. 项目结构

\`\`\`
clawdao-image-factory/
├── docs/
│   └── v0/
│       └── v0.1/
│           ├── README.md          ← 本文档
│           ├── api.md              ← API 设计
│           ├── prompt-spec.md     ← 提示词规范
│           └── testing.md         ← 测试计划
├── prompts/                         ← 提示词模板（YAML/JSON）
│   ├── cover.md                    ← 直播间封面
│   ├── top-banner.md               ← 顶部广告条
│   ├── mid-banner.md               ← 中间广告条
│   └── popup.md                     ← 福利弹窗
├── src/
│   ├── app/                        ← React 应用
│   │   ├── page.tsx                 ← 上传页
│   │   ├── generate/
│   │   │   └── page.tsx             ← 生成参数配置
│   │   ├── history/
│   │   │   └── page.tsx             ← 历史任务
│   │   └── layout.tsx
│   ├── components/
│   │   ├── ImageUploader.tsx
│   │   ├── CategorySelector.tsx
│   │   ├── PromptEditor.tsx
│   │   ├── ImagePreview.tsx
│   │   └── TaskCard.tsx
│   ├── lib/                         ← 核心库
│   │   ├── prompt-builder.ts       ← 提示词组装器
│   │   ├── multimodal-analyzer.ts      ← 多模态理解（MiniMax M3）
│   │   ├── image-generator.ts      ← 图像生成（阿里百炼）
│   │   ├── brand-context.ts        ← ClawDao 品牌上下文
│   │   ├── llm-gateway.ts          ← 统一 LLM 网关
│   │   └── presets.ts               ← 尺寸/比例预设
│   └── types/                       ← TypeScript 类型
│       ├── task.ts
│       ├── brand.ts
│       └── preset.ts
├── server/                          ← egg.js 后端
│   ├── app/
│   │   ├── router.ts
│   │   ├── controller/
│   │   │   ├── task.ts
│   │   │   ├── brand.ts
│   │   │   └── history.ts
│   │   └── service/
│   │       ├── prompt_builder.ts
│   │       ├── image-generator.ts
│   │       └── brand-context.ts
│   ├── config/
│   │   ├── config.default.ts
│   │   └── plugin.ts
│   └── typings/
│       └── index.d.ts
├── public/
│   └── brand/                      ← 品牌资产
│       ├── logo.svg
│       ├── lobster-mascot.png
│       └── color-palette.json
├── outputs/                        ← 生成结果（运行产物）
├── package.json
├── tsconfig.json
├── tailwind.config.js
├── vite.config.ts
└── egg/
    ├── config.default.ts
    └── plugin.ts
\`\`\`

---

## 4. 详细 Todos

### Phase 1：项目初始化（0.5 天）

- [ ] **T1.1** 在根目录创建 `package.json`，声明双 workspace（`web` + `server`）
- [ ] **T1.2** 用 Vite 创建 React 18 + TypeScript 模板
- [ ] **T1.3** 安装并配置 Tailwind CSS + Ant Design 5
- [ ] **T1.4** 用 `egg-init` 创建 egg.js 后端骨架
- [ ] **T1.5** 配置 egg 插件：mysql / redis / cors / static / jwt
- [ ] **T1.6** 在 `public/brand/` 放入 ClawDao Logo + 龙虾吉祥物 + 色板
- [ ] **T1.7** 创建 `docs/v0/v0.2` 文件夹结构（占位）

### Phase 2：品牌上下文与提示词模板（1 天）

- [ ] **T2.1** 实现 `src/lib/brand-context.ts`：ClawDao 完整知识注入
  - 公司一句话定位
  - 三大特性文案
  - 视觉风格指南（色板/字体/IP 姿态）
  - 目标受众画像
- [ ] **T2.2** 创建 `prompts/cover.md`（直播间封面提示词）
- [ ] **T2.3** 创建 `prompts/top-banner.md`（顶部广告条）
- [ ] **T2.4** 创建 `prompts/mid-banner.md`（中间广告条）
- [ ] **T2.5** 创建 `prompts/popup.md`（福利弹窗）
- [ ] **T2.6** 实现 `src/lib/prompt_builder.ts`（30 行模板渲染器）
- [ ] **T2.7** 写单元测试：模板变量替换 / 转义 / 缺省值

### Phase 3：多模态理解（1 天）

- [ ] **T3.1** 接入 ClawDao 统一 LLM 网关 SDK
- [ ] **T3.2** 实现 `src/lib/multimodal-analyzer.ts`
  - 上传图片 → base64 编码 → POST 到 MiniMax M3 `/v1/vision/analyze`
  - Prompt 模板：提取色板/构图/光影/材质/字体
  - 解析 JSON 输出，缓存到 sessionStorage
- [ ] **T3.3** 写 e2e 测试：上传 4 张参考图，验证分析结果符合预期结构

### Phase 4：图像生成 API 接入（1.5 天）

- [ ] **T4.1** 在 `config.default.ts` 配置 `aliyunBailian` API key
- [ ] **T4.2** 实现 `src/lib/image-generator.ts`
  - 调用 `qwen-image-plus`
  - 支持 5 种比例预设：9:16 / 21:9 / 16:5 / 1:1 / 自定义
  - Prompt 组装：参考图 DNA + 主题文案 + 品牌上下文
  - 异步轮询（任务创建 → 轮询结果 → 保存到 `outputs/`）
- [ ] **T4.3** 实现重试机制（最多 3 次，指数退避）
- [ ] **T4.4** 集成测试：生成 4 张图（封面/广告条/Banner/弹窗），验证质量

### Phase 5：后端 API（1 天）

- [ ] **T5.1** 设计 API endpoints（详见 `api.md`）
- [ ] **T5.2** 实现 `task` controller（创建/查询/取消任务）
- [ ] **T5.3** 实现 `brand` controller（CRUD 品牌资产）
- [ ] **T5.4** 实现 `history` controller（任务历史）
- [ ] **T5.5** 配置 Bull 队列（异步生成任务）
- [ ] **T5.6** 实现 worker 进程：消费任务 → 调多模态 → 组装 prompt → 调图像 API → 保存到 `outputs/`
- [ ] **T5.7** 实现文件下载 API（流式返回 `outputs/` 目录文件）

### Phase 6：前端 UI（2 天）

- [ ] **T6.1** 实现 `ImageUploader` 组件（拖拽 + 多选 + 预览）
- [ ] **T6.2** 实现 `CategorySelector` 组件（5 种类型卡片）
- [ ] **T6.3** 实现 `PromptEditor` 组件（实时编辑 + 模板预览）
- [ ] **T6.4** 实现 `ImagePreview` 组件（生成结果展示 + 下载）
- [ ] **T6.5** 实现 `TaskCard` 组件（历史任务卡片）
- [ ] **T6.6** 主页面 `app/page.tsx`：上传 → 选类型 → 写文案 → 生成 → 预览
- [ ] **T6.7** `app/generate/page.tsx`：参数配置 + 高级选项
- [ ] **T6.8** `app/history/page.tsx`：历史任务列表
- [ ] **T6.9** 全局 Loading 状态管理
- [ ] **T6.10** 错误处理 + Toast 提示

### Phase 7：测试 & 优化（1 天）

- [ ] **T7.1** 端到端测试：上传 4 张图 → 生成 4 张新图
- [ ] **T7.2** 视觉质量评估：与原图风格一致性、ClawDao IP 识别度
- [ ] **T7.3** Prompt 调优：Few-shot 选择 / 负面词 / 风格词权重
- [ ] **T7.4** 性能优化：图片懒加载、Prompt 缓存、并发限流
- [ ] **T7.5** 编写 README 部署文档

---

## 5. 关键 API 草图

### 5.1 创建生成任务

\`\`\`
POST /api/task/create
Content-Type: application/json
Body: {
  "category": "cover" | "top_banner" | "mid_banner" | "popup" | "custom",
  "refImages": ["base64..."],
  "theme": {
    "title": "把重复工作，交给数字员工",
    "subtitle": "一个软件，顶一层屋子 SaaS",
    "tags": ["内容自动生成", "流程自动执行", "增长任务自动运转"]
  },
  "ratio": "9:16" | "21:9" | "16:5" | "1:1" | "custom",
  "customRatio": { "w": 1920, "h": 1080 },
  "model": "qwen-image-plus",
  "brand": {
    "useLobster": true,
    "colorTone": "blue_purple" | "black_gold" | "auto"
  }
}
\`\`\`

### 5.2 任务状态查询

\`\`\`
GET /api/task/:id
Response: {
  "id": "tsk_xxx",
  "status": "pending" | "analyzing" | "generating" | "completed" | "failed",
  "progress": 0.65,
  "result": {
    "imageUrl": "/outputs/2025-09-05/cover_xxx.png",
    "thumbUrl": "...",
    "params": {...}
  },
  "error": null,
  "createdAt": "...",
  "completedAt": "..."
}
\`\`\`

### 5.3 下载生成结果

\`\`\`
GET /api/task/:id/download
→ 302 Redirect to /outputs/2025-09-05/cover_xxx.png
\`\`\`

详细 API 设计见 `api.md`。

---

## 6. 数据模型

### 6.1 Task（任务）

\`\`\`ts
interface Task {
  id: string;                    // tsk_xxxx
  userId: string;
  category: TaskCategory;
  refImages: string[];            // base64 数组
  theme: ThemeConfig;
  ratio: RatioPreset;
  status: TaskStatus;
  progress: number;              // 0~1
  result?: TaskResult;
  error?: string;
  createdAt: string;
  completedAt?: string;
}
\`\`\`

### 6.2 BrandAsset（品牌资产）

\`\`\`ts
interface BrandAsset {
  id: string;
  type: 'logo' | 'mascot' | 'palette' | 'font';
  url: string;
  metadata: Record<string, any>;
  createdAt: string;
}
\`\`\`

### 6.3 Preset（比例预设）

\`\`\`ts
type Preset = 'cover' | 'top_banner' | 'mid_banner' | 'popup' | 'custom';

interface PresetConfig {
  ratio: string;          // "9:16"
  size: { w: number; h: number };
  promptHint: string;     // 提示词 hint
}
\`\`\`

---

## 7. 关键风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 图像生成 API 不稳定 | 任务失败 | 指数退避重试 3 次，备用模型切换 |
| 生成结果偏离品牌 | 视觉不一致 | Few-shot 参考图 + 强 prompt 约束 |
| 多用户并发 | 任务队列堆积 | Bull 队列限流 + 优先级 |
| 大文件上传慢 | 体验差 | 前端压缩 + 后端流式上传 |
| API 成本 | 不可控 | 缓存参考图分析结果 / 用户配额管理 |
| 隐私泄露 | 风险 | 上传图片本地处理，参考图不入库 |

---

## 8. 时间线

| 阶段 | 时间 | 产出 |
|------|------|------|
| Phase 1：初始化 | 0.5 天 | 双 workspace 可跑通 |
| Phase 2：品牌上下文 + 提示词 | 1 天 | 4 套提示词模板 |
| Phase 3：多模态理解 | 1 天 | 参考图 → 视觉 DNA |
| Phase 4：图像生成 | 1.5 天 | 输入 → 输出 4 张图 |
| Phase 5：后端 API | 1 天 | 完整任务流转 |
| Phase 6：前端 UI | 2 天 | 完整交互流程 |
| Phase 7：测试优化 | 1 天 | 端到端可发布 |
| 合计 | 8 天 | v0.1 MVP |

---

## 9. v0.2 路线图（暂不实施）

- [ ] A/B 变体批量生成（一次任务 3~5 张）
- [ ] 场景库（直播/产品发布/节日营销/招商加盟）
- [ ] 品牌资产深度绑定（多 logo、多吉祥物姿态）
- [ ] 协作模式（团队空间、评论、版本）
- [ ] 浏览器插件（一键截图 → AI 生成）
- [ ] 移动端 App
- [ ] 模板市场（用户共享提示词）

---

## 10. 参考资料

- ClawDao 已有 skills：generate-image、ai-multi-modal、media-design 等
- 阿里百炼 qwen-image-plus 文档（中文场景强、价格低）
- MiniMax M3 视觉理解 API 文档
- egg.js 官方文档
- Ant Design 5 组件库

---

**版本**：v0.1（2025-09-05）
**作者**：ClawDao 图像工厂项目组
**状态**：规划中，等待启动
