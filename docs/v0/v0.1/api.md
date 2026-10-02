# API 设计 v0.1

## 通用约定

- **Base URL**：`http://localhost:7001`
- **认证**：ClawDao 平台用户 token（`Authorization: Bearer <token>`）
- **响应格式**：JSON
- **错误码**：
  - 200 成功
  - 400 参数错误
  - 401 未授权
  - 404 资源不存在
  - 429 限流
  - 500 服务异常
  - 503 模型不可用

## 1. 任务相关

### 1.1 创建生成任务

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

Response: {
  "code": 0,
  "data": {
    "taskId": "tsk_20250905_abc123",
    "status": "pending"
  }
}
\`\`\`

### 1.2 查询任务状态

\`\`\`
GET /api/task/:id
Response: {
  "code": 0,
  "data": {
    "id": "tsk_20250905_abc123",
    "status": "analyzing" | "generating" | "completed" | "failed",
    "progress": 0.65,
    "result": {
      "imageUrl": "/outputs/2025-09-05/cover_xxx.png",
      "thumbUrl": "/outputs/2025-09-05/cover_xxx_thumb.png",
      "params": {...}
    },
    "error": null,
    "createdAt": "2025-09-05T10:30:00Z",
    "completedAt": "2025-09-05T10:32:15Z"
  }
}
\`\`\`

### 1.3 取消任务

\`\`\`
POST /api/task/:id/cancel
Response: { "code": 0, "data": { "id": "tsk_20250905_abc123" } }
\`\`\`

### 1.4 下载生成结果

\`\`\`
GET /api/task/:id/download
→ 302 Redirect to /outputs/2025-09-05/cover_xxx.png
\`\`\`

## 2. 历史记录

### 2.1 列表

\`\`\`
GET /api/history?status=&category=&page=1&pageSize=20
Response: {
  "code": 0,
  "data": {
    "list": [
      {
        "id": "tsk_...",
        "category": "cover",
        "thumbUrl": "...",
        "status": "completed",
        "createdAt": "..."
      }
    ],
    "total": 42,
    "page": 1,
    "pageSize": 20
  }
}
\`\`\`

### 2.2 删除

\`\`\`
DELETE /api/history/:id
Response: { "code": 0, "data": { "id": "tsk_..." } }
\`\`\`

## 3. 品牌资产

### 3.1 列表

\`\`\`
GET /api/brand?type=logo
Response: {
  "code": 0,
  "data": [
    {
      "id": "brand_001",
      "type": "logo",
      "url": "/public/brand/logo.svg",
      "metadata": { "description": "ClawDao 主 Logo" }
    }
  ]
}
\`\`\`

### 3.2 上传

\`\`\`
POST /api/brand/upload
Content-Type: multipart/form-data
Body: file=@logo.png&type=logo&description=主 Logo
Response: { "code": 0, "data": { "id": "brand_002", "url": "/public/brand/logo.png" } }
\`\`\`

### 3.3 删除

\`\`\`
DELETE /api/brand/:id
Response: { "code": 0, "data": { "id": "brand_002" } }
\`\`\`

## 4. 预设

### 4.1 列表

\`\`\`
GET /api/preset
Response: {
  "code": 0,
  "data": [
    { "id": "cover",     "ratio": "9:16",  "size": { "w": 1080, "h": 1920 } },
    { "id": "top_banner", "ratio": "21:9", "size": { "w": 1920, "h":  320 } },
    { "id": "mid_banner","ratio": "16:5",  "size": { "w": 1920, "h":  600 } },
    { "id": "popup",      "ratio": "1:1",   "size": { "w": 1024, "h": 1024 } }
  ]
}
\`\`\`

## 5. 错误响应格式

\`\`\`json
{
  "code": 400,
  "msg": "参数错误",
  "data": {
    "field": "refImages[0]",
    "error": "image too large (>10MB)"
  }
}
\`\`\`

---

**版本**：v0.1（2025-09-05）

---

## v0.2 增量 — A/B 变体批量生成

### 1.5 任务：多变体生成

v0.2 起，`POST /api/task/create` 支持 `variantCount` 参数，一次 HTTP 请求返回 N 张同 prompt 但视觉有差异的变体，**总耗时不变**（仍为 30~60s）。

**入参新增字段**：

```jsonc
{
  // ... 原有字段 ...
  "variantCount": 3,                // 1~5，默认 1
  "variantStrategy": "parallel"     // parallel | diverse（v0.3 启用）
}
```

**夹紧规则**：
- `variantCount < 1` → 1
- `variantCount > 5` → 5（image-01 单次上限）
- 非整数 → 向下取整

**出参（task.result）新增字段**：

```jsonc
{
  "imageUrl": "/outputs/cover_xxx_0.jpeg",   // 兼容字段 = variants[0].url
  "thumbUrl": "/outputs/cover_xxx_0.jpeg",
  "variants": [
    { "url": "/outputs/cover_xxx_0.jpeg", "width": 1080, "height": 1920, "bytes": 196602 },
    { "url": "/outputs/cover_xxx_1.jpeg", "width": 1080, "height": 1920, "bytes": 211088 },
    { "url": "/outputs/cover_xxx_2.jpeg", "width": 1080, "height": 1920, "bytes": 203441 }
  ],
  "params": {
    "category": "cover",
    "variantCount": 3,
    "variantSuccess": 3,
    // ...
  }
}
```

**存储**：`Task.variantConfig = { count, strategy }` 持久化在 SQLite，重启后仍可查。

**前端 UI**：
- 「操作面板」新增变体数量按钮组（1 / 2 / 3 / 4 / 5）
- 「生成结果」卡：单变体按原样展示；多变体自动展开画廊（每张带独立下载）
- 历史任务卡片新增 `A/B ×N` 标签

**测试覆盖**：
- `src/lib/image-generator.variant.test.ts` — 6 个用例：n 透传、夹紧、smartGenerate 默认值、空图抛错
- `src/app-server/task-manager.variant.test.ts` — 6 个用例：默认、3 张、夹紧、持久化、失败语义
