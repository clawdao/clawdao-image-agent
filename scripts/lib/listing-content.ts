/**
 * listing-content.ts — 配置 → 渲染素材（海报 blocks + 商品详情文案）
 *
 * 这是「配置驱动」的最后一公里：
 *   配置（YAML/JSON）→ 共享渲染器 → 与旧版完全一致的海报与文案
 *
 * 关键纪律
 *   - 海报 blocks 直接喂给 poster-renderer，不做二次加工，保证像素级一致
 *   - 商品文案由 copy.blocks 渲染，模块 / FAQ / 目标客户等派生内容引用 content 段，
 *     改 content 一处，海报与文案同时变（图与文案同源）
 */

import type { PosterBlock } from '../../src/lib/poster-renderer';
import type { ShopPosterSpec } from '../shop-listing-render';
import type { CopyBlock, ListingConfig } from './listing-config';

/* ============================ 海报 ============================ */

/** 配置 → 渲染流水线用的海报列表 */
export function buildPosters(config: ListingConfig): ShopPosterSpec[] {
  return config.posters.map((poster) => {
    const brand = poster.brand ?? config.brand;
    return brand ? { ...poster, brand } : { ...poster };
  });
}

/* ============================ 商品文案 ============================ */

function renderFields(block: Extract<CopyBlock, { type: 'fields' }>, config: ListingConfig): string {
  const fallback: { label: string; value: string }[] = [
    { label: '商品名称', value: config.product.name ?? '' },
    { label: '商品属性', value: config.product.category ?? '' },
    { label: '售价', value: '以商品后台设置为准（图与文案均不写死价格）' },
    { label: '品牌', value: config.product.brand ?? '' },
    { label: '交付形式', value: config.product.delivery ?? '' },
    { label: '赠品', value: config.product.gifts ?? '' },
    { label: '课程定位', value: config.product.position ?? '' },
  ];
  const fields =
    (block as any).fields && Array.isArray((block as any).fields) ? (block as any).fields : fallback;
  return fields
    .filter((field: { label: string; value: string }) => field.value !== undefined && field.value !== '')
    .map((field: { label: string; value: string }) => `- **${field.label}**：${field.value}`)
    .join('\n');
}

function renderTable(block: Extract<CopyBlock, { type: 'table' }>): string {
  const lines: string[] = [];
  if (block.header?.length) lines.push(`| ${block.header.join(' | ')} |`);
  lines.push(`| ${(block.header ?? block.rows[0] ?? []).map(() => '---').join(' | ')} |`);
  for (const row of block.rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

/** 渲染单个文案块 */
export function renderCopyBlock(block: CopyBlock, config: ListingConfig): string {
  switch (block.type) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`;
    case 'text':
      return block.text;
    case 'fields':
      return renderFields(block, config);
    case 'list':
      return block.items.map((item) => `- ${item}`).join('\n');
    case 'ordered':
      return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'table':
      return renderTable(block);
    case 'quote':
      return block.text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n');
    case 'hr':
      return '---';
    case 'moduleOverview': {
      const modules = (config.content.moduleOverview as any[]) ?? [];
      return modules
        .map((module) => `### ${module.label}｜${module.title}\n\n${(module.lines ?? []).join('')}`)
        .join('\n\n');
    }
    case 'modules': {
      const modules = (config.content.modules as any[]) ?? [];
      return modules
        .map((module) => `### ${module.label}｜${module.title}\n\n${(module.lines ?? []).join('')}`)
        .join('\n\n');
    }
    case 'faq': {
      const items = (config.content.faq as any[]) ?? [];
      return items
        .map((item) => `**${item.label}：${item.title}**\n${(item.lines ?? []).join('')}`)
        .join('\n\n');
    }
    case 'targetTable': {
      const rows = (config.content.targetTable as any[]) ?? [];
      const lines = ['| 人群 | 你能带走什么 |', '| --- | --- |'];
      for (const row of rows) lines.push(`| ${row.who} | ${row.gain} |`);
      return lines.join('\n');
    }
    case 'author': {
      const bullets = (config.author?.bullets ?? []).map((bullet) => `- ${bullet}`).join('\n');
      return `**${config.author?.name} · ${config.author?.role}**\n\n${bullets}`;
    }
    case 'raw':
      return block.text;
    default:
      return '';
  }
}

/** 配置 → 商品详情页 markdown */
export function renderCopyMarkdown(config: ListingConfig): string {
  const parts = config.copy.blocks
    .map((block) => renderCopyBlock(block, config))
    .filter((part) => part !== '');
  return `${parts.join('\n\n')}\n`;
}

/* ============================ 图上可见文本 ============================ */

/**
 * 从海报 blocks 里抽出所有可见文本（标题 / 副标题 / 卡片 / 时间轴 / 问答 / 页脚…）。
 * 合规检查器对「图上文字」与「详情页文案」一视同仁，都过一遍词库。
 */
export function extractBlockTexts(blocks: PosterBlock[]): string[] {
  const out: string[] = [];

  for (const block of blocks) {
    switch (block.kind) {
      case 'hero':
        if (block.kicker) out.push(block.kicker);
        out.push(block.title);
        if (block.subtitle) out.push(block.subtitle);
        if (block.badges) out.push(...block.badges);
        break;
      case 'title': {
        const spec = block.spec;
        if (spec.enLabel) out.push(spec.enLabel);
        if (spec.eyebrow) out.push(spec.eyebrow);
        out.push(spec.title);
        if (spec.subtitle) out.push(spec.subtitle);
        spec.stats?.forEach((stat) => {
          out.push(stat.value);
          out.push(stat.label);
        });
        if (spec.badges) out.push(...block.spec.badges);
        break;
      }
      case 'section':
        out.push(block.label);
        out.push(block.title);
        if (block.desc) out.push(block.desc);
        break;
      case 'cards':
        for (const item of block.items) {
          out.push(item.tag);
          out.push(item.title);
          if (item.lines) out.push(...item.lines);
        }
        break;
      case 'timeline':
        for (const item of block.items) {
          out.push(item.time);
          out.push(item.title);
          if (item.lines) out.push(...item.lines);
        }
        break;
      case 'rows':
        if (block.title) out.push(block.title);
        for (const item of block.items) {
          out.push(item.label);
          out.push(item.title);
          if (item.lines) out.push(...item.lines);
        }
        break;
      case 'profile':
        out.push(block.profile.name);
        out.push(block.profile.role);
        if (block.profile.bullets) out.push(...block.profile.bullets);
        break;
      case 'note':
        out.push(block.text);
        break;
      case 'footer':
        out.push(block.text);
        break;
      default:
        break;
    }
  }

  return out;
}
