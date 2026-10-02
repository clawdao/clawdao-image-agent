# 部署文档 v0.1

## 1. 环境要求

- Node.js >= 18
- npm >= 9
- 操作系统：macOS / Linux / Windows

## 2. 安装步骤

\`\`\`bash
# 1. 安装根依赖
git clone git@github.com:clawdao/clawdao-image-agent.git
cd clawdao-image-agent
npm install

# 2. 安装 web 工作空间
npm install --workspace web

# 3. 安装 server 工作空间
npm install --workspace server

# 4. 配置环境变量
\`\`\`

`.env` 文件（项目根）：

\`\`\`
# MiniMax 网关 API Key
MINIMAX_API_KEY=sk-xxx

# MiniMax 接口地址（按需切换国内 / 国际区）
MINIMAX_BASE_URL=https://api.minimaxi.com
MINIMAX_GATEWAY_BASE_URL=https://api.minimaxi.com/v1/llm/v1

# 输出目录
OUTPUTS_DIR=./outputs
OUTPUTS_URL_PREFIX=/outputs/
\`\`\`

## 3. 开发模式

\`\`\`bash
# 同时启动前后端（端口 3000 + 7001）
npm run dev
\`\`\`

访问 http://localhost:3000 即可访问前端。

## 4. 生产模式

\`\`\`bash
# 构建
npm run build

# 启动
npm start
\`\`\`

## 5. 目录结构（与 README 对齐）

\`\`\`
clawdao-image-factory/
├── docs/         # 开发文档（v0/v0.1）
├── prompts/      # 4 类提示词模板（cover/top-banner/mid-banner/popup）
├── public/brand/ # 品牌资产
├── outputs/      # 生成结果
├── src/          # 前端 + 共享 lib
│   ├── app/      # React 主页面
│   ├── components/
│   ├── lib/      # 核心库（front + back 共用）
│   │   ├── brand-context.ts
│   │   ├── image-generator.ts  ← 调 MiniMax image-01
│   │   ├── multimodal-analyzer.ts ← 调 MiniMax M3
│   │   ├── llm-gateway.ts     ← 调 MiniMax 网关
│   │   ├── preset.ts          ← 比例预设
│   │   └── prompt_builder.ts ← 提示词组装器
│   ├── stores/   # Zustand 状态
│   └── styles/
├── server/       # egg.js 后端
│   ├── app/
│   │   ├── controller/      # API endpoints
│   │   ├── service/         # 业务逻辑
│   │   └── router.ts
│   └── config/
└── web/          # Vite 前端
    ├── src/
    └── index.html
\`\`\`

## 6. 关键 API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/task/create` | POST | 创建生成任务 |
| `/api/task/:id` | GET | 查询任务状态 |
| `/api/task/list` | GET | 历史任务列表 |
| `/api/task/:id/cancel` | POST | 取消任务 |
| `/api/task/:id` | DELETE | 删除任务 |
| `/api/task/:id/download` | GET | 下载结果 |
| `/outputs/*` | GET | 静态文件 |

## 7. 监控

- 健康检查：`GET /health`
- 任务统计：`GET /api/task/stats`

---

**版本**：v0.1（2025-09-05）
