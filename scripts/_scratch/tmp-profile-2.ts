// @ts-nocheck
/**
 * tmp-profile-2.ts — 临时：针对"卡片不是纯白"的修正版几何测量
 * 用法：bun run scripts/tmp-profile-2.ts <a.png> <b.png>
 */
import sharp from 'sharp';

async function load(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, ch: info.channels };
}
const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
type S = Awaited<ReturnType<typeof load>>;
const px = (s: S, x: number, y: number) => {
  const i = (y * s.w + x) * s.ch;
  return [s.data[i], s.data[i + 1], s.data[i + 2]] as [number, number, number];
};
const lum = (c: number[]) => (c[0] + c[1] + c[2]) / 3;
/** 亮色（白/近白）判定：足够亮且低饱和 */
function isLight(c: number[]): boolean {
  const max = Math.max(...c), min = Math.min(...c);
  return lum(c) > 225 && max - min < 26;
}

for (const file of process.argv.slice(2)) {
  const s = await load(file);
  console.log(`\n================ ${file} (${s.w}×${s.h}) ================`);

  // 中心竖线颜色序列
  console.log('\n【中心竖线 x=50% 颜色（每 1%）】');
  let prev = '';
  for (let fy = 0; fy < 1; fy += 0.01) {
    const y = Math.min(s.h - 1, Math.round(s.h * fy));
    const c = hex(...px(s, Math.round(s.w * 0.5), y));
    if (c !== prev) { console.log(`  y=${(fy * 100).toFixed(0).padStart(3)}%  ${c}`); prev = c; }
  }

  console.log('\n【亮色区（卡片）垂直分布 每 2%：亮像素占比 / 左缘 / 右缘 / 中心色】');
  for (let fy = 0; fy <= 1.0001; fy += 0.02) {
    const y = Math.min(s.h - 1, Math.round(s.h * fy));
    let count = 0, left = -1, right = -1;
    for (let x = 0; x < s.w; x++) {
      if (isLight(px(s, x, y))) { count++; if (left < 0) left = x; right = x; }
    }
    const c = hex(...px(s, Math.round(s.w * 0.5), y));
    const l = left < 0 ? '  - ' : ((left / s.w) * 100).toFixed(1).padStart(5);
    const r = right < 0 ? '  - ' : ((right / s.w) * 100).toFixed(1).padStart(5);
    console.log(`  y=${(fy * 100).toFixed(0).padStart(3)}%  ${((count / s.w) * 100).toFixed(1).padStart(5)}%  L${l}%  R${r}%  中心 ${c}`);
  }
}
