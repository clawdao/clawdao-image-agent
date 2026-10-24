/**
 * poster-config.ts — 通用海报配置模型与加载器
 *
 * 设计目标（和商品图配置同一套思路）：
 *   「给定内容 + 主题 + 尺寸 → 出图」是同一件事，
 *   所以直播间封面 / 宣传海报 / 节日海报都用同一份配置结构，
 *   加一种新海报 = 在 configs/poster/ 下加一个 YAML，不改脚本。
 *
 * 配置结构：
 *   id / label          —— 标识与中文名
 *   kind                —— 语义类型（live-cover 直播间封面 / poster 宣传海报 …）
 *   tone                —— 配色方案（PosterTone，见 src/lib/poster-renderer.ts）
 *   background          —— 背景模式（gradient / solid / organic / aurora / none）
 *   size                —— 成品尺寸 { width, height }；height 省略 = 高度随内容增长
 *   anchor              —— 内容在成品画布里的垂直落位（center / top / bottom）
 *   brand               —— 品牌位（Logo + 名字 + 位置 + 样式）
 *   blocks              —— 内容块（与 poster-renderer 的 PosterBlock 同构）
 *   variants            —— 同一主题的多个文案版本 → 一次出多张
 *   compliance          —— 合规规则 id（可选，指向 configs/compliance/<id>.yaml）
 *
 * 变量引用沿用 scripts/lib/config.ts 的 `{{path}}` 语法，
 * 所以标题 / 卡片 / 详情文案仍然可以共用同一份内容常量。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, resolveRefs } from './config';
import type { PosterBlock, PosterBrand, PosterCornerMark, PosterTone } from '../../src/lib/poster-renderer';

export const POSTER_CONFIG_DIR = './configs/poster';

export type PosterBackground = 'gradient' | 'none' | 'solid' | 'organic' | 'aurora';
export type PosterAnchor = 'center' | 'top' | 'bottom';

/** 一个文案版本（一次出多张时用） */
export interface PosterVariant {
  /** 版本标识（进文件名） */
  id?: string;
  /** 显式文件名（不含扩展名） */
  file?: string;
  /** 字段级覆盖：`"blocks.0.title": "新标题"` */
  set?: Record<string, unknown>;
  /** 整块替换 */
  blocks?: PosterBlock[];
}

export interface PosterConfig {
  id: string;
  label?: string;
  /** 语义类型（自由字符串，便于以后加新类型） */
  kind?: string;
  tone?: PosterTone;
  background?: PosterBackground;
  size?: { width: number; height?: number };
  anchor?: PosterAnchor;
  /** 画布内边距（成品像素） */
  padding?: { top?: number; bottom?: number };
  brand?: PosterBrand;
  /** 右下角品牌角标 */
  cornerMark?: PosterCornerMark;
  blocks: PosterBlock[];
  variants?: PosterVariant[];
  /** 输出目录（相对 cwd） */
  outputDir?: string;
  /** 文件名前缀 */
  fileNamePrefix?: string;
  format?: 'png' | 'jpg';
  /** 合规规则 id（指向 configs/compliance/<id>.yaml），填了就会自动自查 */
  compliance?: string;
}

const VALID_TONES: PosterTone[] = [
  'black_gold', 'blue_purple', 'deep_blue', 'warm_amber', 'classic_blue',
  'pure_white', 'pure_blue', 'fresh_green', 'pure_fresh', 'pure_green',
  'pure_cream', 'pure_warm', 'tech_light', 'solid_blue',
];

const VALID_BACKGROUNDS: PosterBackground[] = ['gradient', 'none', 'solid', 'organic', 'aurora'];

