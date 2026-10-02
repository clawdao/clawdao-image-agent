/**
 * image-generator.ts — MiniMax image-01 图像生成客户端
 *
 * 端点：POST https://api.minimaxi.com/v1/image_generation
 * 鉴权：Authorization: Bearer ${MINIMAX_API_KEY}
 *
 * 支持能力：
 *   - 文生图（text-to-image）
 *   - 图生图（image-to-image，含 subject_reference）
 *   - v0.2 一次请求多张（参数 n，1~5）
 *
 * 失败重试：指数退避，最多 3 次
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeImageReference } from './image-source';
import { getPreset } from './presets';

// ============ 类型 ============
export type AspectRatio =
  | '1:1' | '3:2' | '2:3' | '3:4' | '4:3'
  | '16:9' | '9:16' | '21:9' | '5:4';

export interface ImageGenerationOptions {
  prompt: string;
  model?: string;                    // 默认 image-01
  aspectRatio?: AspectRatio;
  n?: number;                         // 生成张数（1~5，默认 1）
  subjectReference?: Array<{
    type: 'character' | 'object';
    imageFile: string;                // URL 或 base64 data URI
  }>;
  responseFormat?: 'url' | 'base64';
  signal?: AbortSignal;
  retries?: number;                   // 默认 3
}

export interface ImageGenerationResult {
  images: string[];                    // URL 列表或 base64 列表
  format: 'url' | 'base64';
  base64?: string[];
}

export interface ImageGeneratorConfig {
  apiKey: string;
  baseUrl?: string;                  // 默认 https://api.minimaxi.com
  outputDir?: string;                 // 默认 ./outputs
  fetchImpl?: typeof fetch;          // 便于测试注入
}

// ============ 默认配置 ============
const DEFAULTS = {
  model: 'image-01',
  aspectRatio: '1:1' as AspectRatio,
  n: 1,
  responseFormat: 'base64' as 'url' | 'base64',
  outputDir: './outputs',
  retries: 3,
};

const MAX_N = 5;  // image-01 一次最多 5 张
const MAX_PROMPT_LENGTH = 1490; // API 要求严格小于 1500，预留少量安全余量
const TEXT_FREE_CONSTRAINT = `
【文字安全区（硬性约束）】画面中不要生成任何文字、字母、数字、Logo、水印、签名、书本封面字、UI 文案或伪文字。不要生成带标签的包装盒、电脑、手机、屏幕、书本、海报、招牌、霓虹字或二维码；不要在画面角落添加小字、免责声明、标签条、卡片、按钮、面板或类似文字的纹理；如场景必须有容器或电子设备，只能使用纯色无标识表面，屏幕关闭或显示纯色。所有文案均由后期本地排版层精确叠加，请保持预留区域为干净背景；参考图仅参考风格，不复制参考图中的文字。`;

function compactVisualDNA(dna: VisualDNA): string {
  const text = (value: unknown, max = 80) =>
    String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
  const list = (values: unknown, maxItems = 6, maxItem = 24) =>
    Array.isArray(values)
      ? values.slice(0, maxItems).map((value) => text(value, maxItem)).filter(Boolean).join('、')
      : '';

  return [
    `色板:${list(dna.palette, 5, 16)}`,
    `构图:${text(dna.composition, 80)}`,
    `光影:${text(dna.lighting, 60)}`,
    `材质:${list(dna.textures, 5)}`,
    `字体:${text(dna.typography, 60)}`,
    `情绪:${text(dna.mood, 40)}`,
    `设计:${list(dna.design_patterns, 6)}`,
    `IP:龙虾=${dna.ip_visibility?.lobster_mascot ? '有' : '无'},Logo=${dna.ip_visibility?.logo ? '有' : '无'}`,
    `关键元素:${list(dna.key_elements, 8, 28)}`,
  ].filter((part) => !part.endsWith(':')).join('；');
}

function limitImagePrompt(prompt: string): string {
  const normalized = prompt.replace(/\r\n/g, '\n').trim();
  if (normalized.length <= MAX_PROMPT_LENGTH) return normalized;

  const marker = '\n\n（提示词过长，已自动压缩，保留以上核心约束）';
  const sliceLength = Math.max(0, MAX_PROMPT_LENGTH - marker.length);
  const clipped = normalized.slice(0, sliceLength);
  const lastBreak = clipped.lastIndexOf('\n');
  const body = lastBreak >= sliceLength * 0.6 ? clipped.slice(0, lastBreak) : clipped;
  return `${body.trimEnd()}${marker}`;
}

// ============ 主函数 ============
export async function generateImage(
  options: ImageGenerationOptions,
  config: ImageGeneratorConfig
): Promise<ImageGenerationResult> {
  const {
    prompt,
    model = DEFAULTS.model,
    aspectRatio = DEFAULTS.aspectRatio,
    n = DEFAULTS.n,
    subjectReference,
    responseFormat = DEFAULTS.responseFormat,
    signal,
    retries = DEFAULTS.retries,
  } = options;

  const {
    apiKey,
    baseUrl = 'https://api.minimaxi.com',
    outputDir = DEFAULTS.outputDir,
    fetchImpl = fetch,
  } = config;

  // v0.2: 夹紧 n 到 1~MAX_N
  const safeN = Math.max(1, Math.min(MAX_N, Math.floor(n)));

  const url = `${baseUrl}/v1/image_generation`;
  const payload: Record<string, unknown> = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    n: safeN,
    response_format: responseFormat,
  };
  if (subjectReference?.length) {
    payload.subject_reference = subjectReference.map(({type, imageFile}) => ({
      type,
      image_file: imageFile,
    }));
  }

  // 指数退避重试
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal,
      });
      if (!res.ok) {
        throw new Error(
          `MiniMax image API ${res.status}: ${await res.text()}`
        );
      }
      // MiniMax 返回：成功时 data 为数组对象；失败时 data=null 且 base_resp 携带业务错误码
      const json = (await res.json()) as {
        data: { image_base64?: string[]; image_url?: string[] } | null;
        base_resp?: { status_code?: number; status_msg?: string };
      };

      // 业务错误（HTTP 200 但失败，如 2056 额度上限、1004 无效等）
      if (json.base_resp && (json.base_resp.status_code ?? 0) !== 0) {
        const code: number = json.base_resp.status_code ?? -1;
        const msg = json.base_resp.status_msg ?? 'MiniMax 业务错误';
        const err: Error & { code?: number; fatal?: boolean } = new Error(`MiniMax image API 业务错误 ${code}: ${msg}`);
        err.code = code;
        // 2056=额度上限, 1004=无效请求, 4xxx 通常为参数/鉴权 → 重试无意义
        // 1000 通常是未知错误，但当提示图片地址非法时属于确定性的入参错误。
        err.fatal =
          [2056, 1004, 1001, 2013, 2010, 2001, 2049].includes(code) ||
          (code === 1000 && /disallowed image url|localhost|private address/i.test(msg));
        throw err;
      }

      const data = json.data;
      if (!data) {
        const err: Error & { fatal?: boolean } = new Error(`MiniMax image API 返回为空 data: ${JSON.stringify(json).slice(0, 300)}`);
        err.fatal = true;
        throw err;
      }

      // 兼容两套返回字段名：image_base64 / image_urls / files
      const raw: unknown =
        (data as any)?.image_base64 ??
        (data as any)?.image_url ??
        (data as any)?.image_urls ??
        (Array.isArray(data) ? data.map((d: any) => d?.image?.base64 ?? d?.url ?? d?.image_url).filter(Boolean) : []);
      const images: string[] = Array.isArray(raw) ? raw : [];

      if (images.length === 0) {
        const err: Error & { fatal?: boolean } = new Error('MiniMax 返回空图像列表');
        err.fatal = true;
        throw err;
      }

      // 可选：保存到 outputDir（用 ts+idx 命名，与 task-manager 写入逻辑对齐）
      if (outputDir && responseFormat === 'base64') {
        const ts = Date.now();
        for (let i = 0; i < images.length; i++) {
          const file = join(outputDir, `cover_${ts}_${i}.jpeg`);
          mkdirSync(dirname(file), {recursive: true});
          writeFileSync(file, Buffer.from(images[i], 'base64'));
        }
      }
      return { images, format: responseFormat, base64: images };
    } catch (e) {
      const err = e as Error & { fatal?: boolean };
      if ((err as any).fatal || (err as any).code) {
        // 业务/鉴权错误：重试无意义，立即抛出
        throw e;
      }
      lastErr = e as Error;
      if (attempt === retries) break;
      const delay = 2 ** attempt * 500; // 0.5s, 1s, 2s（网络抖动才重试）
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr ?? new Error('MiniMax image generation failed');
}

// ============ 一站式便捷函数 ============
export interface SmartImageOptions {
  category: 'cover' | 'top_banner' | 'mid_banner' | 'popup' | 'custom';
  theme: {
    title: string;
    subtitle?: string;
    tags?: string[];
    gifts?: Array<{ name: string; value: string }>;
  };
  refImages?: Array<string | Buffer>;           // 参考图
  customPrompt?: string;                          // 用户手写 prompt 时使用
  aspectRatio?: AspectRatio;
  brandContext?: BrandContext;
  dna?: VisualDNA;                                // 已分析好的视觉 DNA
  scene?: string;                                  // 场景库 key（livestream/product_launch/holiday/recruiting）
  /** v0.2: 变体数量（默认 1） */
  variantCount?: number;
  config: ImageGeneratorConfig;
}

