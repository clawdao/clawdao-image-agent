# ClawDao 图像工厂

AI 驱动的直播间视觉素材生成器。输入参考图 + 文案 → AI 自动按 ClawDao 品牌调性生成 4 类同风格图片（封面/广告条/Banner/福利弹窗）。

## 🚀 快速开始（5 分钟）

### 1. 安装

```bash
git clone git@github.com:clawdao/clawdao-image-agent.git
cd clawdao-image-agent

# 根依赖（Bun 是运行时与包管理器；Node 工具仅 web/ 端用）
bun install

# 前端 workspace（如未自动安装）
cd web && npm install && cd ..
```

> 推荐使用 Bun ≥ 1.0：`curl -fsSL https://bun.sh/install | bash`

### 2. 配置 API Key

创建项目根目录的 `.env`（**不要提交到 git**）：

```
MINIMAX_API_KEY=sk-你的真实key
```

> Key 已在 ClawDao 系统配置里，但你可能需要新建一个 minimax provider 的 key 用于直接调 `image-01` 接口。
> 如果 `.env` 留空，后端会自动回落读取 `~/.clawdao/auth.json` 的 `minimax-cn` / `minimax` 条目。

### 3. 启动开发模式

```bash
# 一键启动前后端（前端 5182，后端 18795）
bun run dev
```

- 前端访问： http://localhost:5182
- API 健康检查： http://localhost:18795/api/health
- 生成图静态访问： http://localhost:18795/outputs/<file>

> 也可以分别启动：`bun run dev:backend` / `bun run dev:frontend`

### 4. 体验流程

1. 上传 4 张参考图（自动分析视觉 DNA）
2. 选择类别（封面 / 顶部 / 中间 / 弹窗）
3. 输入主标题 / 副标题 / 标签
4. 选色调（蓝紫 / 黑金）+ IP 启用
5. 点 "生成图片" → 30~60s 后出图
6. 下载到本地

## 🧠 技术栈

- **前端**：React 18 + Vite + TypeScript + Tailwind + Ant Design 5
- **后端**：**Bun + 原生 fetch**（`src/index.ts` 用 `Bun.serve` 起 HTTP，零 npm 依赖）
- **多模态理解**：ClawDao 网关 → **MiniMax-M3**（Anthropic 兼容端点 `https://api.minimaxi.com/anthropic`）
- **图像生成**：**MiniMax image-01**（API 端点 `https://api.minimaxi.com/v1/image_generation`）
- **任务状态**：**内存 Map**（MVP；后续可平滑替换为 Bull + Redis）
- **数据库**：**SQLite**（`bun:sqlite` 零依赖，默认在 `outputs/clawdao.db`）→ PostgreSQL（生产规划）

> 历史 egg.js / server-egg-legacy 方案已在 `.archive/` 归档，**Bun 单进程是当前主线**。

## 📁 目录

```
clawdao-image-factory/
├── docs/v0/v0.1/        # 5 份开发文档（README/api/prompt-spec/testing/deployment）
├── prompts/             # 4 类提示词模板（cover/top-banner/mid-banner/popup）
├── public/brand/        # 品牌资产（Logo / IP / 色板）
├── outputs/             # 运行产物（images / _archive / clawdao.db）
├── .archive/            # 历史归档（egg.js 后端 → server-egg-legacy/）
├── src/                 # Bun 后端 + 共享 lib
│   ├── lib/             # 7 个核心库（brand / image / multimodal / llm-gateway / prompt-builder / scenes / storage / presets）
│   ├── app-server/      # 任务管理器（替代 egg service）
│   ├── types/           # 共享 TS 类型
│   └── index.ts         # Bun HTTP 服务入口（端口 18795）
├── web/                 # Vite + React 前端（端口 5182）
├── scripts/start-all.ts # 一键起前后端
└── .clawdao/project.json # ClawDao 应用清单
```

