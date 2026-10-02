# 测试计划 v0.1

## 1. 单元测试（vitest）

### 1.1 prompt_builder.test.ts

\`\`\`ts
import {describe, it, expect} from 'vitest';
import {renderTemplate, loadPrompt} from './prompt_builder.js';

describe('renderTemplate', () => {
  it('replaces simple variables', () => {
    expect(renderTemplate('Hello, {{name}}!', {name: 'imfly'})).toBe('Hello, imfly!');
  });
  it('keeps placeholder when value missing', () => {
    expect(renderTemplate('Hi, {{name}}!', {})).toBe('Hi, {{name}}!');
  });
  it('escapes regex meta-characters', () => {
    expect(renderTemplate('a {{var}} b', {var: '$1'})).toBe('a $1 b');
  });
});

describe('loadPrompt', () => {
  it('loads cover template with vars', () => {
    const r = loadPrompt('cover', {title: 'TITLE'});
    expect(r.frontmatter.ratio).toBe('9:16');
    expect(r.body).toContain('TITLE');
  });
});
\`\`\`

### 1.2 image-generator.test.ts

\`\`\`ts
import {describe, it, expect, vi} from 'vitest';
import {generateImage} from './image-generator.js';

describe('generateImage', () => {
  it('hits MiniMax image_generation endpoint with correct payload', async () => {
    const mock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({data: {image_base64: ['A']}}), {status: 200})
    );
    await generateImage(
      {prompt: 'p', aspectRatio: '9:16'},
      {apiKey: 'k', fetchImpl: mock as any}
    );
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe('https://api.minimaxi.com/v1/image_generation');
    expect(JSON.parse(init.body).model).toBe('image-01');
  });
});
\`\`\`

### 1.3 multimodal-analyzer.test.ts

\`\`\`ts
import {describe, it, expect, vi} from 'vitest';
import {analyzeImages} from './multimodal-analyzer.js';

it('parses MiniMax M3 multimodal response', async () => {
  const m = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({content: [{text: JSON.stringify({palette: ['#fff'], composition: 'center', lighting: 'soft', textures: ['matte'], typography: 'sans', mood: 'tech', design_patterns: ['glow'], ip_visibility: {lobster_mascot: true, logo: true}, key_elements: ['logo']})}]}), {status: 200})
  );
  const d = await analyzeImages(['x'], {apiKey: 'k', fetchImpl: m as any});
  expect(d.palette).toEqual(['#fff']);
});
\`\`\`

### 1.4 brand-context.test.ts

\`\`\`ts
import {describe, it, expect} from 'vitest';
import {brandToText, DEFAULT_BRAND} from './brand-context.js';

it('includes brand name and three features', () => {
  const t = brandToText();
  expect(t).toContain('ClawDao');
  for (const f of DEFAULT_BRAND.three_features) {
    expect(t).toContain(f);
  }
});
\`\`\`

### 1.5 presets.test.ts

\`\`\`ts
import {describe, it, expect} from 'vitest';
import {getPreset, PRESETS} from './presets.js';

it('cover is 9:16, top_banner is 21:9, mid_banner is 16:5, popup is 1:1', () => {
  expect(getPreset('cover').ratio).toBe('9:16');
  expect(getPreset('top_banner').ratio).toBe('21:9');
  expect(getPreset('mid_banner').ratio).toBe('16:5');
  expect(getPreset('popup').ratio).toBe('1:1');
});
\`\`\`

## 2. 集成测试（端到端）

### 2.1 完整工作流

1. 启动后端：`cd server && npm run dev`（7001 端口）
2. 启动前端：`cd web && npm run dev`（3000 端口）
3. 打开 http://localhost:3000
4. 上传 4 张参考图（步骤 1）
5. 选择类别 "直播间封面"（步骤 2）
6. 输入主标题 "把重复工作，交给数字员工"（步骤 3）
7. 选择色调 "蓝紫渐变"，IP "启用"
8. 点击 "生成图片"
9. 等待进度条（30~60s）
10. 验证生成结果展示
11. 点击 "下载图片"，检查本地文件 `outputs/cover_*.jpeg`

### 2.2 视觉质量评估

| 评估项 | 通过标准 |
|--------|----------|
| 风格一致性 | 与参考图色板/构图/光影相似 > 85% |
| 品牌识别 | ClawDao 龙虾吉祥物清晰可见 |
| 文字准确率 | 与输入文案 100% 一致 |
| 比例正确 | 与选定比例严格一致 |

### 2.3 性能基准

| 指标 | 目标值 |
|------|------|
| 上传响应 | < 2s |
| 多模态分析 | < 5s |
| 图像生成 | < 30s |
| 总任务 | < 40s |
| 并发任务 | ≥ 5 |

## 3. 用户验收测试 (UAT)

- [ ] **UC-01**：上传 4 张参考图 → 生成 4 张新图
- [ ] **UC-02**：自定义主题文案，验证文字正确
- [ ] **UC-03**：选择不同比例（9:16 / 21:9 / 16:5 / 1:1），验证比例正确
- [ ] **UC-04**：查看历史任务列表
- [ ] **UC-05**：删除历史任务
- [ ] **UC-06**：切换不同色调（蓝紫/黑金）
- [ ] **UC-07**：使用/不使用 IP 两种模式对比
- [ ] **UC-08**：错误重试（模拟 API 失败）
- [ ] **UC-09**：并发任务（同时 5 个）
- [ ] **UC-10**：查看/下载生成结果

## 4. 验收标准

- ✅ 4 类图片全部生成成功
- ✅ 文字 100% 准确
- ✅ 风格与参考图高度一致
- ✅ ClawDao 品牌 IP 清晰可辨
- ✅ 操作流程 ≤ 3 步
- ✅ 任务完成时间 ≤ 40s

---

**版本**：v0.1（2025-09-05）
