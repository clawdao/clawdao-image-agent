// @ts-nocheck
/**
 * tmp-bg-compare.ts —— 临时：对比参考图与当前产出的背景色分布（极光位置/地台）
 * 用法：bun run scripts/tmp-bg-compare.ts <ref.png> <out.png>
 */
import sharp from 'sharp';

async function sample(file: string) {
  const { data, info } = await sharp(file).raw().toBuffer({ resolveWithObject: true });
  return { data, info };
}

const ref = await sample(process.argv[2] ?? '.clawdao-uploads/att-1792595332920-h7grkb.png');
const out = await sample(process.argv[3] ?? 'outputs/poster/live-cover.png');

const ys = [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95];
const xs = [0.02, 0.1, 0.25, 0.5, 0.75, 0.9, 0.98];

const px = (s: typeof ref, fx: number, fy: number) => {
  const i = (Math.round(s.info.height * fy) * s.info.width + Math.round(s.info.width * fx)) * s.info.channels;
  return [s.data[i], s.data[i + 1], s.data[i + 2]];
};

console.log('y%    | 参考图 RGB (x=2% 25% 50% 75% 98%)');
for (const y of ys) {
  const cells = xs.map((x) => px(ref, x, y).join(','));
  console.log(`${(y * 100).toFixed(0).padStart(3)}%  | ${cells.join('  ')}`);
}
console.log('');
console.log('y%    | 当前产出 RGB');
for (const y of ys) {
  const cells = xs.map((x) => px(out, x, y).join(','));
  console.log(`${(y * 100).toFixed(0).padStart(3)}%  | ${cells.join('  ')}`);
}
