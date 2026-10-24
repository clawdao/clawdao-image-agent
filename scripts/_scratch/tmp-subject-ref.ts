// @ts-nocheck
/**
 * tmp-subject-ref.ts — 临时脚本：测试 subject_reference（用参考图主视觉做垫图）
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

function resolveApiKey(): string {
  const auth = JSON.parse(readFileSync(join(homedir(), '.clawdao/auth.json'), 'utf-8'));
  for (const key of ['minimax-cn', 'minimax(cn)', 'minimax']) {
    const entry = auth[key];
    const value = entry?.apiKey ?? entry?.key ?? entry?.token;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  throw new Error('no key');
}
const apiKey = resolveApiKey();
mkdirSync('outputs/_tmp/models', { recursive: true });

const ref = readFileSync('outputs/_tmp/ref-visual.png').toString('base64');
const prompt = `【用途】直播封面下半部主视觉，成品会在本地叠加中文排版
【画面】白色极简工作台上悬浮着一台超薄笔记本电脑（屏幕朝向观者，屏幕内是抽象的深色数据看板，只有色块与图表，不要任何文字），电脑右侧站着一个拟人化的数字员工机器人：白色与银灰金属机身，胸口有青蓝色发光条，头部是一块深色屏幕，屏幕上有两只青蓝色发光的眼睛，机器人头顶有一对珊瑚红的小机械钳，姿态友好、微微侧身
【光效】底部蓝→青→紫的柔和极光地台，机器人与电脑在地面上投下柔和阴影
【风格】高精度 3D 渲染插画，干净、克制、偏企业科技风
【禁止】不要文字、字母、数字、Logo、水印、二维码、图表数值、界面文字`;

for (const model of ['image-01', 'image-01-live']) {
  const res = await fetch('https://api.minimaxi.com/v1/image_generation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      prompt,
      aspect_ratio: '16:9',
      n: 1,
      response_format: 'base64',
      subject_reference: [{ type: 'object', image_file: `data:image/png;base64,${ref}` }],
    }),
  });
  const text = await res.text();
  if (!res.ok) { console.log(`${model} subject_reference -> HTTP ${res.status}: ${text.slice(0,400)}`); continue; }
  const json = JSON.parse(text);
  const b64 = json?.data?.image_base64?.[0];
  if (!b64) { console.log(`${model} -> 无图像 ${text.slice(0,300)}`); continue; }
  const buffer = Buffer.from(b64, 'base64');
  const path = `outputs/_tmp/models/${model}-subjectref.jpg`;
  writeFileSync(path, buffer);
  const meta = await sharp(buffer).metadata();
  console.log(`${model} subject_reference -> ${path} ${meta.width}x${meta.height}`);
}
