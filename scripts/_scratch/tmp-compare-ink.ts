// @ts-nocheck
/**
 * tmp-compare-ink.ts —— 临时：对比参考图与当前产出的「文字/图标墨迹带」
 *
 * 做法：逐行统计暗像素（亮度 < 阈值）数量，把连续行聚成文本带，
 * 再在每条带里统计横向范围，用来核对版式坐标。
 *
 * 用法：bun run scripts/tmp-compare-ink.ts [ref.png] [out.png]
 */
import sharp from 'sharp';

const REF = process.argv[2] ?? '.clawdao-uploads/att-1792595332920-h7grkb.png';
const OUT = process.argv[3] ?? 'outputs/poster/live-cover.png';

interface Band {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
  count: number;
}

async function bands(file: string, threshold = 150, minRun = 2): Promise<{ bands: Band[]; h: number; w: number }> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels } = info;
  const rowCount = new Int32Array(h);
  const rowMin = new Int32Array(h).fill(w);
  const rowMax = new Int32Array(h).fill(-1);

  for (let y = 0; y < h; y++) {
    let count = 0;
    let min = w;
    let max = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * channels;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      if (lum < threshold) {
        count++;
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
    rowCount[y] = count;
    rowMin[y] = min;
    rowMax[y] = max;
  }

  const out: Band[] = [];
  let y = 0;
  while (y < h) {
    if (rowCount[y] > 2) {
      let y1 = y;
      while (y1 + 1 < h && rowCount[y1 + 1] > 2) y1++;
      if (y1 - y + 1 >= minRun) {
        let x0 = w;
        let x1 = -1;
        let total = 0;
        for (let k = y; k <= y1; k++) {
          if (rowMin[k] < x0) x0 = rowMin[k];
          if (rowMax[k] > x1) x1 = rowMax[k];
          total += rowCount[k];
        }
        out.push({ y0: y, y1, x0, x1, count: total });
      }
      y = y1 + 1;
    } else {
      y++;
    }
  }
  return { bands: out, h, w };
}

const ref = await bands(REF);
const out = await bands(OUT);

const fmt = (b: Band, h: number) =>
  `y ${(b.y0 / h * 100).toFixed(2)}%..${(b.y1 / h * 100).toFixed(2)}%  x ${(b.x0 / ref.w * 100).toFixed(1)}%..${(b.x1 / ref.w * 100).toFixed(1)}%  (${b.y0}..${b.y1} / ${b.x0}..${b.x1})`;

console.log(`=== 参考图 ${REF} (${ref.w}×${ref.h}) ===`);
for (const b of ref.bands) console.log(' ', fmt(b, ref.h));

console.log(`\n=== 当前产出 ${OUT} (${out.w}×${out.h}) ===`);
for (const b of out.bands) console.log(' ', fmt(b, out.h));
