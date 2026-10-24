// @ts-nocheck
/**
 * tmp-dump-svg.ts —— 临时：把海报配置的 SVG 落盘，便于逐元素核对版式坐标
 * 用法：bun run scripts/tmp-dump-svg.ts live-cover
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadPosterConfigById } from './lib/poster-config';
import { renderPoster } from '../src/lib/poster-renderer';

const id = process.argv[2] ?? 'live-cover';
const { data: cfg } = loadPosterConfigById(id);
const size = cfg.size ?? { width: 1600, height: 2848 };
const result = renderPoster(cfg.blocks as any, {
  width: size.width,
  tone: cfg.tone,
  background: cfg.background,
  fit: { width: size.width, height: size.height, anchor: cfg.anchor ?? 'center' },
  padding: cfg.padding,
  brand: cfg.brand,
});
mkdirSync('outputs/_tmp', { recursive: true });
writeFileSync('outputs/_tmp/dump.svg', result.svg);
console.log(`已输出 outputs/_tmp/dump.svg（${result.width}×${result.height}）`);

// 打印每个块的 translate y
const matches = [...result.svg.matchAll(/<g transform="translate\(0, ([\d.]+)\)">/g)].map((m) => Number(m[1]));
console.log('各块起始 y：', matches.map((v) => Math.round(v)).join(', '));
