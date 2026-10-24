/**
 * poster-pipeline.ts — 通用海报渲染流水线（本地排版 + 落盘）
 *
 * 流水线：
 *   配置 blocks → （可选）AI 生成主视觉 → 本地 SVG 排版 → sharp 合成 → 落盘
 *
 * 为什么文字全部本地渲染：
 *   image-01 画中文会出形近乱码，海报上的字必须逐字准确。
 *   主视觉（插画 / 产品图）才交给 AI，文字永远本地出。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
  renderPoster,
  type PosterBlock,
  type PosterBrand,
  type PosterCornerMark,
  type PosterTone,
} from '../../src/lib/poster-renderer';
import { generateImage } from '../../src/lib/image-generator';
import type { PosterAnchor, PosterBackground } from './poster-config';

/* ------------------------------------------------------------------ */
/* 资源内联                                                            */
/* ------------------------------------------------------------------ */

/** 格式 → mime / 扩展名 */
const MIME_BY_FORMAT: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
  avif: { mime: 'image/avif', ext: 'avif' },
  tiff: { mime: 'image/tiff', ext: 'tiff' },
  svg: { mime: 'image/svg+xml', ext: 'svg' },
};

/** 探测图片真实格式（不信任扩展名：image-01 返回的其实是 JPEG） */
export async function detectImageFormat(
  filePath: string | Buffer,
): Promise<{ mime: string; ext: string }> {
  if (typeof filePath === 'string' && filePath.startsWith('data:')) {
    const match = filePath.match(/^data:([^;]+)/);
    const mime = match?.[1] ?? 'image/png';
    return { mime, ext: mime.includes('jpeg') ? 'jpg' : mime.split('/')[1] ?? 'png' };
  }
  try {
    const meta = await sharp(filePath).metadata();
    const found = MIME_BY_FORMAT[meta.format ?? 'png'];
    if (found) return found;
  } catch {
    /* 探测失败则按扩展名猜 */
  }
  const lower = typeof filePath === 'string' ? filePath.toLowerCase() : '';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return MIME_BY_FORMAT.jpeg;
  if (lower.endsWith('.webp')) return MIME_BY_FORMAT.webp;
  if (lower.endsWith('.svg')) return MIME_BY_FORMAT.svg;
  return MIME_BY_FORMAT.png;
}

/** 本地图片路径 → data URI */
export async function toDataUri(filePath: string): Promise<string> {
  if (filePath.startsWith('data:')) return filePath;
  if (!existsSync(filePath)) throw new Error(`图片资源不存在：${filePath}`);
  const { mime } = await detectImageFormat(filePath);
  const data = readFileSync(filePath).toString('base64');
  return `data:${mime};base64,${data}`;
}

/**
 * 裁掉 PNG 的透明边（抠图素材四周通常留白，直接摆上去会显得小）。
 * trim: true 时生效；不改变原文件，只在内存里处理。
 */
async function trimmedDataUri(filePath: string): Promise<string> {
  if (filePath.startsWith('data:')) return filePath;
  const buffer = await sharp(filePath).trim({ threshold: 10 }).png().toBuffer();
  return `data:image/png;base64,${buffer.toString('base64')}`;
}
/** 把块里所有本地图片路径内联成 data URI */
export async function inlinePosterAssets(blocks: PosterBlock[]): Promise<PosterBlock[]> {
  const out: PosterBlock[] = [];

  for (const block of blocks) {
    const b = block as any;
    switch (b.kind) {
      case 'profile':
        out.push(
          b.profile?.avatar
            ? { ...b, profile: { ...b.profile, avatar: await toDataUri(b.profile.avatar) } }
            : b,
        );
        break;
      case 'features':
        out.push(
          b.items?.some((item: any) => item.icon)
            ? {
                ...b,
                items: await Promise.all(
                  b.items.map(async (item: any) =>
                    item.icon ? { ...item, icon: await toDataUri(item.icon) } : item,
                  ),
                ),
              }
            : b,
        );
        break;
      case 'qr':
        out.push(b.src ? { ...b, src: await toDataUri(b.src) } : b);
        break;
      case 'visual':
        out.push(
          b.src
            ? { ...b, src: b.trim ? await trimmedDataUri(b.src) : await toDataUri(b.src) }
            : b,
        );
        break;
      case 'panel':
        out.push({ ...b, blocks: await inlinePosterAssets(b.blocks ?? []) });
        break;
      default:
        out.push(b);
    }
  }

  return out;
}

/** 品牌位里的 Logo 内联 */
export async function inlinePosterBrand(brand?: PosterBrand): Promise<PosterBrand | undefined> {
  if (!brand?.logo) return brand;
  return { ...brand, logo: await toDataUri(brand.logo) };
}

/** 右下角角标里的 Logo 内联 */
export async function inlinePosterCornerMark(
  mark?: PosterCornerMark,
): Promise<PosterCornerMark | undefined> {
  if (!mark?.logo) return mark;
  return { ...mark, logo: await toDataUri(mark.logo) };
}

/* ------------------------------------------------------------------ */
/* AI 主视觉                                                            */
/* ------------------------------------------------------------------ */

export interface AiVisualOptions {
  apiKey: string;
  baseUrl?: string;
  /** 视觉图的宽高比（image-01 支持 1:1 / 16:9 / 9:16 / 21:9 / 5:4） */
  aspectRatio?: '1:1' | '16:9' | '9:16' | '21:9' | '5:4';
  /** 落盘目录（生成的原图留档） */
  assetDir: string;
  /** 文件名（不含扩展名） */
  fileName: string;
}

