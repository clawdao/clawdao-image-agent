/**
 * banner-compositor.ts — 广告条底图合成（第二段流水线）
 *
 * 为什么需要它：
 *   image-01 在 21:9 宽幅里必然把吉祥物画成大特写、压住标题区，
 *   所以最终素材走三段式：AI 出纯背景 → 本地贴 IP 资产 → 本地叠字。
 *   本模块负责第二段，并顺手把底图裁到 preset 声明的目标尺寸。
 *
 * 复用方：src/app-server/task-manager.ts（应用主链路）+ scripts/gen-top-banner.ts（一次性出图）
 */

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import type { ColorTone } from '../types/index';

export interface ComposeBannerOptions {
  /** 目标宽（一般取 preset.size.w） */
  width: number;
  /** 目标高（一般取 preset.size.h） */
  height: number;
  /** 透明 IP 资产路径（PNG，带 alpha）；为空或文件不存在则跳过 IP 合成 */
  ipAssetPath?: string | null;
  colorTone?: ColorTone;
  /** 背景压暗系数 0~1，默认 0.8 —— 压暗后 IP 与文字更突出 */
  darken?: number;
  /** IP 主体高度占画面比例，默认 0.8 */
  ipHeightRatio?: number;
  /** IP 距右边缘留白占宽比例，默认 0.025 */
  ipRightMargin?: number;
}

export interface ComposeBannerResult {
  buffer: Buffer;
  width: number;
  height: number;
  /** 是否真的贴上了 IP 资产 */
  ipApplied: boolean;
}

/** 品牌资产目录（IP 抠图稿等） */
export function defaultBrandAssetDir(): string {
  return resolve(process.cwd(), 'public/brand');
}

/** 在品牌资产目录里找一个文件，不存在返回 null（不抛错，调用方按“无 IP”降级） */
export function resolveBrandAsset(dir: string, file: string): string | null {
  const path = join(dir, file);
  return existsSync(path) ? path : null;
}

const GLOW_BY_TONE: Record<ColorTone, string> = {
  black_gold: '#FFB347',
  blue_purple: '#9B8CFF',
};

export async function composeBanner(
  raw: Buffer,
  options: ComposeBannerOptions,
): Promise<ComposeBannerResult> {
  const {
    width,
    height,
    ipAssetPath,
    colorTone = 'black_gold',
    darken = 0.8,
    ipHeightRatio = 0.8,
    ipRightMargin = 0.025,
  } = options;

  // 1) 裁切 + 调色：AI 出的是 21:9 等原始比例，广告条需要 preset 声明的目标尺寸
  let background = await sharp(raw)
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .modulate({ brightness: darken, saturation: 0.88 })
    .png()
    .toBuffer();

  const ipPath = ipAssetPath && existsSync(ipAssetPath) ? ipAssetPath : null;
  if (!ipPath) {
    return { buffer: background, width, height, ipApplied: false };
  }

  // 2) IP 资产：trim 掉透明画布，主体才能真正占满给定高度
  const ipRaw = await sharp(ipPath).png().toBuffer();
  const ipTrimmed = await sharp(ipRaw).trim({ threshold: 12 }).png().toBuffer();
  const ipMeta = await sharp(ipTrimmed).metadata();
  if (!ipMeta.width || !ipMeta.height) {
    return { buffer: background, width, height, ipApplied: false };
  }

  // IP 尺寸：高度按比例，但宽度必须有上限（竖屏 cover 下按高度算会超出画布）
  const maxIpWidth = Math.max(1, Math.round(width * 0.62));
  let ipHeight = Math.round(height * ipHeightRatio);
  let ipWidth = Math.round((ipHeight * ipMeta.width) / ipMeta.height);
  if (ipWidth > maxIpWidth) {
    ipWidth = maxIpWidth;
    ipHeight = Math.round((ipWidth * ipMeta.height) / ipMeta.width);
  }
  const ipLeft = Math.max(0, width - ipWidth - Math.round(width * ipRightMargin));
  const ipTop = Math.max(0, Math.round((height - ipHeight) / 2));

  const ipLayer = await sharp(ipTrimmed)
    .resize(ipWidth, ipHeight, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  // 3) 暖金轮廓光：IP 外扩模糊垫在角色后面（要弥散，不能出现人形光圈）
  const glowW = Math.min(Math.round(ipWidth * 1.3), ipWidth + Math.round(width * 0.05), width);
  const glowH = Math.min(Math.round(ipHeight * 1.3), height - 6, height);
  const glowRaw = await sharp(ipTrimmed)
    .resize(glowW, glowH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .blur(Math.max(14, Math.round(ipHeight * 0.08)))
    .tint(GLOW_BY_TONE[colorTone] ?? GLOW_BY_TONE.black_gold)
    .ensureAlpha(0.22)
    .png()
    .toBuffer();

  // 光晕以 IP 为中心外扩，必须先裁到画布内才能 composite
  const glowLeft = ipLeft - Math.round((glowW - ipWidth) / 2);
  const glowTop = ipTop - Math.round((glowH - ipHeight) / 2);
  const clipX = Math.max(0, glowLeft);
  const clipY = Math.max(0, glowTop);
  const clipW = Math.min(glowW, width - clipX);
  const clipH = Math.min(glowH, height - clipY);
  const glowLayer = await sharp(glowRaw)
    .extract({ left: clipX - glowLeft, top: clipY - glowTop, width: clipW, height: clipH })
    .png()
    .toBuffer();

  const composed = await sharp(background)
    .composite([
      { input: glowLayer, left: clipX, top: clipY },
      { input: ipLayer, left: ipLeft, top: ipTop },
    ])
    .png()
    .toBuffer();

  return { buffer: composed, width, height, ipApplied: true };
}
