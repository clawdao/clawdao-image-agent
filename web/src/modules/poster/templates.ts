/**
 * templates.ts — 海报工作室内置模板（Fabric JSON）
 *
 * 说明：
 *   ddn-hub 的模板存在 MySQL（poster_template 表），本项目不引入数据库，
 *   内置几套「够用 + 可改」的模板，模板本身就是一个 Fabric JSON + 画布尺寸。
 *
 *   Fabric v7 的 JSON 里对象 type 用 PascalCase（Textbox / Rect / Image），
 *   loadFromFabricJson 会把小写 type 自动转成 PascalCase，这里直接写规范形式。
 */

import type {PosterDesignV2Config} from './types';
import {POSTER_ENGINE, POSTER_V2_SCHEMA_VERSION} from './types';

export interface PosterTemplate {
  id: string;
  name: string;
  desc: string;
  canvas: {width: number; height: number};
  background?: {type: 'solid'; color: string} | {type: 'gradient'; gradient: {type: 'linear' | 'radial'; colors: string[]}};
  fabricJson: {version: string; objects: any[]};
}

function text(cfg: {
  id: string;
  role: string;
  text: string;
  left: number;
  top: number;
  width: number;
  fontSize: number;
  fill?: string;
  fontWeight?: string | number;
  textAlign?: 'left' | 'center' | 'right';
}) {
  return {
    type: 'Textbox',
    version: '7.4.0',
    id: cfg.id,
    ddnRole: cfg.role,
    text: cfg.text,
    left: cfg.left,
    top: cfg.top,
    originX: 'left',
    originY: 'top',
    width: cfg.width,
    fontSize: cfg.fontSize,
    fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
    fontWeight: cfg.fontWeight ?? 'normal',
    fill: cfg.fill ?? '#1F2937',
    textAlign: cfg.textAlign ?? 'left',
    splitByGrapheme: true,
  };
}

function rect(cfg: {
  id: string;
  role?: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fill: string;
  rx?: number;
  opacity?: number;
}) {
  return {
    type: 'Rect',
    version: '7.4.0',
    id: cfg.id,
    ddnRole: cfg.role,
    left: cfg.left,
    top: cfg.top,
    originX: 'left',
    originY: 'top',
    width: cfg.width,
    height: cfg.height,
    fill: cfg.fill,
    rx: cfg.rx ?? 0,
    ry: cfg.rx ?? 0,
    opacity: cfg.opacity ?? 1,
  };
}