## ⚙️ 环境变量

| 变量 | 说明 | 必需 | 默认 |
|------|------|------|------|
| `MINIMAX_API_KEY` | MiniMax 网关的 API Key | ✗ | 回落到 `~/.clawdao/auth.json` |
| `MINIMAX_CN_API_KEY` | 国内 MiniMax Key（优先级高于上面） | ✗ | — |
| `PORT` | 后端端口 | ✗ | 18795 |
| `OUTPUTS_DIR` | 生成图片保存目录 | ✗ | `./outputs` |
| `OUTPUTS_URL_PREFIX` | 静态服务 URL 前缀 | ✗ | `/outputs/` |
| `MINIMAX_BASE_URL` | image-01 基址 | ✗ | `https://api.minimaxi.com` |
| `MINIMAX_LLM_BASE_URL` | M3 多模态基址 | ✗ | `https://api.minimaxi.com/anthropic` |

## 🔑 核心设计点

1. **轻量化提示词组装**：30 行 `prompt_builder.ts` 替代 LangChain，0 依赖、0 启动延迟。
2. **MiniMax 网关统一调用**：`llm-gateway.ts` 统一封装 M3 + image-01，前端只关心业务。
3. **共享 lib 架构**：`src/lib/` 同时被前端（web）和后端（server）import，避免代码重复。
4. **任务队列内置 Map**：MVP 阶段用内存 Map 做任务状态，避免 Bull/Redis 依赖启动慢。
5. **5 类比例预设**：cover 9:16 / top-banner 21:9 / mid-banner 16:5 / popup 1:1 / custom 16:9。
6. **单端口可部署**：`bun run build:web` 后 `src/index.ts` 同时托管 API + 静态前端，部署只需一个进程。

## 📚 文档

| 文档 | 内容 |
|------|------|
| docs/v0/v0.1/README.md | 主开发文档（产品定位 / 技术选型 / Todos / 数据模型 / 风险） |
| docs/v0/v0.1/api.md | API 设计（4 模块：任务 / 历史 / 品牌 / 预设） |
| docs/v0/v0.1/prompt-spec.md | 提示词规范（系统提示词 + 用户模板 + 变量 + Few-shot） |
| docs/v0/v0.1/testing.md | 测试计划（单元 / 集成 / UAT + 性能基准） |
| docs/v0/v0.1/deployment.md | 部署文档（环境 / 安装 / 开发 / 生产） |

## 🎯 已完成清单（v0.1 MVP）

- [x] Phase 1：项目初始化（双 workspace + Tailwind + Ant Design）
- [x] Phase 2：品牌上下文 + 提示词模板（4 套）
- [x] Phase 3：多模态理解（MiniMax M3）
- [x] Phase 4：图像生成 API（MiniMax image-01）
- [x] Phase 5：后端 API（任务 CRUD + 文件下载）
- [x] Phase 6：前端 UI（4 步骤流程 + 历史）
- [x] Phase 7：测试计划 + 部署文档
- [x] Phase 8：技术栈迁移到 Bun（告别 egg.js + Bull/Redis）

## 📌 v0.2 路线图

- [x] A/B 变体批量生成（v0.2.0 一次任务 1~5 张，一次 HTTP，30~60s 出齐）
- [ ] 场景库（直播 / 产品发布 / 节日营销 / 招商加盟）
- [ ] 品牌资产深度绑定（多 logo、多吉祥物姿态）
- [ ] 协作模式（团队空间 / 评论 / 版本）
- [ ] 浏览器插件（一键截图 → AI 生成）
- [ ] 移动端 App
- [ ] 模板市场（用户共享提示词）

## 🛡️ 安全注意

- `.env` 不要提交到 git
- API Key 仅写在本机配置文件或云端 secrets
- 参考图分析结果仅缓存到内存，不入数据库
- 用户上传图片本地处理，不出网

## 📝 许可

MIT
