// @ts-nocheck
/**
 * tmp-ascii.ts — 临时：把海报渲染成 ASCII 亮度图，用于肉眼比对版式
 * 用法：bun run scripts/tmp-ascii.ts <file.png> [cols] [rows]
 */
import sharp from 'sharp';

const file = process.argv[2];
const cols = Number(process.argv[3] ?? 48);
const rows = Number(process.argv[4] ?? 100);

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height, ch = info.channels;

const at = (x: number, y: number) => {
  const i = (y * w + x) * ch;
  return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
};
const hex = (c: number[]) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/** 单元格分类 */
function classify(c: number[]): string {
  const [r, g, b] = c;
  const lum = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
  const sat = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
  if (b > 150 && b - r > 60) return 'B';          // 蓝底
  if (lum > 0.92 && sat < 0.06) return ' ';        // 白 / 近白
  if (lum > 0.82) return '.';                     // 浅色
  if (lum > 0.6) return ':';                      // 中浅
  if (lum > 0.35) return '+';                     // 中
  if (lum > 0.15) return '*';                     // 深
  return '#';                                     // 近黑
}

console.log(`${file}  ${w}×${h}`);
for (let ry = 0; ry < rows; ry += 1) {
  let line = '';
  for (let rx = 0; rx < cols; rx += 1) {
    const x0 = Math.floor((rx * w) / cols), x1 = Math.floor(((rx + 1) * w) / cols);
    const y0 = Math.floor((ry * h) / rows), y1 = Math.floor(((ry + 1) * h) / rows);
    // 单元格里取"最不同"的一个像素（信息量最大）
    let best = classify(at(x0, y0));
    const rank = (c: string) => '#*+:. B'.indexOf(c) === -1 ? 0 : '#*+:. B'.indexOf(c);
    for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 3))) {
      for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 3))) {
        const c = classify(at(x, y));
        if (rank(c) > rank(best)) best = c;
      }
    }
    line += best;
  }
  console.log(`${String(Math.round((ry / rows) * 100)).padStart(3)}%|${line}|`);
}
