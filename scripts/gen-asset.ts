/**
 * gen-asset.ts — **其它视觉素材的统一生成入口**
 *
 * 以前每种素材一个脚本（gen-top-banner / gen-center-banner / gen-brand-lobster /
 * cutout-brand / preview-top-banner），加一种素材就得加一个脚本。
 * 现在：**一份脚本 + N 份配置**。
 *
 * 用法：
 *   bun run scripts/gen-asset.ts --list                              # 列出所有素材配置
 *   bun run scripts/gen-asset.ts --config configs/assets/top-banner.yaml
 *   bun run scripts/gen-asset.ts top-banner --title "新标题" --subtitle "副标题" --count 3
 *   bun run scripts/gen-asset.ts top-banner --tone blue_purple
 *   bun run scripts/gen-asset.ts top-banner --preview          # 零成本本地排版预览（不调 API）
 *   bun run scripts/gen-asset.ts brand-lobster --count 2
 *   bun run scripts/gen-asset.ts brand-cutout --input public/brand/lobster.png
 *
 * 新增一种素材 = 在 configs/assets/ 下加一个 YAML（必要时在 PIPELINES 里加一段流水线）。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { parseArgs, pickCount } from './args';
import { loadConfig, resolveRefs } from './lib/config';
import { smartGenerate, generateImage } from '../src/lib/image-generator';
import { composeBanner, resolveBrandAsset, defaultBrandAssetDir } from '../src/lib/banner-compositor';
import { applyTextOverlay, buildTextOverlaySvg } from '../src/lib/text-overlay';
import type { ColorTone } from '../src/types/index';

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */
const ASSET_CONFIG_DIR = './configs/assets';

interface AssetConfig {
  id: string;
  label?: string;
  pipeline: 'banner' | 'ip-master' | 'cutout' | 'badge' | 'preview';
  outputDir?: string;
  fileNamePrefix?: string;
  format?: 'jpg' | 'png';
  target?: { width: number; height: number };
  tone?: ColorTone;
  layout?: 'left' | 'center';
  variantCount?: number;
  aspectRatio?: string;
  prompt?: string;
  background?: { darken?: number; saturation?: number };
  ip?: {
    enabled?: boolean;
    dir?: string;
    asset?: string;
    heightRatio?: number;
    rightMargin?: number;
  };
  overlay?: { category?: string; title?: string; subtitle?: string };
  assetDir?: string;
  copyDir?: string;
  input?: string;
  output?: string;
  orangeMin?: number;
  orangeFull?: number;
  saturationMin?: number;
  /** badge 流水线：画布尺寸 / 圆角 / 底色 / 剪影色 / 剪影内缩 */
  size?: number;
  radius?: number;
  bg?: string;
  fg?: string;
  inset?: number;
}

