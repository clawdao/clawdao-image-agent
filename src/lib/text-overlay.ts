/**
 * text-overlay.ts — 生成图文字安全排版层
 *
 * image-01 只能"画"文字，中文很容易出现形近乱码。这里只在模型生成的
 * 无字背景上叠加真实文本，确保标题、副标题、标签和福利卡片内容准确。
 */

import sharp from 'sharp';
import type { Category, ColorTone, ThemeConfig } from '../types/index';

const TITLE_FONT =
  "'YouSheBiaoTiHei', 'STKaiti', 'Kaiti SC', 'Hiragino Sans GB', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
const BODY_FONT =
  "'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Arial, sans-serif";

export interface TextOverlayOptions {
  category: Category;
  theme: ThemeConfig & { title: string };
  colorTone?: ColorTone;
}

export interface TextOverlayResult {
  buffer: Buffer;
  width: number;
  height: number;
}

interface ThemePalette {
  titleFrom: string;
  titleMid: string;
  titleTo: string;
  titleStroke: string;
  accent: string;
  accentSoft: string;
}

interface TextElementOptions {
  x: number;
  y: number;
  text: string;
  size: number;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
  anchor?: 'start' | 'middle' | 'end';
  weight?: number;
  family?: string;
  opacity?: number;
  filter?: boolean;
}

const PALETTES: Record<ColorTone, ThemePalette> = {
  black_gold: {
    titleFrom: '#FFF7C2',
    titleMid: '#FFD54A',
    titleTo: '#B9790C',
    titleStroke: '#2A1600',
    accent: '#F5C542',
    accentSoft: '#FFE9A3',
  },
  blue_purple: {
    titleFrom: '#FFFFFF',
    titleMid: '#BFD6FF',
    titleTo: '#A78BFA',
    titleStroke: '#111827',
    accent: '#AFC8FF',
    accentSoft: '#E8EEFF',
  },
};

function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function textUnits(value: string): number {
  let units = 0;
  for (const char of value) {
    if (/\s/.test(char)) units += 0.32;
    else if (/[\u2e80-\u9fff\uff00-\uffef]/.test(char)) units += 1;
    else if (/[A-Z0-9]/.test(char)) units += 0.62;
    else units += 0.52;
  }
  return units;
}

function wrapText(value: string, maxUnits: number, maxLines: number): string[] {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const lines: string[] = [];
  let line = '';
  let lineUnits = 0;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    const charUnits = textUnits(char);
    if (line && lineUnits + charUnits > maxUnits) {
      lines.push(line.trimEnd());
      line = '';
      lineUnits = 0;
      if (lines.length === maxLines - 1) {
        const rest = text.slice(index);
        if (textUnits(rest) <= maxUnits) {
          lines.push(rest.trim());
        } else {
          let clipped = '';
          let clippedUnits = 0;
          for (const restChar of rest) {
            const restUnits = textUnits(restChar);
            if (clippedUnits + restUnits > Math.max(1, maxUnits - 1)) break;
            clipped += restChar;
            clippedUnits += restUnits;
          }
          lines.push(`${clipped.trimEnd()}…`);
        }
        return lines;
      }
      line += char;
      lineUnits = charUnits;
    } else {
      line += char;
      lineUnits += charUnits;
    }
  }

  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, maxLines);
}

function fitTitle(
  title: string,
  width: number,
  maxWidthRatio: number,
  preferredSize: number,
  minSize: number,
  maxLines: number,
): { lines: string[]; size: number; lineHeight: number } {
  const maxWidth = width * maxWidthRatio;
  for (let size = preferredSize; size >= minSize; size -= 2) {
    const unitsPerLine = Math.max(1, maxWidth / (size * 1.03));
    const lines = wrapText(title, unitsPerLine, maxLines);
    const consumed = lines.join('').replace(/…$/, '').replace(/\s/g, '');
    const expected = title.replace(/\s/g, '');
    if (consumed.length >= expected.length - 1) {
      return { lines, size, lineHeight: size * 1.18 };
    }
  }
  const unitsPerLine = Math.max(1, maxWidth / (minSize * 1.03));
  return {
    lines: wrapText(title, unitsPerLine, maxLines),
    size: minSize,
    lineHeight: minSize * 1.18,
  };
}

function fitSingleLine(value: string, width: number, preferredSize: number, minSize: number): number {
  const units = Math.max(0.1, textUnits(value));
  const maxSize = width / (units * 1.04);
  return Math.max(minSize, Math.min(preferredSize, maxSize));
}

