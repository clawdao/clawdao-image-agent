// @ts-nocheck
/**
 * tmp-geometry.ts — 临时脚本：像素级量出海报几何（卡片/色块/文字行的位置）
 * 用法：bun run scripts/tmp-geometry.ts <图片>
 */
import sharp from 'sharp';

const file = process.argv[2];
const img = sharp(file);
const meta = await img.metadata();
const W = meta.width!;
const H = meta.height!;
const { data } = await img.raw().toBuffer({ resolveWithObject: true });
const ch = data.length / (W * H);

const px = (x: number, y: number) => {
  const i = (y * W + x) * ch;
  return [data[i], data[i + 1], data[i + 2]];
};
const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
const lum = (c: number[]) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

console.log(`# ${file}  ${W}x${H}`);

/** 打印若干水平扫描线上的色块分段（按颜色变化切段） */
function scanRow(yRatio: number, label: string) {
  const y = Math.round(H * yRatio);
  const segs: Array<{ x0: number; x1: number; c: number[] }> = [];
  let prev: number[] | null = null;
  let start = 0;
  for (let x = 0; x < W; x += 4) {
    const c = px(x, y);
    const changed =
      !prev ||
      Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]) > 18;
    if (changed) {
      if (prev && x - start > W * 0.012) segs.push({ x0: start, x1: x, c: prev });
      start = x;
      prev = c;
    }
  }
  if (prev) segs.push({ x0: start, x1: W, c: prev });
  const useful = segs.filter((s) => sat(s.c) > 6 || lum(s.c) < 200);
  console.log(`\n[${label}] y=${y} (${(yRatio * 100).toFixed(1)}%)`);
  for (const s of useful) {
    console.log(
      `   x ${((s.x0 / W) * 100).toFixed(1)}%..${((s.x1 / W) * 100).toFixed(1)}%  rgb(${s.c.join(',')})`,
    );
  }
}

/** 找出某一条垂直带里“非背景”像素的上下范围 */
function bandExtent(xRatio: number, y0: number, y1: number, label: string) {
  const x = Math.round(W * xRatio);
  let top = -1;
  let bottom = -1;
  for (let y = Math.round(H * y0); y < Math.round(H * y1); y += 2) {
    const c = px(x, y);
    if (sat(c) > 10 || lum(c) < 150) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  console.log(
    `[${label}] x=${(xRatio * 100).toFixed(1)}% 内容纵向 ${((top / H) * 100).toFixed(1)}%..${((bottom / H) * 100).toFixed(1)}%`,
  );
}

/** 逐行统计“深色文字像素”，定位文字行 */
function textRows(y0 = 0, y1 = 1) {
  console.log('\n[文字行分布]');
  const rows: Array<{ y0: number; y1: number; count: number }> = [];
  let cur: { y0: number; y1: number; count: number } | null = null;
  for (let y = 0; y < H * y1; y += 2) {
    if (y < H * y0) continue;
    let count = 0;
    for (let x = 0; x < W; x += 3) {
      const c = px(x, y);
      if (lum(c) < 110 && sat(c) < 90) count++;
    }
    if (count > 3) {
      if (!cur) cur = { y0: y, y1: y, count };
      else {
        cur.y1 = y;
        cur.count = Math.max(cur.count, count);
      }
    } else if (cur) {
      rows.push(cur);
      cur = null;
    }
  }
  if (cur) rows.push(cur);
  for (const r of rows) {
    console.log(
      `   y ${((r.y0 / H) * 100).toFixed(1)}%..${((r.y1 / H) * 100).toFixed(1)}%  (h=${(((r.y1 - r.y0) / H) * 100).toFixed(2)}% of H)  peak=${r.count}`,
    );
  }
}

scanRow(0.06, '品牌行');
scanRow(0.22, '主标题行');
scanRow(0.28, '副标题行');
scanRow(0.35, '功能卡行');
scanRow(0.58, '主视觉区');
scanRow(0.75, '主视觉区下');
scanRow(0.9, '底部');
bandExtent(0.5, 0.1, 0.35, '中轴 10-35%');
bandExtent(0.5, 0.35, 0.99, '中轴 35-99%');
textRows(0, 0.5);
