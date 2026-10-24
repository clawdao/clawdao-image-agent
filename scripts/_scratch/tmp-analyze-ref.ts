// @ts-nocheck
/**
 * tmp-analyze-ref.ts — 临时脚本：用多模态模型"看"参考图，抽取版式 / 文案 / 配色
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

const file = process.argv[2];
const base64 = readFileSync(file).toString('base64');
const mediaType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';

const prompt = `
请仔细观察这张参考海报图（一张竖版长图），按下面结构输出，用中文，尽量精确：

1. 【逐字文案】从上到下，把图里出现的所有文字**原样**抄出来（包括主标题、副标题、标签、按钮、页脚、小字、角标、日期、价格、账号名等），每行标注它的大致位置（顶部/上部/中部/下部/底部）与字号相对大小（超大/大/中/小/极小）。
2. 【版式结构】从上到下逐块描述每一块是什么（头像？人像？产品图？纯色块？文字？卡片？贴纸？二维码？），以及它的位置、尺寸占比、左右边距、有没有圆角/描边/阴影。
3. 【配色】列出主色（背景底色）、强调色、标题色、正文色，各给 hex；说明背景是纯色/渐变/图片。
4. 【字体与字重】标题是什么字体风格（黑体/圆体/衬线/艺术字）、字重、是否描边/投影/渐变填充、是否居中。
5. 【可复用的模板要素】如果要把它做成一个"给定内容+主题+尺寸"的通用模板，哪些元素是固定的（品牌位、贴纸、页脚、进度条等），哪些是可替换的。
6. 【整体比例】图中主要视觉元素占据画面的比例，用于反推是"人物占位"还是"纯信息型"。

只输出结构化文字，不要寒暄。
`;

const res = await fetch('https://api.minimaxi.com/anthropic/v1/messages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${resolveApiKey()}`,
    'anthropic-version': '2023-06-01',
  },
  body: JSON.stringify({
    model: 'MiniMax-M3',
    max_tokens: 4000,
    temperature: 0.2,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
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
