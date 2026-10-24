/**
 * listing-config.ts — 商品图（上架图）配置的数据模型与加载器
 *
 * 一份配置 = 一个商品图版本。新增版本不再写脚本，只加一个 YAML。
 *
 * 配置结构总览
 *   id / label / outputDir / theme / compliance   —— 元信息
 *   vars                                          —— 原子文案（标题、英文小标、品牌全称…）
 *   product                                       —— 商品字段（后台填写项）
 *   brand / author                                —— 品牌位与讲师
 *   content                                       —— 内容板块（模块 / 受众 / 目标客户 / FAQ）
 *   posters                                       —— 海报定义（blocks 即渲染指令）
 *   copy                                          —— 商品详情页文案（blocks 即排版指令）
 *
 * 「图与文案同源」的实现方式
 *   posters 与 copy 都只写 `{{content.modules.M1.title}}` 这类引用，
 *   内容常量只存在于 content 段；改一处，图与文案同时变。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PosterBlock, PosterTone, PosterBrand } from '../../src/lib/poster-renderer';
import { loadConfig, resolveRefs, type LoadedConfig } from './config';

/* ============================== 数据模型 ============================== */

export interface ListingVars {
  [key: string]: string;
}

/** 商品字段（后台填写项） */
export interface ListingProduct {
  name: string;
  category: string;
  brand: string;
  delivery: string;
  gifts: string;
  position: string;
  [key: string]: string;
}

/** 右上角品牌位 */
export interface ListingBrand {
  logo: string;
  text: string;
}

/** 讲师 */
export interface ListingAuthor {
  name: string;
  role: string;
  avatar?: string;
  bullets: string[];
}

/** 通用卡片 */
export interface ListingCard {
  tag: string;
  title: string;
  lines?: string[];
}

/** 课程模块 */
export interface ListingModule {
  label: string;
  title: string;
  summary?: string;
  lines?: string[];
}

/** FAQ 条目 */
export interface ListingFaq {
  label: string;
  title: string;
  lines: string[];
}

/** 详情页「你能带走什么」表格行 */
export interface ListingTargetRow {
  who: string;
  gain: string;
}

/** 内容板块 */
export interface ListingContent {
  modules?: ListingModule[];
  audience?: ListingCard[];
  targets?: ListingCard[];
  faq?: ListingFaq[];
  targetTable?: ListingTargetRow[];
  [key: string]: unknown;
}

/** 海报定义 */
export interface ListingPosterSpec {
  file: string;
  width: number;
  fit?: { width: number; height: number };
  tone?: PosterTone;
  themeSlot?: 'main' | 'plainLight' | 'plainDeep';
  glowX?: number;
  background?: 'gradient' | 'none' | 'solid' | 'organic';
  brand?: PosterBrand;
  blocks: PosterBlock[];
}

/* ------------------------------ 商品文案排版指令 ------------------------------ */

export type CopyBlock =
  /** 标题 */
  | { type: 'heading'; level: 1 | 2 | 3 | 4; text: string }
  /** 正文段落 */
  | { type: 'text'; text: string }
  /** 商品字段清单（从 product 渲染） */
  | { type: 'fields' }
  /** 无序列表 */
  | { type: 'list'; items: string[] }
  /** 有序列表 */
  | { type: 'ordered'; items: string[] }
  /** 表格 */
  | { type: 'table'; header?: string[]; rows: string[][] }
  /** 引用块 */
  | { type: 'quote'; text: string }
  /** 分隔线 */
  | { type: 'hr' }
  /** 模块概览（label｜title + summary） */
  | { type: 'moduleOverview' }
  /** 模块详解（label｜title + lines） */
  | { type: 'modules' }
  /** FAQ 问答 */
  | { type: 'faq' }
  /** 目标客户「你能带走什么」表 */
  | { type: 'targetTable' }
  /** 讲师介绍（署名 + 资历清单） */
  | { type: 'author' }
  /** 原样 markdown（逃生舱） */
  | { type: 'raw'; text: string };

