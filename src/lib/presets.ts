/**
 * 比例预设库 — 4 种直播场景
 *
 * ⚠️ 比例必须落在 MiniMax image-01 支持集合内：
 *    [1:1, 16:9, 4:3, 3:2, 2:3, 3:4, 9:16, 21:9]
 *  16:5 / 16:6 等超宽比 image-01 不识别，会返回 2013。
 */

import type { PresetConfig, Category } from '../types/index';

export const PRESETS: Record<Category, PresetConfig> = {
  cover: {
    ratio: '9:16',
    size: { w: 1080, h: 1920 },
    promptHint: '直播间封面 9:16 竖屏',
  },
  top_banner: {
    ratio: '21:9',
    size: { w: 1920, h: 320 },
    promptHint: '顶部广告条 21:9 超宽',
  },
  mid_banner: {
    ratio: '21:9', // MiniMax 不支持 16:5 → 用最宽可用 21:9（约 2.33:1），尺寸经内置裁切语义达成
    size: { w: 1920, h: 600 },
    promptHint: '中间广告条 → image-01 21:9 宽幅',
  },
  popup: {
    ratio: '1:1',
    size: { w: 1024, h: 1024 },
    promptHint: '福利弹窗 1:1 方图',
  },
  custom: {
    ratio: '16:9',
    size: { w: 1920, h: 1080 },
    promptHint: '自定义 16:9',
  },
};

export function getPreset(category: Category): PresetConfig {
  return PRESETS[category] ?? PRESETS.custom;
}
