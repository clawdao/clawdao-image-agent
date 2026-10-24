// @ts-nocheck
/**
 * tmp-card-profile.ts —— 临时：采样参考图三张功能卡的前景/边缘/中心色
 * 用法：bun run scripts/tmp-card-profile.ts
 */
import sharp from 'sharp';

const REF = '.clawdao-uploads/att-1792595332920-h7grkb.png';
const { data, info } = await sharp(REF).raw().toBuffer({ resolveWithObject: true });
const px = (x: number, y: number) => {
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
};

// 参考图实测卡片 x 范围（%）：卡1 20.9-39.1 / 卡2 41-58.5 / 卡3 60.5-79；y 32.4-38.5
const cards = [
  { name: '卡1', x0: 0.209, x1: 0.391 },
  { name: '卡2', x0: 0.41, x1: 0.585 },
  { name: '卡3', x0: 0.605, x1: 0.79 },
];
const cardTop = Math.round(0.324 * info.height);
const cardBottom = Math.round(0.385 * info.height);
const midY = Math.round((cardTop + cardBottom) / 2);

console.log(`画布 ${info.width}×${info.height}，卡片纵向 ${cardTop}..${cardBottom}`);
for (const card of cards) {
  const x0 = Math.round(card.x0 * info.width);
  const x1 = Math.round(card.x1 * info.width);
  console.log(`\n${card.name} x=${x0}..${x1}（宽 ${x1 - x0}）`);
  const samples = [0, 2, 6, 12, 24, 40, 60, 80, 95, 98, 100].map((p) => {
    const x = Math.min(x1 - 1, x0 + Math.round(((x1 - x0) * p) / 100));
    return `${p}%(${x})=${px(x, midY).join(',')}`;
  });
  console.log('  中线：', samples.join('  '));
  // 纵向：卡片顶边 / 内部 / 底边
  const ys = [0, 4, 12, 25, 50, 75, 88, 96, 100].map((p) => {
    const y = Math.min(cardBottom - 1, cardTop + Math.round(((cardBottom - cardTop) * p) / 100));
    return `${p}%(${y})=${px(x0 + 6, y).join(',')}`;
  });
  console.log('  左内缘纵向：', ys.join('  '));
}
