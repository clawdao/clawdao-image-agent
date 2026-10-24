// @ts-nocheck
/**
 * tmp-ascii2.ts — 临时：背景差分 ASCII 图（把"与背景不同的像素"标出来）
 * 用法：bun run scripts/tmp-ascii2.ts <file.png> [cols] [rows]
 */
import sharp from 'sharp';

const file = process.argv[2];
const cols = Number(process.argv[3] ?? 56);
const rows = Number(process.argv[4] ?? 70);

const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height, ch = info.channels;
const at = (x: number, y: number) => {
  const i = (y * w + x) * ch;
  return [data[i], data[i + 1], data[i + 2]] as [number, number, number];
};

// 背景色 = 四个角中位
const corners = [at(2, 2), at(w - 3, 2), at(2, h - 3), at(w - 3, h - 3)];
const bg: number[] = [0, 1, 2].map((k) => corners.map((c) => c[k]).sort((a, b) => a - b)[2]);
const dist = (c: number[]) => Math.hypot(c[0] - bg[0], c[1] - bg[1], c[2] - bg[2]);

function mark(c: number[], d: number): string {
  const lum = (c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114) / 255;
  if (d < 12) return ' ';                     // 背景
  if (lum > 0.93) return 'W';                // 白
  if (lum > 0.78) return 'w';                // 浅（浅蓝文字/浅色块）
  if (lum > 0.5) return '+';
  if (lum > 0.25) return '*';
  return '#';
}

console.log(`${file}  ${w}×${h}   bg=rgb(${bg.join(',')})`);
for (let ry = 0; ry < rows; ry += 1) {
  let line = '';
  for (let rx = 0; rx < cols; rx += 1) {
    const x0 = Math.floor((rx * w) / cols), x1 = Math.max(x0 + 1, Math.floor(((rx + 1) * w) / cols));
    const y0 = Math.floor((ry * h) / rows), y1 = Math.max(y0 + 1, Math.floor(((ry + 1) * h) / rows));
    const hits: number[][] = [];
    for (let y = y0; y < y1; y += Math.max(1, Math.floor((y1 - y0) / 2))) {
      for (let x = x0; x < x1; x += Math.max(1, Math.floor((x1 - x0) / 2))) {
        const c = at(x, y);
        const d = dist(c);
        if (d >= 12) hits.push([c[0], c[1], c[2], d]);
      }
    }
    if (!hits.length) { line += ' '; continue; }
    // 取"最深"的几个像素的平均
    hits.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    const top = hits.slice(0, Math.max(1, Math.ceil(hits.length * 0.35)));
    const avg = [
      top.reduce((s, p) => s + p[0], 0) / top.length,
      top.reduce((s, p) => s + p[1], 0) / top.length,
      top.reduce((s, p) => s + p[2], 0) / top.length,
    ];
    const avgD = top.reduce((s, p) => s + p[3], 0) / top.length;
    line += mark(avg as number[], avgD);
  }
  console.log(`${String(Math.round((ry / rows) * 100)).padStart(3)}%|${line}|`);
}
