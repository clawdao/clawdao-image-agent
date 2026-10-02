# ClawDao 图像工厂

AI 驱动的直播间视觉素材生成器。

技术栈：React 18 + Vite + TypeScript + Tailwind + Ant Design 5（前端） / Bun + 原生 fetch（后端）
多模态：ClawDao 网关 → MiniMax-M3（Anthropic 兼容端点 https://api.minimaxi.com/anthropic）
图像生成：MiniMax image-01（API 端点 https://api.minimaxi.com/v1/image_generation）
任务队列：内存 Map（MVP；未来可平滑替换为 Bull/Redis）
数据库：SQLite（bun:sqlite 零依赖，默认 outputs/clawdao.db）→ PostgreSQL（生产规划）
端口：后端 18795 / 前端 5182（由 .clawdao/project.json 配置）

> 历史 egg.js / server-egg-legacy 方案已在 .archive/ 归档，Bun 单进程是当前主线。