/** 给 visual 块生成 AI 主视觉（逐块调用，prompt 里禁止出现文字） */
/**
 * 给图片四周做 alpha 羽化（边缘渐隐），便于与背景无缝衔接。
 *
 * 做法：构造一张“内缩圆角白块 + 模糊”的遮罩，用 dest-in 把原图的 alpha 乘上去。
 */
export async function featherImage(filePath: string, feather: number): Promise<string> {
  const meta = await sharp(filePath).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return filePath;

  const insetX = Math.round(w * feather);
  const insetY = Math.round(h * feather);
  const blur = Math.max(2, Math.round(Math.min(insetX, insetY) * 0.6));

  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<rect x="${insetX}" y="${insetY}" width="${w - insetX * 2}" height="${h - insetY * 2}" ` +
      `rx="${Math.round(insetX * 0.6)}" fill="#ffffff"/>` +
      `</svg>`,
  );

  const outPath = filePath.replace(/\.[a-z0-9]+$/i, '') + '-feather.png';
  const blurredMask = await sharp(mask).blur(blur).png().toBuffer();
  await sharp(filePath)
    .composite([{ input: blurredMask, blend: 'dest-in' }])
    .png()
    .toFile(outPath);
  return outPath;
}

export async function fillAiVisuals(
  blocks: PosterBlock[],
  options: AiVisualOptions & { promptSuffix?: string },
): Promise<PosterBlock[]> {
  const out: PosterBlock[] = [];
  const needsDir = blocks.some((block) => (block as any).kind === 'visual' && (block as any).aiPrompt);
  if (needsDir) mkdirSync(options.assetDir, { recursive: true });

  for (const block of blocks) {
    const b = block as any;
    if (b.kind !== 'visual' || !b.aiPrompt) {
      out.push(block);
      continue;
    }

    const prompt = `${b.aiPrompt}${options.promptSuffix ?? ''}`;
    const result = await generateImage(
      {
        prompt,
        aspectRatio: b.aiAspect ?? options.aspectRatio ?? '16:9',
        n: 1,
        responseFormat: 'base64',
      },
      { apiKey: options.apiKey, baseUrl: options.baseUrl ?? 'https://api.minimaxi.com' },
    );

    const base64 = result.base64?.[0] ?? result.images?.[0];
    if (!base64) throw new Error('image-01 未返回图像数据');

    const buffer = Buffer.from(base64, 'base64');
    // image-01 返回的其实是 JPEG，不能只改扩展名——按真实格式落盘，
    // 否则内联成 data:image/png 时 librsvg 解不开（画面会整块消失）
    const { ext } = await detectImageFormat(buffer);
    const assetPath = join(
      options.assetDir,
      `${options.fileName}-${Math.random().toString(36).slice(2, 8)}.${ext}`,
    );
    writeFileSync(assetPath, buffer);

    // 边缘羽化：AI 图自带不透明底色，直接贴上去会出现硬矩形边。
    // 这里把四周 alpha 渐隐，让主视觉融进极光背景。
    const feathered = b.feather ? await featherImage(assetPath, b.feather) : assetPath;

    out.push({ ...b, src: await toDataUri(feathered) } as PosterBlock);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* 渲染 + 落盘                                                        */
/* ------------------------------------------------------------------ */

export interface RenderPosterOptions {
  blocks: PosterBlock[];
  brand?: PosterBrand;
  cornerMark?: PosterCornerMark;
  tone?: PosterTone;
  background?: PosterBackground;
  /** 排版基准宽度（默认 = 成品宽度） */
  width: number;
  /** 目标成品尺寸（不给高度 = 高度随内容增长） */
  size?: { width: number; height?: number };
  anchor?: PosterAnchor;
  /** 画布内边距（成品像素） */
  padding?: { top?: number; bottom?: number };
  outPath: string;
  format?: 'png' | 'jpg';
  /** 背景图（background='none' 时垫在文字下面） */
  backgroundImage?: Buffer;
}

export interface RenderPosterResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
}

export async function renderPosterToFile(options: RenderPosterOptions): Promise<RenderPosterResult> {
  const width = options.size?.width ?? options.width;
  const height = options.size?.height;

  const poster = renderPoster(await inlinePosterAssets(options.blocks), {
    width: options.width,
    tone: options.tone,
    background: options.background,
    fit: height ? { width, height, anchor: options.anchor ?? 'center' } : undefined,
    brand: await inlinePosterBrand(options.brand),
    cornerMark: await inlinePosterCornerMark(options.cornerMark),
    padding: options.padding,
  });

  const base = options.backgroundImage
    ? await sharp(options.backgroundImage)
        .resize(poster.width, poster.height, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer()
    : await sharp({
        create: {
          width: poster.width,
          height: poster.height,
          channels: 4,
          background: { r: 255, g: 255, b: 255, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

  const composed = await sharp(base)
    .composite([{ input: Buffer.from(poster.svg), top: 0, left: 0 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  const format = options.format ?? 'png';
  const final =
    format === 'jpg'
      ? await sharp(composed).flatten({ background: '#FFFFFF' }).jpeg({ quality: 92 }).toBuffer()
      : composed;

  writeFileSync(options.outPath, final);

  return {
    path: options.outPath,
    width: poster.width,
    height: poster.height,
    bytes: final.length,
  };
}