function listAssetConfigs(): string[] {
  if (!existsSync(resolve(ASSET_CONFIG_DIR))) return [];
  const { readdirSync } = require('node:fs');
  return readdirSync(resolve(ASSET_CONFIG_DIR))
    .filter((name) => /\.(ya?ml|json)$/i.test(name))
    .map((name) => name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/* ------------------------------------------------------------------ */
/* API Key                                                             */
/* ------------------------------------------------------------------ */
function resolveApiKey(): string {
  if (process.env.MINIMAX_CN_API_KEY?.trim()) return process.env.MINIMAX_CN_API_KEY.trim();
  if (process.env.MINIMAX_API_KEY?.trim()) return process.env.MINIMAX_API_KEY.trim();
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.clawdao/auth.json'), 'utf-8'));
    for (const key of ['minimax-cn', 'minimax(cn)', 'minimax']) {
      const entry = auth[key];
      const value = entry?.apiKey ?? entry?.key ?? entry?.token;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    /* ignore */
  }
  throw new Error('未找到 MiniMax API Key（.env 或 ~/.clawdao/auth.json）');
}

/* ------------------------------------------------------------------ */
/* 命令行                                                              */
/* ------------------------------------------------------------------ */
const { positional, flags } = parseArgs(process.argv.slice(2));

if (flags.list || positional.includes('--list')) {
  console.log(`素材配置目录：${ASSET_CONFIG_DIR}`);
  for (const id of listAssetConfigs()) {
    const loaded = loadConfig<AssetConfig>(join(ASSET_CONFIG_DIR, `${id}.yaml`));
    console.log(`  ${id.padEnd(16)} ${loaded.data.label ?? ''}（pipeline: ${loaded.data.pipeline}）`);
  }
  process.exit(0);
}

const configId =
  flags.config ?? flags.c ?? positional.find((value) => !value.startsWith('-')) ?? 'top-banner';
const configPath = existsSync(configId)
  ? configId
  : ['yaml', 'yml', 'json'].map((ext) => join(ASSET_CONFIG_DIR, `${configId}.${ext}`)).find((p) => existsSync(p));

if (!configPath) {
  throw new Error(`找不到素材配置：${configId}\n可用配置：${listAssetConfigs().join('、')}`);
}

const loaded = loadConfig<AssetConfig>(configPath);
const config = resolveRefs(loaded.data) as AssetConfig;

/* ------------------------------------------------------------------ */
/* 命令行覆盖                                                          */
/* ------------------------------------------------------------------ */
const title = flags.title ?? config.overlay?.title ?? '';
const subtitle = flags.subtitle !== undefined ? flags.subtitle : config.overlay?.subtitle ?? '';
const variantCount = flags.count
  ? pickCount(flags, [], 'count', 5, 1)
  : Math.max(1, Math.min(5, config.variantCount ?? 1));
const tone = (flags.tone ?? config.tone ?? 'black_gold') as ColorTone;
const layout = config.layout ?? 'left';

console.log(`素材配置：${loaded.relPath}（${config.label ?? config.id}）`);
console.log(`流水线：${config.pipeline}`);

/* ------------------------------------------------------------------ */
/* 流水线                                                              */
/* ------------------------------------------------------------------ */

async function runBanner(): Promise<void> {
  // --preview：零成本本地预览排版（不调 API），用于快速校验断行 / 艺术字效果
  if (flags.preview) {
    await runPreview();
    return;
  }

  const width = config.target?.width ?? 1920;
  const height = config.target?.height ?? 320;
  const category = (config.overlay?.category ?? 'top_banner') as any;

  const result = await smartGenerate({
    category,
    theme: { title, subtitle: subtitle || undefined },
    customPrompt: config.prompt ?? '',
    aspectRatio: (config.aspectRatio ?? '21:9') as any,
    variantCount,
    config: {
      apiKey: resolveApiKey(),
      baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
    },
  });

  const images = result.base64 ?? result.images;
  if (!images?.length) throw new Error('image-01 未返回图像数据');

  const ipAssetPath =
    config.ip?.enabled && config.ip.asset
      ? resolveBrandAsset(resolve(config.ip.dir ?? defaultBrandAssetDir()), config.ip.asset)
      : null;
  if (config.ip?.enabled && !ipAssetPath) {
    console.warn('⚠️ 未找到 IP 抠图稿，输出将不含吉祥物');
  }

  const outputDir = config.outputDir ?? './outputs';
  mkdirSync(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const written: string[] = [];

  for (let index = 0; index < images.length; index++) {
    const raw = Buffer.from(images[index], 'base64');

    const composed = await composeBanner(raw, {
      width,
      height,
      ipAssetPath,
      colorTone: tone,
      darken: config.background?.darken ?? 0.8,
    });

    const overlaid = await applyTextOverlay(composed.buffer, {
      category,
      theme: { title, subtitle: subtitle || undefined },
      colorTone: tone,
      layout,
    });

    const suffix = images.length > 1 ? `-${index}` : '';
    const outPath = join(outputDir, `${config.fileNamePrefix ?? config.id}-${stamp}${suffix}.${config.format ?? 'jpg'}`);
    writeFileSync(outPath, overlaid.buffer);
    written.push(outPath);
    console.log(`  ✅ ${outPath} (${overlaid.width}×${overlaid.height}, IP=${composed.ipApplied ? '已贴入' : '无'})`);
  }

  console.log('\n完成：');
  for (const path of written) console.log(`  ${path}`);
}

async function runIpMaster(): Promise<void> {
  const result = await generateImage(
    {
      prompt: config.prompt ?? '',
      aspectRatio: (config.aspectRatio ?? '1:1') as any,
      n: variantCount,
      responseFormat: 'base64',
    },
    {
      apiKey: resolveApiKey(),
      baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
    },
  );

  const images = result.base64 ?? result.images;
  if (!images?.length) throw new Error('image-01 未返回图像数据');

  const assetDir = config.assetDir ?? 'public/brand';
  const copyDir = config.copyDir ?? './outputs/_brand';
  mkdirSync(assetDir, { recursive: true });
  mkdirSync(copyDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  for (let index = 0; index < images.length; index++) {
    const buffer = Buffer.from(images[index], 'base64');
    const meta = await sharp(buffer).metadata();
    const name = `${config.fileNamePrefix ?? 'lobster'}-${stamp}-${index}.png`;
    await sharp(buffer).png().toFile(join(assetDir, name));
    writeFileSync(join(copyDir, name), buffer);
    console.log(`  ✅ ${join(assetDir, name)} (${meta.width}×${meta.height})`);
  }
}

async function runCutout(): Promise<void> {
  const input = flags.input ?? config.input ?? 'public/brand/lobster.png';
  const output = flags.output ?? config.output ?? 'public/brand/lobster-cutout.png';

  const O_MIN = config.orangeMin ?? 18;
  const O_FULL = config.orangeFull ?? 52;
  const S_MIN = config.saturationMin ?? 26;

  const source = sharp(readFileSync(input));
  const { width, height } = await source.metadata();
  if (!width || !height) throw new Error('无法读取图片尺寸');

  const { data } = await source.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  const out = Buffer.alloc(width * height * 4);
  let kept = 0;

  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const o = r - b;
    const s = Math.max(r, g, b) - Math.min(r, g, b);

    let alpha = 0;
    if (o > O_MIN && s > S_MIN) {
      alpha = Math.min(1, (o - O_MIN) / (O_FULL - O_MIN));
      // 暗部保留更多，避免阴影丢失
      if (g < r * 0.62) alpha = Math.min(1, alpha * 1.25 + 0.15);
    }

    const a = Math.round(alpha * 255);
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = a;
    if (a > 8) kept += 1;
  }

  await sharp(out, { raw: { width, height, channels: 4 } }).png().toFile(output);
  console.log(`  ✅ ${output} ${width}×${height}，主体像素占比 ${((kept / (width * height)) * 100).toFixed(1)}%`);
}

async function runBadge(): Promise<void> {
  const input = flags.input ?? config.input ?? 'public/brand/lobster-cutout.png';
  const output = flags.output ?? config.output ?? 'public/brand/lobster-badge.png';

  const size = config.size ?? 512;
  const radius = config.radius ?? size * 0.24;
  const bg = config.bg ?? '#F2622E';
  const fg = config.fg ?? '#FFFFFF';
  const inset = config.inset ?? size * 0.16;

  // 1) 白色剪影：抠图只取 alpha，填成前景色
  const cut = sharp(readFileSync(input)).ensureAlpha();
  const meta = await cut.metadata();
  if (!meta.width || !meta.height) throw new Error('无法读取图片尺寸');
  const { data } = await cut.raw().toBuffer({ resolveWithObject: true });
  const silhouette = Buffer.alloc(meta.width * meta.height * 4);
  for (let i = 0; i < meta.width * meta.height; i++) {
    const a = data[i * 4 + 3];
    silhouette[i * 4] = 0;
    silhouette[i * 4 + 1] = 0;
    silhouette[i * 4 + 2] = 0;
    silhouette[i * 4 + 3] = a;
  }
  const fgColor = fg.replace('#', '');
  const fgR = parseInt(fgColor.slice(0, 2), 16);
  const fgG = parseInt(fgColor.slice(2, 4), 16);
  const fgB = parseInt(fgColor.slice(4, 6), 16);
  for (let i = 0; i < meta.width * meta.height; i++) {
    silhouette[i * 4] = fgR;
    silhouette[i * 4 + 1] = fgG;
    silhouette[i * 4 + 2] = fgB;
  }

  // 2) 缩放剪影到画布内
  const inner = Math.round(size - inset * 2);
  const scale = Math.min(inner / meta.width, inner / meta.height);
  const scaled = await sharp(silhouette, { raw: { width: meta.width, height: meta.height, channels: 4 } })
    .resize(Math.round(meta.width * scale), Math.round(meta.height * scale), { fit: 'inside' })
    .png()
    .toBuffer();

  // 3) 橙色圆角底板 + 居中剪影
  const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${bg}"/>
</svg>`;

  await sharp(Buffer.from(bgSvg))
    .composite([
      {
        input: scaled,
        left: Math.round((size - (await sharp(scaled).metadata()).width!) / 2),
        top: Math.round((size - (await sharp(scaled).metadata()).height!) / 2),
      },
    ])
    .png()
    .toFile(output);
  console.log(`  ✅ ${output} ${size}×${size}（圆角角标 ${bg} + ${fg} 剪影）`);
}

async function runPreview(): Promise<void> {
  const width = config.target?.width ?? 1920;
  const height = config.target?.height ?? 320;
  const category = (config.overlay?.category ?? 'top_banner') as any;

  const svg = buildTextOverlaySvg(category, { title }, width, height, tone, layout);
  const lines = [...svg.matchAll(/<tspan[^>]*>([^<]*)<\/tspan>/g)].map((m) => m[1]);
  console.log(`标题行数=${lines.length} →`, JSON.stringify(lines));

  const bg = await sharp({
    create: { width, height, channels: 3, background: '#1f1f23' },
  })
    .png()
    .toBuffer();
  const outPath = join(config.outputDir ?? './outputs', `_preview-${config.id}-${tone}.png`);
  mkdirSync(config.outputDir ?? './outputs', { recursive: true });
  await sharp(bg).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toFile(outPath);
  console.log(`  ✅ 预览已输出 → ${outPath}`);
}

switch (config.pipeline) {
  case 'banner':
    await runBanner();
    break;
  case 'ip-master':
    await runIpMaster();
    break;
  case 'cutout':
    await runCutout();
    break;
  case 'badge':
    await runBadge();
    break;
  case 'preview':
    await runPreview();
    break;
  default:
    throw new Error(`未知流水线：${config.pipeline}（支持 banner / ip-master / cutout / badge / preview）`);
}