export interface ListingCopy {
  fileName?: string;
  blocks: CopyBlock[];
}

/** 完整配置 */
export interface ListingConfig {
  id: string;
  label?: string;
  outputDir: string;
  theme?: string;
  /** 合规规则配置路径（相对 cwd） */
  compliance?: string;
  vars: ListingVars;
  product: ListingProduct;
  brand?: ListingBrand;
  author: ListingAuthor;
  content: ListingContent;
  posters: ListingPosterSpec[];
  copy: ListingCopy;
}

/* ============================== 加载器 ============================== */

/** 配置目录（相对 cwd） */
export const LISTING_CONFIG_DIR = './configs/shop-listing';

/** 列出所有可用的商品图配置 */
export function listListingConfigs(dir = LISTING_CONFIG_DIR): string[] {
  const abs = resolve(dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((name) => /\.(ya?ml|json)$/i.test(name))
    .map((name) => name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

/**
 * 补齐派生字段：`content.moduleOverview`（模块概览：label + title + summary）。
 * 方图「课程安排」用概览（每行一句），详情页「课程内容」用详解（完整 lines）。
 */
function withDerivedContent(config: ListingConfig): ListingConfig {
  const content = config.content ?? {};
  if (Array.isArray(content.modules) && !content.moduleOverview) {
    content.moduleOverview = content.modules.map((module) => ({
      label: module.label ?? (module as any).tag ?? '',
      title: module.title,
      lines: [module.summary ?? ''],
    }));
  }
  config.content = content;
  return config;
}

/** 读取 + 解析 + 校验一份商品图配置 */
export function loadListingConfig(filePath: string): LoadedConfig<ListingConfig> {
  const loaded = loadConfig<ListingConfig>(filePath);
  const config = withDerivedContent(loaded.data);
  validateListingConfig(config, loaded.relPath);
  const resolved = resolveRefs(config) as ListingConfig;
  // 引用解析后重新补一次派生字段（引用可能覆盖 content 段）
  const finalConfig = withDerivedContent(resolved);
  validateListingConfig(finalConfig, loaded.relPath);
  return { ...loaded, data: finalConfig };
}

/** 按 id 加载（configs/shop-listing/<id>.yaml|json） */
export function loadListingConfigById(id: string, dir = LISTING_CONFIG_DIR): LoadedConfig<ListingConfig> {
  const candidates = [
    join(dir, `${id}.yaml`),
    join(dir, `${id}.yml`),
    join(dir, `${id}.json`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return loadListingConfig(candidate);
  }
  throw new Error(
    `找不到商品图配置：${id}\n已尝试：${candidates.map((c) => `  ${c}`).join('\n')}\n` +
      `可用配置：${listListingConfigs(dir).join('、')}`,
  );
}

/* ============================== 校验 ============================== */

function fail(relPath: string, message: string): never {
  throw new Error(`配置校验失败（${relPath}）：${message}`);
}

export function validateListingConfig(config: ListingConfig, relPath = 'config'): void {
  if (!config.id) fail(relPath, '缺少 id');
  if (!config.outputDir) fail(relPath, '缺少 outputDir');
  if (!config.product?.name) fail(relPath, '缺少 product.name');
  if (!Array.isArray(config.posters) || config.posters.length === 0) {
    fail(relPath, 'posters 不能为空');
  }
  for (const poster of config.posters) {
    if (!poster.file) fail(relPath, '存在缺少 file 的海报');
    if (!poster.width) fail(relPath, `海报 ${poster.file} 缺少 width`);
    if (!Array.isArray(poster.blocks) || poster.blocks.length === 0) {
      fail(relPath, `海报 ${poster.file} 的 blocks 不能为空`);
    }
  }
  if (!Array.isArray(config.copy?.blocks)) {
    fail(relPath, 'copy.blocks 必须是数组');
  }
}
