// @ts-nocheck
/**
 * tmp-rows.ts — 临时：逐行剖面（忽略左侧 4px 裁切毛边），输出每个内容带的精确几何
 * 用法：bun run scripts/tmp-rows.ts <file.png>
 */
import sharp from 'sharp';

const file = process.argv[2];
const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
const w = info.width, h = info.height, ch = info.channels;
const at = (x: number, y: number) => {
  const i = (y * w + x) * ch;
  return [data[i], data[i + 1], data[i + 2], ch > 3 ? data[i + 3] : 255] as number[];
};
const hex = (c: number[]) => '#' + c.slice(0, 3).map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

const bg = [0, 122, 255];
const isBg = (c: number[]) => Math.abs(c[0] - bg[0]) < 10 && Math.abs(c[1] - bg[1]) < 10 && Math.abs(c[2] - bg[2]) < 10;
const X0 = 4;

/** 把一行按"连续非背景段"聚类 */
function segments(y: number) {
  const segs: Array<[number, number]> = [];
  let start = -1;
  for (let x = X0; x < w; x++) {
    const nb = !isBg(at(x, y));
    if (nb && start < 0) start = x;
    if (!nb && start >= 0) { segs.push([start, x - 1]); start = -1; }
  }
  if (start >= 0) segs.push([start, w - 1]);
  return segs;
}

console.log(`${file} ${w}×${h}`);
console.log('\n【内容带】(行区间 → 合并后的横向段，合并间隙<12px)');
let bandStart = -1;
let bandSegs: Array<[number, number]> = [];
const flush = (endY: number) => {
  if (bandStart < 0) return;
  const y = endY;
  // 合并相邻段
  const merged: Array<[number, number]> = [];
  for (const s of bandSegs) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] <= 14) last[1] = s[1];
    else merged.push([s[0], s[1]]);
  }
  const desc = merged.map(([a, b]) => `${((a / w) * 100).toFixed(0)}-${((b / w) * 100).toFixed(0)}%`).join(' ');
  console.log(
    `  y ${String(bandStart).padStart(4)}..${String(y).padStart(4)}  (${((bandStart / h) * 100).toFixed(1)}%..${((y / h) * 100).toFixed(1)}%)  ${desc}`,
  );
  bandStart = -1;
  bandSegs = [];
};
for (let y = 0; y < h; y++) {
  const segs = segments(y);
  if (segs.length) {
    if (bandStart < 0) bandStart = y;
    bandSegs.push(...segs);
  } else flush(y);
}
flush(h);

console.log('\n【关键色块】');
// 找卡片（近白 #F5F7FB）矩形
let top = -1, bottom = -1, left = -1, right = -1;
for (let y = 0; y < h; y++) {
  let cnt = 0;
  for (let x = X0; x < w; x++) {
    const c = at(x, y);
    if (c[0] > 240 && c[1] > 240 && c[2] > 240) cnt++;
  }
  if (cnt / (w - X0) > 0.7) { if (top < 0) top = y; bottom = y; }
}
if (top >= 0) {
  const rowY = Math.round((top + bottom) / 2);
  for (let x = X0; x < w; x++) {
    const c = at(x, rowY);
    if (c[0] > 240 && c[1] > 240 && c[2] > 240) { if (left < 0) left = x; right = x; }
  }
  console.log(`  卡片(近白) y ${top}..${bottom} (${((top / h) * 100).toFixed(1)}%..${((bottom / h) * 100).toFixed(1)}%)  x ${left}..${right} (${((left / w) * 100).toFixed(1)}%..${((right / w) * 100).toFixed(1)}%)  宽 ${right - left}px  高 ${bottom - top}px`);
  // 圆角：卡片顶部逐行首白 x
  const rr: string[] = [];
  for (let k = 0; k < 16; k++) {
    const y = top + k;
    let lx = -1;
    for (let x = X0; x < w; x++) { const c = at(x, y); if (c[0] > 240 && c[1] > 240 && c[2] > 240) { lx = x; break; } }
    rr.push(`${k}:${lx < 0 ? '-' : lx}`);
  }
  console.log(`  顶部逐行首白 x → ${rr.join(' ')}`);
}

// 纯白框（二维码托底）矩形
let qTop = -1, qBot = -1, qL = -1, qR = -1;
for (let y = 0; y < h; y++) {
  let cnt = 0;
  for (let x = X0; x < w; x++) { const c = at(x, y); if (c[0] === 255 && c[1] === 255 && c[2] === 255) cnt++; }
  if (cnt > 60) { if (qTop < 0) qTop = y; qBot = y; }
}
if (qTop >= 0) {
  const rowY = Math.round((qTop + qBot) / 2);
  for (let x = X0; x < w; x++) { const c = at(x, rowY); if (c[0] === 255 && c[1] === 255 && c[2] === 255) { if (qL < 0) qL = x; qR = x; } }
  console.log(`  纯白框(二维码托底) y ${qTop}..${qBot} (${((qTop / h) * 100).toFixed(1)}%..${((qBot / h) * 100).toFixed(1)}%)  x ${qL}..${qR} (${((qL / w) * 100).toFixed(1)}%..${((qR / w) * 100).toFixed(1)}%)`);
}