/** 列出所有海报配置 id */
export function listPosterConfigs(dir = POSTER_CONFIG_DIR): string[] {
  const abs = resolve(dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((name) => /\.(ya?ml|json)$/i.test(name) && !name.startsWith('_'))
    .map((name) => name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/**
 * 换行归一化：把字符串里的字面量 `\n`（反斜杠 + n）换成真换行。
 *
 * 为什么需要：YAML 里不加引号的标量不会解析 `\n` 转义，
 * 写 `title: 第一行\n第二行` 会得到一个含字面量 "\n" 的字符串，
 * 排版时就会在画面上冒出「\n」两个字符。改成块标量（|-）也行，
 * 但归一化能让写法更宽容。
 */
function normalizeNewlines<T>(node: T): T {
  if (typeof node === 'string') {
    return (node.replace(/\\n/g, '\n') as unknown) as T;
  }
  if (Array.isArray(node)) {
    return node.map((item) => normalizeNewlines(item)) as unknown as T;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = normalizeNewlines(value);
    }
    return out as unknown as T;
  }
  return node;
}

/** 校验 + 归一化 */
export function normalizePosterConfig(raw: PosterConfig, sourceLabel: string): PosterConfig {
  const config = normalizeNewlines(raw);
  if (!config.id) throw new Error(`海报配置缺少 id：${sourceLabel}`);
  if (!Array.isArray(config.blocks) || config.blocks.length === 0) {
    throw new Error(`海报配置缺少 blocks：${sourceLabel}`);
  }
  if (config.tone && !VALID_TONES.includes(config.tone)) {
    throw new Error(`未知配色方案：${config.tone}（可用：${VALID_TONES.join('、')}）`);
  }
  if (config.background && !VALID_BACKGROUNDS.includes(config.background)) {
    throw new Error(`未知背景模式：${config.background}（可用：${VALID_BACKGROUNDS.join('、')}）`);
  }
  const width = config.size?.width;
  if (!width || width <= 0) {
    throw new Error(`海报配置缺少 size.width：${sourceLabel}`);
  }
  for (const block of config.blocks) {
    if (!block || typeof block !== 'object' || !('kind' in block)) {
      throw new Error(`海报配置存在非法块（缺 kind）：${sourceLabel}`);
    }
  }
  return {
    ...config,
    size: { width, height: config.size?.height },
    blocks: config.blocks,
  };
}

/** 加载海报配置（按路径） */
export function loadPosterConfig(filePath: string): { path: string; relPath: string; data: PosterConfig } {
  const loaded = loadConfig<PosterConfig>(filePath);
  const data = normalizePosterConfig(resolveRefs(loaded.data) as PosterConfig, loaded.relPath);
  return { path: loaded.path, relPath: loaded.relPath, data };
}

/** 加载海报配置（按 id） */
export function loadPosterConfigById(id: string, dir = POSTER_CONFIG_DIR): {
  path: string;
  relPath: string;
  data: PosterConfig;
} {
  const file = ['yaml', 'yml', 'json']
    .map((ext) => join(dir, `${id}.${ext}`))
    .find((candidate) => existsSync(candidate));
  if (!file) {
    throw new Error(`找不到海报配置：${id}\n可用配置：${listPosterConfigs(dir).join('、')}`);
  }
  return loadPosterConfig(file);
}

/* ------------------------------------------------------------------ */
/* 变体（一次出多张）                                                 */
/* ------------------------------------------------------------------ */

/** 按点号路径写值：`blocks.0.title` → blocks[0].title */
export function setByPath(target: any, path: string, value: unknown): void {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  if (!segments.length) return;
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = /^\d+$/.test(segments[index + 1]);
    if (cursor[key] === undefined || cursor[key] === null) {
      cursor[key] = next ? [] : {};
    }
    cursor = cursor[key];
  }
  cursor[segments[segments.length - 1]] = value;
}

/** 产出一个应用了变体的新配置（不改原对象） */
export function applyVariant(config: PosterConfig, variant: PosterVariant): PosterConfig {
  const next: PosterConfig = JSON.parse(JSON.stringify(config));
  if (variant.blocks) next.blocks = JSON.parse(JSON.stringify(variant.blocks));
  if (variant.set) {
    for (const [path, value] of Object.entries(variant.set)) {
      setByPath(next, path, value);
    }
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* 文本抽取（合规自查 / 命令行覆盖用）                                */
/* ------------------------------------------------------------------ */

/** 递归收集块里出现的所有文字 */
export function extractBlockTexts(blocks: PosterBlock[]): string[] {
  const out: string[] = [];
  const push = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) out.push(value.trim());
  };

  for (const block of blocks as any[]) {
    switch (block.kind) {
      case 'hero':
        push(block.kicker);
        push(block.title);
        push(block.subtitle);
        (block.badges ?? []).forEach(push);
        break;
      case 'title':
        push(block.spec?.enLabel);
        push(block.spec?.eyebrow);
        push(block.spec?.title);
        push(block.spec?.subtitle);
        (block.spec?.badges ?? []).forEach(push);
        (block.spec?.stats ?? []).forEach((stat: any) => {
          push(stat.value);
          push(stat.label);
        });
        break;
      case 'section':
        push(block.label);
        push(block.title);
        push(block.desc);
        break;
      case 'cards':
        (block.items ?? []).forEach((item: any) => {
          push(item.tag);
          push(item.title);
          (item.lines ?? []).forEach(push);
        });
        break;
      case 'timeline':
        (block.items ?? []).forEach((item: any) => {
          push(item.time);
          push(item.title);
          (item.lines ?? []).forEach(push);
        });
        break;
      case 'rows':
        push(block.title);
        (block.items ?? []).forEach((item: any) => {
          push(item.label);
          push(item.title);
          (item.lines ?? []).forEach(push);
        });
        break;
      case 'profile':
        push(block.profile?.name);
        push(block.profile?.role);
        (block.profile?.bullets ?? []).forEach(push);
        break;
      case 'note':
        push(block.text);
        break;
      case 'footer':
        push(block.text);
        break;
      case 'centerTitle':
        push(block.kicker);
        push(block.title);
        push(block.subtitle);
        push(block.note);
        break;
      case 'features':
        (block.items ?? []).forEach((item: any) => {
          push(item.title);
          push(item.desc);
        });
        break;
      case 'grid':
        (block.items ?? []).forEach((item: any) => {
          push(item.title);
          push(item.desc);
        });
        break;
      case 'panel':
        out.push(...extractBlockTexts(block.blocks ?? []));
        break;
      case 'qr':
        push(block.title);
        push(block.caption);
        break;
      case 'visual':
        push(block.caption);
        break;
      default:
        break;
    }
  }

  return out;
}

/** 找主标题块（--title / --subtitle 覆盖用） */
export function findTitleBlockIndex(blocks: PosterBlock[]): number {
  const priority = ['centerTitle', 'title', 'hero'];
  for (const kind of priority) {
    const index = blocks.findIndex((block) => block.kind === kind);
    if (index >= 0) return index;
  }
  return -1;
}
