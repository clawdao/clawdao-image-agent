/**
 * poster-themes.ts —— 商品图三套配色方案注册表
 *
 * 为什么要有“方案”这个概念：
 *   同一门课要能快速换视觉（平台活动 / 节日 / 不同系列），
 *   而不是改一堆硬编码色值。每套方案 = 一个主视觉 + 一张浅底纯色图 + 一张深底纯色图，
 *   一次性把主图、详情页、礼物位、推荐位配齐。
 *
 * 三套方案：
 *   warm  暖色琥珀  —— V2 / V3 用的暖色系
 *   blue  经典商务蓝 —— V4 用的企业级深蓝 + 经典金
 *   fresh 清新绿    —— V7 用的奶油底 + 有机浅绿块（默认）
 *
 * 纯色底图（礼物位 / 推荐位）为什么必须配：
 *   平台礼物的缩略图很小，深底渐变图缩小后发闷、主体不清；
 *   平涂纯色 + 重新排版的深色文字，缩到 200×200 仍然读得清。
 */

import type { PosterTone } from './poster-renderer';

/** 背景模式 */
export type PosterBackgroundMode = 'gradient' | 'none' | 'solid' | 'organic';

/** 方案里的一个档位（主视觉 / 浅底 / 深底） */
export interface PosterThemeSlot {
  /** 色调 */
  tone: PosterTone;
  /** 背景模式 */
  background: PosterBackgroundMode;
}

/** 一套配色方案 */
export interface PosterTheme {
  /** 方案 id（命令行 --theme 用） */
  id: string;
  /** 方案名（给人看） */
  name: string;
  /** 方案说明 */
  desc: string;
  /** 主视觉：渐变 / 有机背景 */
  main: PosterThemeSlot;
  /** 浅底纯色图（白底系） */
  plainLight: PosterThemeSlot;
  /** 深底纯色图（深底系） */
  plainDeep: PosterThemeSlot;
}

export const POSTER_THEMES: PosterTheme[] = [
  {
    id: 'warm',
    name: '暖色琥珀',
    desc: '奶油米底 + 琥珀金 + 暖橙 + 珊瑚，亲和力强，适合面向个人与小团队的课',
    main: { tone: 'warm_amber', background: 'gradient' },
    plainLight: { tone: 'pure_cream', background: 'solid' },
    plainDeep: { tone: 'pure_warm', background: 'solid' },
  },
  {
    id: 'blue',
    name: '经典商务蓝',
    desc: '深宝蓝 + 经典金，企业级技术课气质，适合面向管理与决策层',
    main: { tone: 'classic_blue', background: 'gradient' },
    plainLight: { tone: 'pure_white', background: 'solid' },
    plainDeep: { tone: 'pure_blue', background: 'solid' },
  },
  {
    id: 'fresh',
    name: '清新绿',
    desc: '奶油底 + 有机浅绿块 + 亮黄点缀，干净松弛，适合强调“人人可用”的实操课',
    main: { tone: 'fresh_green', background: 'organic' },
    plainLight: { tone: 'pure_fresh', background: 'solid' },
    plainDeep: { tone: 'pure_green', background: 'solid' },
  },
];

/** 默认方案 */
export const DEFAULT_THEME_ID = 'fresh';

/**
 * 按 id 取方案；未传或未命中时返回默认方案（不抛错，避免命令行写错就断链）。
 */
export function getPosterTheme(id?: string): PosterTheme {
  const key = (id ?? '').trim().toLowerCase();
  const found = POSTER_THEMES.find((theme) => theme.id === key);
  if (found) return found;
  if (!key) return POSTER_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
  return POSTER_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
}

/** 把方案列表打印成一行行文字（给命令行提示用） */
export function describePosterThemes(): string {
  return POSTER_THEMES.map((theme) => `  ${theme.id.padEnd(6)} ${theme.name} —— ${theme.desc}`).join('\n');
}