export const POSTER_TEMPLATES: PosterTemplate[] = [
  {
    id: 'blank-3x4',
    name: '空白竖版',
    desc: '3:4 竖版空白画布，适合直接铺一张 AI 生成的主视觉',
    canvas: {width: 1080, height: 1440},
    background: {type: 'solid', color: '#FFFFFF'},
    fabricJson: {version: '7.4.0', objects: []},
  },
  {
    id: 'card-3x4',
    name: '促销卡片',
    desc: '标题 + 卖点 + 行动条 + 品牌位，电商图最常用的一套',
    canvas: {width: 1080, height: 1440},
    background: {
      type: 'gradient',
      gradient: {type: 'linear', colors: ['#FFF7ED', '#FFE4CC']},
    },
    fabricJson: {
      version: '7.4.0',
      objects: [
        rect({
          id: 'brand-dot',
          role: 'brand',
          left: 80,
          top: 88,
          width: 56,
          height: 56,
          fill: '#F08A24',
          rx: 28,
        }),
        text({
          id: 'brand',
          role: 'brand',
          text: '亿检链',
          left: 152,
          top: 96,
          width: 320,
          fontSize: 34,
          fill: '#4A2C10',
          fontWeight: 'bold',
        }),
        text({
          id: 'title',
          role: 'title',
          text: '在这里写主标题',
          left: 80,
          top: 300,
          width: 920,
          fontSize: 86,
          fill: '#2A1B08',
          fontWeight: 'bold',
        }),
        text({
          id: 'subtitle',
          role: 'subTitle',
          text: '副标题 / 一句话说明',
          left: 80,
          top: 520,
          width: 920,
          fontSize: 40,
          fill: '#6B4A2A',
        }),
        rect({
          id: 'panel',
          role: 'panel',
          left: 80,
          top: 660,
          width: 920,
          height: 360,
          fill: '#FFFFFF',
          rx: 28,
          opacity: 0.92,
        }),
        text({
          id: 'body',
          role: 'body',
          text: '· 要点一\n· 要点二\n· 要点三',
          left: 120,
          top: 700,
          width: 840,
          fontSize: 36,
          fill: '#4A2C10',
        }),
        rect({
          id: 'cta',
          role: 'cta',
          left: 80,
          top: 1200,
          width: 920,
          height: 120,
          fill: '#F08A24',
          rx: 60,
        }),
        text({
          id: 'cta-text',
          role: 'ctaText',
          text: '立即了解',
          left: 80,
          top: 1236,
          width: 920,
          fontSize: 44,
          fill: '#FFFFFF',
          fontWeight: 'bold',
          textAlign: 'center',
        }),
        text({
          id: 'footer',
          role: 'footer',
          text: '页脚说明 / 交付口径',
          left: 80,
          top: 1360,
          width: 920,
          fontSize: 26,
          fill: '#9A7B5B',
          textAlign: 'center',
        }),
      ],
    },
  },
  {
    id: 'banner-16x9',
    name: '宽幅横幅',
    desc: '16:9 横幅，左文右图，适合直播 / 活动入口图',
    canvas: {width: 1920, height: 1080},
    background: {
      type: 'gradient',
      gradient: {type: 'linear', colors: ['#0A2455', '#123A86']},
    },
    fabricJson: {
      version: '7.4.0',
      objects: [
        text({
          id: 'eyebrow',
          role: 'eyebrow',
          text: '人工智能培训',
          left: 120,
          top: 260,
          width: 760,
          fontSize: 40,
          fill: '#E8B24C',
          fontWeight: 'bold',
        }),
        text({
          id: 'title',
          role: 'title',
          text: '主标题写这里',
          left: 120,
          top: 330,
          width: 760,
          fontSize: 96,
          fill: '#FFFFFF',
          fontWeight: 'bold',
        }),
        text({
          id: 'subtitle',
          role: 'subTitle',
          text: '一句话说明',
          left: 120,
          top: 560,
          width: 720,
          fontSize: 44,
          fill: '#C9D8F0',
        }),
        rect({
          id: 'cta',
          role: 'cta',
          left: 120,
          top: 700,
          width: 320,
          height: 96,
          fill: '#E8B24C',
          rx: 48,
        }),
        text({
          id: 'cta-text',
          role: 'ctaText',
          text: '查看详情',
          left: 120,
          top: 726,
          width: 320,
          fontSize: 38,
          fill: '#0A2455',
          fontWeight: 'bold',
          textAlign: 'center',
        }),
        rect({
          id: 'visual',
          role: 'visual',
          left: 1080,
          top: 140,
          width: 720,
          height: 800,
          fill: '#FFFFFF',
          rx: 36,
          opacity: 0.12,
        }),
        text({
          id: 'visual-hint',
          role: 'visualHint',
          text: 'AI 主视觉区',
          left: 1080,
          top: 500,
          width: 720,
          fontSize: 44,
          fill: '#9DB6DF',
          textAlign: 'center',
        }),
        text({
          id: 'footer',
          role: 'footer',
          text: '页脚说明 / 交付口径',
          left: 120,
          top: 960,
          width: 1680,
          fontSize: 26,
          fill: '#7E9BC9',
        }),
      ],
    },
  },
];

export function getTemplate(id: string): PosterTemplate {
  return (
    POSTER_TEMPLATES.find((t) => t.id === id) ?? POSTER_TEMPLATES[0]
  );
}

/** 模板 → 可直接喂给 <PosterEditor> 的设计对象 */
export function templateToDesign(template: PosterTemplate): PosterDesignV2Config {
  return {
    engine: POSTER_ENGINE,
    schemaVersion: POSTER_V2_SCHEMA_VERSION,
    canvas: {...template.canvas},
    templateId: template.id,
    // 背景随设计一起走，否则草稿/导出拿不到背景
    background: template.background
      ? (JSON.parse(JSON.stringify(template.background)) as PosterDesignV2Config['background'])
      : undefined,
    fabricJson: JSON.parse(JSON.stringify(template.fabricJson)),
  };
}