function subtitleBaselineAfterTitle(
  titleBaseline: number,
  lineHeight: number,
  lineCount: number,
  titleSize: number,
  subtitleSize: number,
): number {
  const titleVisualBottom = titleBaseline + Math.max(0, lineCount - 1) * lineHeight + titleSize * 0.18;
  const safeGap = Math.max(12, titleSize * 0.22);
  return titleVisualBottom + safeGap + subtitleSize * 0.82;
}

function textElement(options: TextElementOptions): string {
  const {
    x,
    y,
    text,
    size,
    fill,
    stroke,
    strokeWidth = 0,
    anchor = 'start',
    weight = 700,
    family = BODY_FONT,
    opacity = 1,
    filter = true,
  } = options;
  const strokeAttrs = stroke
    ? ` stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill"`
    : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="${family}" font-size="${size.toFixed(1)}" font-weight="${weight}" fill="${fill}" fill-opacity="${opacity}"${strokeAttrs}${filter ? ' filter="url(#textShadow)"' : ''}>${escapeXml(text)}</text>`;
}

function multilineTextElement(
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  options: Omit<TextElementOptions, 'x' | 'y' | 'text'>,
): string {
  if (lines.length === 0) return '';
  return `<text x="${x.toFixed(1)}" y="${firstBaseline.toFixed(1)}" text-anchor="${options.anchor ?? 'start'}" font-family="${options.family ?? BODY_FONT}" font-size="${options.size.toFixed(1)}" font-weight="${options.weight ?? 700}" fill="${options.fill}" fill-opacity="${options.opacity ?? 1}"${options.stroke ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth ?? 0}" paint-order="stroke fill"` : ''}${options.filter === false ? '' : ' filter="url(#textShadow)"'}>${lines.map((line, index) => `<tspan x="${x.toFixed(1)}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
}

function tagsSvg(
  tags: string[] | undefined,
  x: number,
  y: number,
  maxWidth: number,
  palette: ThemePalette,
  centered = false,
  preferredSize = 28,
): string {
  const normalized = (tags ?? [])
    .map((tag) => String(tag ?? '').trim())
    .filter(Boolean)
    .slice(0, 8);
  if (normalized.length === 0) return '';

  let fontSize = preferredSize;
  let widths: number[] = [];
  const gap = Math.max(8, fontSize * 0.45);
  const horizontalPadding = fontSize * 0.72;
  const pillHeight = fontSize * 1.72;

  for (let attempt = 0; attempt < 8; attempt++) {
    widths = normalized.map((tag) => Math.min(maxWidth, horizontalPadding * 2 + textUnits(tag) * fontSize));
    const total = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
    if (total <= maxWidth) break;
    fontSize *= 0.88;
  }

  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + gap * (widths.length - 1);
  let cursor = centered ? x - totalWidth / 2 : x;
  const elements: string[] = [];

  for (let index = 0; index < normalized.length; index++) {
    const width = widths[index];
    elements.push(
      `<rect x="${cursor.toFixed(1)}" y="${(y - pillHeight / 2).toFixed(1)}" width="${width.toFixed(1)}" height="${pillHeight.toFixed(1)}" rx="${(pillHeight / 2).toFixed(1)}" fill="#05070D" fill-opacity="0.66" stroke="${palette.accent}" stroke-width="1.5"/>`,
    );
    elements.push(
      textElement({
        x: cursor + width / 2,
        y: y + fontSize * 0.34,
        text: normalized[index],
        size: fontSize,
        fill: palette.accentSoft,
        anchor: 'middle',
        weight: 600,
        filter: false,
      }),
    );
    cursor += width + gap;
  }
  return elements.join('');
}

function commonDefs(palette: ThemePalette, width: number, height: number): string {
  return `<defs>
    <linearGradient id="titleGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${palette.titleFrom}"/>
      <stop offset="48%" stop-color="${palette.titleMid}"/>
      <stop offset="100%" stop-color="${palette.titleTo}"/>
    </linearGradient>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="leftScrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.58"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <filter id="textShadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="${Math.max(2, Math.round(height * 0.004))}" stdDeviation="${Math.max(2, Math.round(width * 0.004))}" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
  </defs>`;
}

function renderCover(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const titleFit = fitTitle(theme.title, width, 0.88, width * 0.092, width * 0.055, 2);
  const titleTop = height * 0.105;
  const titleBaseline = titleTop + titleFit.size;
  const subtitleSize = fitSingleLine(theme.subtitle ?? '', width * 0.84, width * 0.031, width * 0.021);
  const subtitleY = subtitleBaselineAfterTitle(titleBaseline, titleFit.lineHeight, titleFit.lines.length, titleFit.size, subtitleSize);
  const tagsY = subtitleY + subtitleSize * 1.85;
  const parts = [
    `<rect width="${width}" height="${height * 0.55}" fill="url(#topScrim)"/>`,
    multilineTextElement(titleFit.lines, width / 2, titleBaseline, titleFit.lineHeight, {
      size: titleFit.size,
      fill: 'url(#titleGradient)',
      stroke: palette.titleStroke,
      strokeWidth: Math.max(1.5, titleFit.size * 0.035),
      anchor: 'middle',
      weight: 800,
      family: TITLE_FONT,
    }),
  ];

  if (theme.subtitle?.trim()) {
    parts.push(
      textElement({
        x: width / 2,
        y: subtitleY,
        text: theme.subtitle,
        size: subtitleSize,
        fill: '#FFFFFF',
        anchor: 'middle',
        weight: 600,
        opacity: 0.96,
      }),
    );
  }
  parts.push(tagsSvg(theme.tags, width / 2, tagsY, width * 0.88, palette, true, width * 0.023));
  return parts.join('');
}

function renderCustom(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const x = width * 0.065;
  const maxWidth = width * 0.64;
  const titleFit = fitTitle(theme.title, width, 0.64, width * 0.068, width * 0.038, 2);
  const titleTop = height * 0.16;
  const titleBaseline = titleTop + titleFit.size;
  const subtitleSize = fitSingleLine(theme.subtitle ?? '', maxWidth, width * 0.022, width * 0.014);
  const subtitleY = subtitleBaselineAfterTitle(titleBaseline, titleFit.lineHeight, titleFit.lines.length, titleFit.size, subtitleSize);
  const tagsY = subtitleY + subtitleSize * 1.9;
  const parts = [
    `<rect width="${width * 0.78}" height="${height * 0.72}" fill="url(#leftScrim)"/>`,
    multilineTextElement(titleFit.lines, x, titleBaseline, titleFit.lineHeight, {
      size: titleFit.size,
      fill: 'url(#titleGradient)',
      stroke: palette.titleStroke,
      strokeWidth: Math.max(1.5, titleFit.size * 0.035),
      anchor: 'start',
      weight: 800,
      family: TITLE_FONT,
    }),
  ];
  if (theme.subtitle?.trim()) {
    parts.push(
      textElement({
        x,
        y: subtitleY,
        text: theme.subtitle,
        size: subtitleSize,
        fill: '#FFFFFF',
        anchor: 'start',
        weight: 600,
        opacity: 0.96,
      }),
    );
  }
  parts.push(tagsSvg(theme.tags, x, tagsY, maxWidth, palette, false, width * 0.015));
  return parts.join('');
}

function renderTopBanner(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const x = width * 0.055;
  const maxWidth = width * 0.62;
  const titleFit = fitTitle(theme.title, width, 0.62, height * 0.25, height * 0.13, 2);
  const blockHeight = titleFit.lineHeight * titleFit.lines.length;
  const firstBaseline = Math.max(height * 0.3, (height - blockHeight) / 2 + titleFit.size * 0.78);
  const subtitleSize = fitSingleLine(theme.subtitle ?? '', maxWidth, height * 0.08, height * 0.045);
  const subtitleY = subtitleBaselineAfterTitle(firstBaseline, titleFit.lineHeight, titleFit.lines.length, titleFit.size, subtitleSize);
  const parts = [
    `<rect width="${width * 0.82}" height="${height}" fill="url(#leftScrim)"/>`,
    multilineTextElement(titleFit.lines, x, firstBaseline, titleFit.lineHeight, {
      size: titleFit.size,
      fill: 'url(#titleGradient)',
      stroke: palette.titleStroke,
      strokeWidth: Math.max(1.2, titleFit.size * 0.03),
      anchor: 'start',
      weight: 800,
      family: TITLE_FONT,
    }),
  ];
  if (theme.subtitle?.trim()) {
    parts.push(
      textElement({
        x,
        y: subtitleY,
        text: theme.subtitle,
        size: subtitleSize,
        fill: '#FFFFFF',
        anchor: 'start',
        weight: 600,
      }),
    );
  }
  return parts.join('');
}

function renderMidBanner(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const titleFit = fitTitle(theme.title, width, 0.84, height * 0.22, height * 0.12, 1);
  const titleY = height * 0.44;
  const tagsY = height * 0.7;
  return [
    `<rect width="${width}" height="${height}" fill="#000000" fill-opacity="0.12"/>`,
    multilineTextElement(titleFit.lines, width / 2, titleY, titleFit.lineHeight, {
      size: titleFit.size,
      fill: 'url(#titleGradient)',
      stroke: palette.titleStroke,
      strokeWidth: Math.max(1.4, titleFit.size * 0.032),
      anchor: 'middle',
      weight: 800,
      family: TITLE_FONT,
    }),
    tagsSvg(theme.tags, width / 2, tagsY, width * 0.82, palette, true, height * 0.07),
  ].join('');
}

function renderPopup(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const titleFit = fitTitle(theme.title, width, 0.84, width * 0.082, width * 0.045, 1);
  const cardX = width * 0.075;
  const cardWidth = width * 0.58;
  const cardTop = height * 0.19;
  const cardHeight = height * 0.145;
  const cardGap = height * 0.035;
  const parts = [
    `<rect width="${width}" height="${height * 0.32}" fill="url(#topScrim)"/>`,
    multilineTextElement(titleFit.lines, width / 2, height * 0.1 + titleFit.size, titleFit.lineHeight, {
      size: titleFit.size,
      fill: 'url(#titleGradient)',
      stroke: palette.titleStroke,
      strokeWidth: Math.max(1.3, titleFit.size * 0.03),
      anchor: 'middle',
      weight: 800,
      family: TITLE_FONT,
    }),
  ];

  const gifts = (theme.gifts ?? []).filter((gift) => gift.name?.trim()).slice(0, 3);
  for (let index = 0; index < gifts.length; index++) {
    const gift = gifts[index];
    const y = cardTop + index * (cardHeight + cardGap);
    const nameSize = fitSingleLine(gift.name, cardWidth * 0.68, width * 0.026, width * 0.016);
    parts.push(
      `<rect x="${cardX.toFixed(1)}" y="${y.toFixed(1)}" width="${cardWidth.toFixed(1)}" height="${cardHeight.toFixed(1)}" rx="${(cardHeight * 0.18).toFixed(1)}" fill="#FFFFFF" fill-opacity="0.91" stroke="${palette.accent}" stroke-width="2"/>`,
      textElement({
        x: cardX + cardWidth * 0.07,
        y: y + cardHeight * 0.62,
        text: gift.name,
        size: nameSize,
        fill: '#172033',
        anchor: 'start',
        weight: 700,
        filter: false,
      }),
      textElement({
        x: cardX + cardWidth * 0.94,
        y: y + cardHeight * 0.63,
        text: gift.value ? `¥${gift.value}` : '',
        size: width * 0.027,
        fill: palette.accent,
        anchor: 'end',
        weight: 800,
        filter: false,
      }),
    );
  }

  parts.push(
    textElement({
      x: width / 2,
      y: height * 0.94,
      text: '* 福利仅限直播间领取，具体以活动说明为准',
      size: width * 0.017,
      fill: '#FFFFFF',
      anchor: 'middle',
      weight: 400,
      opacity: 0.76,
      filter: false,
    }),
  );
  return parts.join('');
}

export function buildTextOverlaySvg(
  category: Category,
  theme: ThemeConfig & { title: string },
  width: number,
  height: number,
  colorTone: ColorTone = 'black_gold',
): string {
  const palette = PALETTES[colorTone] ?? PALETTES.black_gold;
  let content = '';
  switch (category) {
    case 'cover':
      content = renderCover(width, height, theme, palette);
      break;
    case 'top_banner':
      content = renderTopBanner(width, height, theme, palette);
      break;
    case 'mid_banner':
      content = renderMidBanner(width, height, theme, palette);
      break;
    case 'popup':
      content = renderPopup(width, height, theme, palette);
      break;
    case 'custom':
    default:
      content = renderCustom(width, height, theme, palette);
      break;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${commonDefs(palette, width, height)}${content}</svg>`;
}

/**
 * 在真实生成图上叠加精确文本，并返回实际输出尺寸。
 */
export async function applyTextOverlay(
  image: Buffer,
  options: TextOverlayOptions,
): Promise<TextOverlayResult> {
  const metadata = await sharp(image).metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const svg = buildTextOverlaySvg(
    options.category,
    options.theme,
    width,
    height,
    options.colorTone ?? 'black_gold',
  );
  const buffer = await sharp(image)
    .rotate()
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .jpeg({quality: 94, chromaSubsampling: '4:4:4'})
    .toBuffer();
  return {buffer, width, height};
}
