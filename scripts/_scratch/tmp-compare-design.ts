// @ts-nocheck
/**
 * tmp-compare-design.ts — 临时脚本：让多模态模型并排"看"两张图，输出设计差异清单
 *   用法：bun run scripts/tmp-compare-design.ts <参考模板图> <当前产出图>
 * （用完即删）
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function resolveApiKey(): string {
  if (process.env.MINIMAX_CN_API_KEY?.trim()) return process.env.MINIMAX_CN_API_KEY.trim();
  const auth = JSON.parse(readFileSync(join(homedir(), '.clawdao/auth.json'), 'utf-8'));
  for (const key of ['minimax-cn', 'minimax(cn)', 'minimax']) {
    const entry = auth[key];
    const value = entry?.apiKey ?? entry?.key ?? entry?.token;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error('no key');
}

function toImage(file: string) {
  const base64 = readFileSync(file).toString('base64');
  const mediaType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } };
}

const refFile = process.argv[2];
const curFile = process.argv[3];
if (!refFile || !curFile) {
  console.error('用法: bun run scripts/tmp-compare-design.ts <ref.png> <cur.png>');
  process.exit(1);
}

const prompt = `
你是资深视觉/海报设计评审。下面两张图：
- 【图A】= 原始模板（小微数智版），设计基准，平台认可
- 【图B】= 我们用程序渲染出来的当前产出，用户反馈"差别很大"

请分别、逐块、非常具体地描述两张图，然后用表格对比。

## 第一部分：图A（模板）拆解
1. 从上到下每一区块：类型（人像/产品图/插画/纯色块/卡片/文字/贴纸/二维码/装饰线…）、位置（距顶百分比）、高度占比、宽度占比、左右边距、圆角/描边/阴影/渐变。
2. **逐字文案抄录**（原样，含所有标签、角标、按钮、页脚、小字），标注每行所属区块与相对字号（超大/大/中/小/极小）与对齐方式（左/居中/右）。
3. 配色：背景底色、卡片底色、强调色、标题色、正文色（各给 hex）；背景是纯色还是渐变还是图片。
4. 字体与字重：标题字体风格（黑体/圆体/衬线/艺术字/书法）、字重、是否描边、是否投影、是否渐变填充、是否倾斜、行距。
5. **图片元素**：人像或产品图怎么裁切、放在哪、什么形状（矩形/圆/圆角/抠图）、是否带阴影或光晕、边缘怎么处理。
6. 装饰元素：光效（光晕/辉光/星芒/粒子/网格/几何线条）、色块、边框、图标、序号徽章。
7. 整体信息密度、留白节奏、视觉重心。

## 第二部分：图B（当前产出）拆解
用同样的 7 项来描述。

## 第三部分：差异清单（最重要）
按"视觉影响权重"从高到低排，列出 **至少 12 条**具体差异，每条写：
- 差异点（模板怎么做的 vs 当前产出怎么做）
- 为什么模板的做法视觉更高级 / 更贴合平台调性
- 要在渲染器里落地的**可执行动作**（具体到：需要哪种新 block / 新参数 / 新绘制层）
表格三列：差异点 | 模板做法 | 当前产出 & 落地动作

## 第四部分：可复用模板骨架
给出一份"模板抽象"：哪些元素固定（品牌位、贴纸、页脚…）、哪些随内容替换；以及一个建议的渲染块类型清单（例如 hero-portrait / stat-strip / feature-card / cta-bar / qr-badge…），每个说明它的入参与绘制职责。

只输出结构化中文文字，不要寒暄。`;

const res = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resolveApiKey()}`,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'MiniMax-M3',
    max_tokens: 8000,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'text', text: '图A（模板）：' },
          toImage(refFile),
          { type: 'text', text: '图B（当前产出）：' },
          toImage(curFile),
        ],
      },
    ],
  }),
});

if (!res.ok) {
  console.error('API error', res.status, await res.text());
  process.exit(1);
}

const json = (await res.json()) as { content: Array<{ text: string }> };
console.log(json.content.map((c) => c.text).join('\n'));
