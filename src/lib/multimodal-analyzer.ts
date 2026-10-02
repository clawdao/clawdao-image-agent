/**
 * multimodal-analyzer.ts — 多模态理解（基于 MiniMax M3 多模态能力）
 *
 * 职责：接收 1~N 张参考图 → base64 编码 → POST 到 MiniMax M3
 *       → 解析输出 → 缓存为视觉 DNA JSON
 *
 * 输出 DNA 字段：
 *   - palette：主色调色板
 *   - composition：构图（九宫格 / 中心 / 对称 / 引导线等）
 *   - lighting：光影方向、强度、色温
 *   - textures：材质质感（金属 / 玻璃 / 哑光 / 光泽 / 等）
 *   - typography：字体风格（衬线 / 无衬线 / 书法 / 装饰体）
 *   - mood：情绪调性（科技 / 高端 / 温馨 / 古典 / 赛博 / 自然）
 *   - design_patterns：可复用的设计模式
 *   - ip_visibility：是否包含 ClawDao IP（龙舟 / 蓝图 / Logo）
 *   - key_elements：必保留的视觉元素清单
 */

import { createHash } from 'node:crypto';
import {readImageAsBase64, toImageDataPayload} from './image-source';

export {readImageAsBase64};

// ============ 类型 ============
export interface VisualDNA {
  palette: string[];                 // 色板（hex）
  composition: string;               // 构图描述
  lighting: string;                  // 光影描述
  textures: string[];                // 材质列表
  typography: string;                // 字体描述
  mood: string;                      // 情绪调性
  design_patterns: string[];         // 设计模式
  ip_visibility: {
    lobster_mascot: boolean;         // 龙虾吉祥物
    logo: boolean;                    // ClawDao Logo
  };
  key_elements: string[];            // 必保留元素
}

export interface MultimodalConfig {
  apiKey: string;
  baseUrl?: string;                  // 默认 https://api.minimaxi.com
  model?: string;                    // 默认 MiniMax-M3
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;          // 便于测试注入
}

// ============ 缓存（sessionStorage / 内存） ============
const dnaCache = new Map<string, VisualDNA>();

function hashImages(images: string[]): string {
  const h = createHash('sha256');
  for (const img of images) h.update(img.slice(0, 100));
  return h.digest('hex');
}

function parseVisualDNA(text: string): VisualDNA {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = (fenced?.[1] ?? trimmed).trim();

  try {
    return JSON.parse(candidate) as VisualDNA;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      candidate = candidate.slice(start, end + 1);
      return JSON.parse(candidate) as VisualDNA;
    }
    throw new Error('多模态分析返回的 JSON 无效');
  }
}

// ============ 主函数：多模态分析 ============
export async function analyzeImages(
  images: Array<string | Buffer | Blob>,
  config: MultimodalConfig
): Promise<VisualDNA> {
  if (images.length === 0) throw new Error('没有可分析的参考图');

  const imagePayloads = await Promise.all(
    images.map((img) => toImageDataPayload(img, config.fetchImpl ?? fetch)),
  );

  // 缓存命中
  const cacheKey = hashImages(imagePayloads.map((img) => img.dataUrl));
  if (dnaCache.has(cacheKey)) {
    return dnaCache.get(cacheKey)!;
  }

  // 构造消息：多模态输入
  const content: any[] = [
    {
      type: 'text',
      text: ANALYSIS_PROMPT,
    },
  ];
  for (const image of imagePayloads) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: image.mediaType,
        data: image.base64,
      },
    });
  }

  const url = `${config.baseUrl ?? 'https://api.minimaxi.com'}/v1/messages`;
  const fetchFn = config.fetchImpl ?? fetch;
  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model ?? 'MiniMax-M3',
      max_tokens: config.maxTokens ?? 4096,
      temperature: config.temperature ?? 0.4,
      messages: [{ role: 'user', content }],
      response_format: { type: 'json_object' },
    }),
    signal: config.signal,
  });

  if (!res.ok) {
    throw new Error(`Multimodal API error ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as { content: Array<{ text: string }> };
  const text = json.content[0]?.text ?? '{}';
  const dna = parseVisualDNA(text);
  dnaCache.set(cacheKey, dna);
  return dna;
}

// ============ 分析 Prompt ============
const ANALYSIS_PROMPT = `
你是 ClawDao 视觉风格分析师。请仔细观察提供的参考图，按 JSON 输出视觉 DNA：

{
  "palette": ["#RRGGBB", ...],           // 主色调色板（按权重排序，前 5 个）
  "composition": "...",                  // 构图描述（如九宫格 / 中心对称 / 对角线引导等）
  "lighting": "...",                     // 光影描述（方向、强度、色温 3000K-8000K）
  "textures": ["金属", "磨砂", ...],     // 材质质感列表
  "typography": "...",                   // 字体风格（衬线 / 无衬线 / 书法 / 装饰体 / 笔画特征）
  "mood": "...",                         // 情绪调性（科技 / 高端 / 温馨 / 古典 / 赛博 / 自然 等）
  "design_patterns": ["..."],            // 可复用的设计模式（如光晕 / 渐变 / 描边 / 留白 等）
  "ip_visibility": {                     // ClawDao IP 检测结果
    "lobster_mascot": true,             // 是否含龙虾吉祥物
    "logo": true                         // 是否含 ClawDao Logo
  },
  "key_elements": ["..."]                // 必保留的视觉元素（如卡通形象、书法字、装饰边框）
}

要求：
- 只输出 JSON，不要其他说明
- palette 用 hex 表示
- 描述尽量具体、可复用
`.trim();
