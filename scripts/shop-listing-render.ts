/**
 * shop-listing-render.ts — 商品图渲染与落盘的共享流水线（V2 / V3 共用）
 *
 * 为什么抽成共享模块：
 *   V3（合规版）与 V2（暖色版）是两条并存的产品线，视觉规范完全一致，
 *   只有文案内容不同。渲染逻辑只有一份，避免两套代码各自漂移。
 *
 * 流水线：
 *   renderPoster（本地程序化暖色背景 + 本地中文排版）→ sharp 合成落盘
 *
 * 为什么默认不用 AI 底图：
 *   image-01 会在背景角落自作主张画伪中文（形近乱码），商品图出现乱码是硬伤；
 *   暖色版需要精确的米金配色，AI 底图也压不准，所以默认走本地程序化背景。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { smartGenerate } from '../src/lib/image-generator';
import { renderPoster, type PosterBlock, type PosterTone, type PosterBrand } from '../src/lib/poster-renderer';
import { getPosterTheme, type PosterTheme } from '../src/lib/poster-themes';

export interface ShopPosterSpec {
  /** 输出文件名（不含扩展名） */
  file: string;
  /** 排版基准宽度 */
  width: number;
  /** 目标成品尺寸（不填 = 高度随内容自然增长） */
  fit?: { width: number; height: number };
  /** 色调（不填 = 取主题对应档位） */
  tone?: PosterTone;
  /** 主题档位：主视觉 / 浅底纯色 / 深底纯色 */
  themeSlot?: keyof Pick<PosterTheme, 'main' | 'plainLight' | 'plainDeep'>;
  /** 顶部光晕横向位置（0~1） */
  glowX?: number;
  /**
   * 背景模式（不填 = 取主题对应档位）：
   * - gradient：品牌程序化背景
   * - organic：有机背景（清新绿方案）
   * - solid：纯色平涂底（视频号小店「纯色底图」场景）
   */
  background?: 'gradient' | 'none' | 'solid' | 'organic';
  /** 右上角品牌位（Logo + 品牌名） */
  brand?: PosterBrand;
  blocks: PosterBlock[];
}

/** 把内容里的本地图片路径（如头像）内联成 data URI */
export function inlineAssets(blocks: PosterBlock[]): PosterBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'profile') return block;
    const avatar = block.profile.avatar;
    if (!avatar || avatar.startsWith('data:')) return block;
    if (!existsSync(avatar)) throw new Error(`图片资源不存在：${avatar}`);
    const mime = avatar.toLowerCase().endsWith('.jpg') || avatar.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
    const data = readFileSync(avatar).toString('base64');
    return { ...block, profile: { ...block.profile, avatar: `data:image/${mime};base64,${data}` } };
  });
}

/** 把品牌位里的本地 Logo 路径内联成 data URI */
export function inlineBrand(brand?: PosterBrand): PosterBrand | undefined {
  if (!brand?.logo || brand.logo.startsWith('data:')) return brand;
  if (!existsSync(brand.logo)) throw new Error(`品牌 Logo 不存在：${brand.logo}`);
  const mime = brand.logo.toLowerCase().endsWith('.jpg') || brand.logo.toLowerCase().endsWith('.jpeg') ? 'jpeg' : 'png';
  const data = readFileSync(brand.logo).toString('base64');
  return { ...brand, logo: `data:image/${mime};base64,${data}` };
}

