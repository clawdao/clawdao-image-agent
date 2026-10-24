// @ts-nocheck
/**
 * tmp-compare-geom.ts — 临时：把「当前产出」和「参考模板」的关键几何量并排打出来
 *   1) 背景主色
 *   2) 白色主卡范围
 *   3) 逐行墨迹带（蓝底上的字 / 卡内的字）
 *   4) 二维码白框与黑模块范围
 */
import sharp from 'sharp';

const A = process.argv[2] ?? 'outputs/poster/promo-blue.png';
const B = process.argv[3] ?? '.clawdao-uploads/att-1792746023757-6zgvoz.png';

async function load(f: string) {
  const { data, info } = await sharp(f).raw().toBuffer({ resolveWithObject: true });
  return { data, info, w: info.width, h: info.height, ch: info.channels };
}

function mk(img: any) {
  const { data, w, ch } = img;
  return (x: number, y: number) => {
    const i = (y * w + x) * ch;
    return [data[i], data[i + 1], data[i + 2]];
  };
}

/** 找近白区域（白卡 / 白框） */
function whiteBox(img: any, y0: number, y1: number) {
  const at = mk(img);
  let minX = 1e9,
    maxX = -1,
    minY = 1e9,
    maxY = -1;
  for (let y = y0; y < y1; y++)
    for (let x = 4; x < img.w; x++) {
      const c = at(x, y);
      if (c[0] > 248 && c[1] > 248 && c[2] > 248) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  return { minX, maxX, minY, maxY, w: maxX - minX, h: maxY - minY };
}

/** 逐行墨迹带：把「非背景」像素按行聚成带 */
function inkBands(img: any, bg: number[], y0: number, y1: number, minRun = 2) {
  const at = mk(img);
  const bands: { y0: number; y1: number; x0: number; x1: number }[] = [];
  let cur: any = null;
  const isInk = (c: number[]) => {
    const d = Math.abs(c[0] - bg[0]) + Math.abs(c[1] - bg[1]) + Math.abs(c[2] - bg[2]);
    return d > 90;
  };
  for (let y = y0; y < y1; y++) {
    let l = -1,
      r = -1;
    for (let x = 4; x < img.w; x++) {
      if (isInk(at(x, y))) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l >= 0 && r - l >= minRun) {
      if (!cur) cur = { y0: y, y1: y, x0: l, x1: r };
      else {
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, l);
        cur.x1 = Math.max(cur.x1, r);
      }
    } else if (cur) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  return bands;
}

/** 卡内墨迹带（近白底上的深色字） */
function darkBands(img: any, y0: number, y1: number) {
  const at = mk(img);
  const bands: any[] = [];
  let cur: any = null;
  for (let y = y0; y < y1; y++) {
    let l = -1,
      r = -1;
    for (let x = 4; x < img.w; x++) {
      const c = at(x, y);
      if (c[0] < 120 && c[1] < 120 && c[2] < 120) {
        if (l < 0) l = x;
        r = x;
      }
    }
    if (l >= 0) {
      if (!cur) cur = { y0: y, y1: y, x0: l, x1: r };
      else {
        cur.y1 = y;
        cur.x0 = Math.min(cur.x0, l);
        cur.x1 = Math.max(cur.x1, r);
      }
    } else if (cur) {
      bands.push(cur);
      cur = null;
    }
  }
  if (cur) bands.push(cur);
  return bands;
}

const fmt = (b: any) =>
  `y ${b.y0}..${b.y1}  x ${b.x0}..${b.x1}  (h=${b.y1 - b.y0} w=${b.x1 - b.x0})`;

for (const [label, file] of [
  ['产出', A],
  ['模板', B],
] as const) {
  const img = await load(file);
  const at = mk(img);
  console.log(`\n===== ${label}：${file} =====`);
  console.log(`尺寸 ${img.w}×${img.h}`);
  console.log(`左上背景色 ${at(10, 10).join(',')}  中部 ${at(400, 300).join(',')}`);
  const wb = whiteBox(img, 300, img.h - 100);
  console.log(
    `白色区(含二维码框) x ${wb.minX}..${wb.maxX} (w=${wb.w})  y ${wb.minY}..${wb.maxY} (h=${wb.h})  上沿=${(
      (wb.minY / img.h) * 100
    ).toFixed(1)}%`,
  );
  console.log('— 蓝底墨迹带 —');
  for (const b of inkBands(img, [0, 122, 255], 0, 640)) console.log('  ' + fmt(b));
  console.log('— 白卡内深色字带 —');
  for (const b of darkBands(img, 640, Math.min(wb.maxY, wb.minY + 900))) console.log('  ' + fmt(b));
}
