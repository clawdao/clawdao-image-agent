// @ts-nocheck
/**
 * tmp-inspect.ts — 临时脚本：让多模态模型「看」生成结果并做版式体检
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
const extra = process.argv[3] ?? '';
const base64 = readFileSync(file).toString('base64');
const mediaType = file.endsWith('.png') ? 'image/png' : 'image/jpeg';

const prompt = `
请检查这张生成的海报图，按下面清单逐条回答，务必具体（指出具体位置）：

1. 【逐字文案】把图里所有能看清的文字**原样**抄出来，按从上到下顺序。
2. 【完整性】画面里该有的元素是否都在？有没有文字被裁切、超出画布、被别的元素盖住、或者跟背景撞色看不清？
3. 【版式】从上到下逐块描述布局：每块占画面高度的百分比、左右边距、对齐方式。
4. 【主视觉】下半部（或主视觉区）里画的是什么？主体是否完整可见？是否被裁掉？位置是否合理（是否压在标题上、是否悬空、是否贴边）？
5. 【配色】背景主色 + 强调色，给 hex；标题与正文对比够不够。
6. 【问题清单】列出所有你认为「不好看 / 不对劲 / 会被扣分」的地方，按严重程度排序，每条给出具体修改建议（往哪个方向调、大概调多少）。

只输出结构化文字。${extra}
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