export function resolveApiKey(): string {
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

/**
 * 无字底图提示词（仅 --with-ai-bg 实验模式使用）。
 * 暖色版底图：奶油米暖光空间，只出质感与光效，所有文字由本地排版层叠加。
 */
export const BG_SQUARE = `【用途】高端企业培训课程商品主图的纯背景底图，成品会在本地叠加中文排版
【画面】奶油米暖光空间（约 #FFF9F0 的柔光米色），右上角一抹琥珀金（约 #F5A623）的柔光扩散，左下角一抹暖橙（约 #F08A24）的微光，柔和的纸质肌理与极淡光斑，温暖、干净、有人情味
【构图】画面中部偏左保留大面积纯净浅色区域供后期压字，光效只出现在边缘与角落
【禁止】不要文字、字母、数字、Logo、水印、人物、动物、物体、图标、UI 界面、图表、二维码、招牌
【负面提示】文字、字母、数字、logo、水印、人物、动物、物品、图标、界面、图表、复杂背景、杂乱元素`;

export const BG_TALL = `【用途】高端企业培训课程详情长图的纯背景底图，成品会在本地叠加中文排版
【画面】奶油米暖光空间的纵向延伸，顶部有一束柔和的琥珀金光晕向下渐隐，底部有极弱的暖橙微光，柔和光斑与纸感肌理，温暖、极简、克制
【构图】纵向 9:16，中心区域保持纯净浅色，避免任何高频纹理
【禁止】不要文字、字母、数字、Logo、水印、人物、动物、物体、图标、UI 界面、图表、二维码
【负面提示】文字、字母、数字、logo、水印、人物、动物、物品、图标、界面、图表、复杂背景、杂乱元素`;

export interface BgSet {
  square: Buffer[];
  tall: Buffer[];
}

/** 调用 image-01 生成无字底图（实验模式） */
export async function generateBackgrounds(productName: string): Promise<BgSet> {
  const config = {
    apiKey: resolveApiKey(),
    baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
  };

  console.log('[1/3] 调用 image-01 生成 1:1 无字底图 ×3…');
  const square = await smartGenerate({
    category: 'custom',
    theme: { title: productName },
    customPrompt: BG_SQUARE,
    aspectRatio: '1:1',
    variantCount: 3,
    config,
  });

  console.log('[1/3] 调用 image-01 生成 9:16 无字底图 ×2…');
  const tall = await smartGenerate({
    category: 'custom',
    theme: { title: productName },
    customPrompt: BG_TALL,
    aspectRatio: '9:16',
    variantCount: 2,
    config,
  });

  const toBuffers = (result: { base64?: string[]; images: string[] }): Buffer[] =>
    (result.base64 ?? result.images).map((item) => Buffer.from(item, 'base64'));

  return { square: toBuffers(square), tall: toBuffers(tall) };
}

export interface RenderShopListingOptions {
  /** 输出目录（相对 cwd） */
  outDir: string;
  posters: ShopPosterSpec[];
  /** 商品文案 markdown */
  copy: string;
  /** 商品名（AI 底图提示词用） */
  productName: string;
  /** 是否叠加 AI 底图 */
  withAiBg?: boolean;
  /** 商品文案文件名，默认「商品文案.md」 */
  copyFileName?: string;
  /** 配色方案（不填 = 默认「清新绿」） */
  theme?: PosterTheme;
}

/**
 * 渲染全部海报并落盘，返回写出的文件路径列表。
 */
export async function renderShopListing(options: RenderShopListingOptions): Promise<string[]> {
  const { outDir, posters, copy, productName } = options;
  const theme = options.theme ?? getPosterTheme();
  const bgDir = join(outDir, '_bg');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(bgDir, { recursive: true });

  let bgs: BgSet | null = null;
  if (options.withAiBg) {
    console.log('[1/3] 调用 image-01 生成无字底图（叠加用）…');
    bgs = await generateBackgrounds(productName);
    bgs.square.forEach((buf, index) => writeFileSync(join(bgDir, `square-${index}.png`), buf));
    bgs.tall.forEach((buf, index) => writeFileSync(join(bgDir, `tall-${index}.png`), buf));
  } else {
    console.log(`[1/3] 本地程序化背景（方案：${theme.name}，零乱码风险）`);
  }

  console.log('[2/3] 本地排版 + 合成落盘…');
  const written: string[] = [];

  for (const spec of posters) {
    const isTall = spec.width < 900 || (spec.fit?.height ?? 0) > spec.width * 1.2;

    // 主题档位 → 色调 / 背景模式（spec 里的显式值优先）
    const slot = theme[spec.themeSlot ?? 'main'];
    const tone = spec.tone ?? slot.tone;
    const background = spec.background ?? slot.background;

    const poster = renderPoster(inlineAssets(spec.blocks), {
      width: spec.width,
      tone,
      glowX: spec.glowX,
      fit: spec.fit,
      background: bgs ? 'none' : background,
      brand: inlineBrand(spec.brand),
    });

    let base: Buffer;
    if (bgs) {
      const pool = isTall ? bgs.tall : bgs.square;
      const bg = pool[0];
      // 底图：铺满 → 轻度降亮 + 重度模糊，抹掉 AI 的高频噪点与伪文字
      base = await sharp(bg)
        .resize(poster.width, poster.height, { fit: 'cover', position: 'centre' })
        .modulate({ brightness: 1.02, saturation: 0.95 })
        .blur(3)
        .png()
        .toBuffer();
    } else {
      base = await sharp({
        create: {
          width: poster.width,
          height: poster.height,
          channels: 4,
          background: { r: 255, g: 249, b: 240, alpha: 1 },
        },
      })
        .png()
        .toBuffer();
    }

    const out = await sharp(base)
      .composite([{ input: Buffer.from(poster.svg), top: 0, left: 0 }])
      .png({ compressionLevel: 9 })
      .toBuffer();

    const outPath = join(outDir, `${spec.file}.png`);
    writeFileSync(outPath, out);
    written.push(outPath);
    console.log(`  ✅ ${outPath} (${poster.width}×${poster.height}, ${(out.length / 1024).toFixed(0)} KB)`);
  }

  const copyPath = join(outDir, options.copyFileName ?? '商品文案.md');
  writeFileSync(copyPath, copy, 'utf-8');
  written.push(copyPath);
  console.log(`  ✅ ${copyPath}`);

  return written;
}