export interface BrandContext {
  colorTone?: 'blue_purple' | 'black_gold';
  useLobster?: boolean;
  brandName?: string;                              // 默认 'ClawDao'
  ipName?: string;                                 // 默认 '橙色卡通龙虾吉祥物'
}

import { VisualDNA } from './multimodal-analyzer';
import { loadPrompt } from './prompt_builder';

/** category → 提示词文件名（去掉下划线，匹配 prompts/*.md 文件命名约定） */
const PROMPT_FILE_BY_CATEGORY: Record<string, string> = {
  cover: 'cover',
  top_banner: 'top-banner',
  mid_banner: 'mid-banner',
  popup: 'popup',
  custom: 'cover',  // custom 复用 cover 模板
};

/**
 * 一站式：选 category + 主题 → 自动注入品牌 DNA → 调 MiniMax image-01
 *
 * v0.2: 支持 variantCount（一次 HTTP 请求返回 N 张，自然给出不同结果）
 */
export async function smartGenerate(
  options: SmartImageOptions
): Promise<ImageGenerationResult> {
  const {
    category,
    theme,
    refImages,
    customPrompt,
    aspectRatio,
    brandContext,
    dna,
    scene,
    variantCount = 1,
    config,
  } = options;

  // 场景注入：scene_prompt 模板变量由 scenes.ts 提供
  let scenePromptBlock = '';
  let occasionPrompt = '';
  if (scene) {
    const {getScene, sceneToPromptPrefix, resolveOccasionContext} = await import('./scenes');
    const sceneObj = getScene(scene);
    occasionPrompt = scene === 'holiday' ? resolveOccasionContext(theme) : '';
    // 具体节庆主题优先于“节日”通用模板，避免国庆被渲染成中秋礼盒或参考图里的蓝色科技风。
    scenePromptBlock = occasionPrompt ? '' : sceneToPromptPrefix(sceneObj);
  }

  let promptText: string;
  let ratio: AspectRatio = aspectRatio ?? getPreset(category).ratio;

  if (customPrompt) {
    promptText = customPrompt;
  } else {
    // 选模板（把下划线转连字符，与 prompts/*.md 文件名一致）
    const promptFile = PROMPT_FILE_BY_CATEGORY[category] ?? category;
    const result = loadPrompt(promptFile, {
      role: 'ClawDao 图像工厂',
      task: `生成${category}`,
      title: theme.title,
      subtitle: theme.subtitle ?? '',
      subtitle_size: 24,
      tags: theme.tags ?? [],
      colorTone: brandContext?.colorTone ?? 'blue_purple',
      useLobster: brandContext?.useLobster ?? true,
      gifts: theme.gifts ?? [],
      refImages_dna: occasionPrompt
        ? '忽略参考图中的色板、节日元素和冷色科技风，仅保留干净背景与高端商务质感'
        : dna ? compactVisualDNA(dna) : '',
      scene_prompt: scenePromptBlock,
    });
    promptText = result.body;
  }

  // 关键约束放最前面，确保超长提示词被压缩时不会丢失“无字”和节庆主题覆盖。
  promptText = limitImagePrompt([TEXT_FREE_CONSTRAINT, occasionPrompt, promptText].filter(Boolean).join('\n\n'));

  // 图生图：把 refImages 转换成 subject_reference
  let subjectReference: ImageGenerationOptions['subjectReference'];
  if (refImages?.length) {
    const refs = await Promise.all(
      refImages.map(async (img) => ({
        type: 'character' as const,
        imageFile: await normalizeImageReference(img),
      }))
    );
    subjectReference = refs;
  }

  return generateImage(
    {
      prompt: promptText,
      aspectRatio: ratio,
      n: variantCount,                // v0.2: 一次请求 N 张
      subjectReference,
      responseFormat: 'base64',
    },
    config
  );
}
