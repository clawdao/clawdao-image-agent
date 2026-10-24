// @ts-nocheck
/**
 * tmp-profile-geometric.ts — 临时：精确测量两张海报的版式几何（不靠模型目测）
 * 用法：bun run scripts/tmp-profile-geometric.ts <a.png> <b.png>
 */
import sharp from 'sharp';

type Sample = { data: Buffer; info: sharp.OutputInfo; w: number; h: number; ch: number };

async function load(file: string): Promise<Sample> {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, info, w: info.width, h: info.height, ch: info.channels };
}

const hex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

function px(s: Sample, x: number, y: number): [number, number, number] {
  const i = (y * s.w + x) * s.ch;
  return [s.data[i], s.data[i + 1], s.data[i + 2]];
}
const isWhite = (c: [number, number, number]) => c[0] > 244 && c[1] > 244 && c[2] > 244;
const isNear = (c: [number, number, number], hexStr: string) => {
  const t = hexStr.replace('#', '');
  const tr = parseInt(t.slice(0, 2), 16), tg = parseInt(t.slice(2, 4), 16), tb = parseInt(t.slice(4, 6), 16);
  return Math.abs(c[0] - tr) < 26 && Math.abs(c[1] - tg) < 26 && Math.abs(c[2] - tb) < 26;
};

function report(file: string, s: Sample) {
  console.log(`\n================ ${file} ================`);
  console.log(`尺寸 ${s.w} × ${s.h}`);

  // 1) 背景色沿左边距的纵向分布
  console.log('\n【背景色（x=2%）纵向采样】');
  for (const fy of [0.01, 0.08, 0.15, 0.22, 0.3, 0.38, 0.5, 0.62, 0.7, 0.78, 0.85, 0.92, 0.97, 0.995]) {
    const y = Math.min(s.h - 1, Math.round(s.h * fy));
    console.log(`  y=${(fy * 100).toFixed(1).padStart(5)}%  ${hex(...px(s, Math.round(s.w * 0.02), y))}`);
  }

  // 2) 白卡外接框：统计每一行的白色像素数与左右边界
  console.log('\n【白色卡片垂直分布（每 4% 一行：白像素占比 / 左缘% / 右缘%）】');
  for (let fy = 0; fy <= 1.0001; fy += 0.04) {
    const y = Math.min(s.h - 1, Math.round(s.h * fy));
    let count = 0, left = -1, right = -1;
    for (let x = 0; x < s.w; x++) {
      if (isWhite(px(s, x, y))) {
        count++;
        if (left < 0) left = x;
        right = x;
      }
    }
    const pct = ((count / s.w) * 100).toFixed(1);
    const l = left < 0 ? '-' : ((left / s.w) * 100).toFixed(1);
    const r = right < 0 ? '-' : ((right / s.w) * 100).toFixed(1);
    console.log(`  y=${(fy * 100).toFixed(0).padStart(3)}%  白占比 ${pct.padStart(5)}%  左 ${l.padStart(5)}%  右 ${r.padStart(5)}%`);
  }

  // 3) 卡片圆角：在卡片顶部区域左右边缘的白色起始 x（连续 3 行取最大）
  console.log('\n【卡片上沿：逐行首白像素 x(%)】');
  let cardTop = -1;
  for (let y = 0; y < s.h; y++) {
    let count = 0;
    for (let x = 0; x < s.w; x++) if (isWhite(px(s, x, y))) count++;
    if (count / s.w > 0.5) { cardTop = y; break; }
  }
  if (cardTop >= 0) {
    console.log(`  卡片顶部 y=${cardTop} (${((cardTop / s.h) * 100).toFixed(1)}%)`);
    for (let k = 0; k < 14; k++) {
      const y = cardTop + k;
      if (y >= s.h) break;
      let left = -1;
      for (let x = 0; x < s.w; x++) if (isWhite(px(s, x, y))) { left = x; break; }
      console.log(`   +${String(k).padStart(2)}px  首白 x=${left < 0 ? '-' : ((left / s.w) * 100).toFixed(1) + '%'}`);
    }
  } else {
    console.log('  未找到大块白卡');
  }

  // 4) 文字行密度剖面（统计非背景像素，按行聚合，找出文字带）
  console.log('\n【文字带剖面（每 2% 一行：非背景像素数）】');
  const bg = px(s, Math.round(s.w * 0.02), 4);
  for (let fy = 0; fy <= 1.0001; fy += 0.02) {
    const y = Math.min(s.h - 1, Math.round(s.h * fy));
    let n = 0;
    for (let x = 0; x < s.w; x++) {
      const c = px(s, x, y);
      if (!isNear(c, hex(...bg))) n++;
    }
    const bar = '█'.repeat(Math.min(60, Math.round((n / s.w) * 60)));
    console.log(`  y=${(fy * 100).toFixed(0).padStart(3)}%  ${String(n).padStart(4)} ${bar}`);
  }

  // 5) 统计整图主要颜色
  const hist = new Map<string, number>();
  for (let y = 0; y < s.h; y += 2) {
    for (let x = 0; x < s.w; x += 2) {
      const c = px(s, x, y);
      const key = hex(c[0], c[1], c[2]);
      hist.set(key, (hist.get(key) ?? 0) + 1);
    }
  }
  console.log('\n【Top 12 颜色】');
  [...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    .forEach(([c, n]) => console.log(`  ${c}  ${n}`));
}

const files = process.argv.slice(2);
for (const f of files) report(f, await load(f));
