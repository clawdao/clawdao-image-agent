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
  /**
   * 排版布局：
   * - left（默认）：标题靠左，预留右侧放 IP（顶/中广告条）
   * - center：标题居中，标题下方一条水平光带 + 副标题 + 底部装饰线（黑金商务 banner）
   */
  layout?: 'left' | 'center';
}

export interface TextOverlayResult {
  buffer: Buffer;
  width: number;
  height: number;
}

interface ThemePalette {
  /** 标题金属渐变色带（自上而下） */
  metal: string[];
  titleStroke: string;
  /** 3D 挤出层颜色 */
  extrude: string;
  /** 标题外发光颜色 */
  glow: string;
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
  /** SVG 滤镜 id，默认 textShadow */
  filterId?: string;
  /** 裁剪路径 id（用于金属高光层只落在字形内） */
  clipPath?: string;
  /** 字间距（px） */
  letterSpacing?: number;
}

const PALETTES: Record<ColorTone, ThemePalette> = {
  black_gold: {
    metal: ['#FFFBE8', '#FFE49A', '#EFB024', '#7A4A03', '#C98C10', '#FFD96B', '#FFF4CC'],
    titleStroke: '#2A1600',
    extrude: '#4A2A05',
    glow: '#FFC24A',
    accent: '#F5C542',
    accentSoft: '#FFE9A3',
  },
  blue_purple: {
    metal: ['#FFFFFF', '#EAF1FF', '#C3D6FF', '#6D5FD0', '#A78BFA', '#DDE6FF', '#FFFFFF'],
    titleStroke: '#111827',
    extrude: '#2A2350',
    glow: '#A78BFA',
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

/**
 * 文本原子单元：中文逐字、英文/数字成词。
 * 英文单词不可在词内断行，避免出现 "Cla / wDao" 这类断裂。
 */
interface TextToken {
  text: string;
  units: number;
}

const LATIN_WORD_RE = /[A-Za-z0-9._'&+\-]/;

function tokenize(value: string): TextToken[] {
  const tokens: TextToken[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (/\s/.test(char)) {
      tokens.push({ text: char, units: textUnits(char) });
      index += 1;
      continue;
    }
    if (/[\u2e80-\u9fff\uff00-\uffef]/.test(char)) {
      tokens.push({ text: char, units: 1 });
      index += 1;
      continue;
    }
    if (LATIN_WORD_RE.test(char)) {
      let end = index;
      while (end < value.length && LATIN_WORD_RE.test(value[end])) end += 1;
      const word = value.slice(index, end);
      tokens.push({ text: word, units: textUnits(word) });
      index = end;
      continue;
    }
    tokens.push({ text: char, units: textUnits(char) });
    index += 1;
  }
  return tokens;
}

function wrapText(value: string, maxUnits: number, maxLines: number): string[] {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return [];

  const tokens = tokenize(text);
  const lines: string[] = [];
  let line = '';
  let lineUnits = 0;

  /** 剩余部分塞进最后一行；放不下则截断并加省略号 */
  const pushRemainder = (from: number): string[] => {
    const rest = tokens.slice(from).map((token) => token.text).join('').trim();
    if (textUnits(rest) <= maxUnits) return [rest];
    let clipped = '';
    let clippedUnits = 0;
    for (const token of tokens.slice(from)) {
      if (clippedUnits + token.units > Math.max(1, maxUnits - 1)) break;
      clipped += token.text;
      clippedUnits += token.units;
    }
    return [`${clipped.trimEnd()}…`];
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (line && lineUnits + token.units > maxUnits) {
      lines.push(line.trimEnd());
      line = '';
      lineUnits = 0;
      if (lines.length === maxLines - 1) {
        lines.push(...pushRemainder(index));
        return lines;
      }
    }
    line += token.text;
    lineUnits += token.units;
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
    filterId = 'textShadow',
    clipPath,
    letterSpacing,
  } = options;
  const strokeAttrs = stroke
    ? ` stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill"`
    : '';
  const clipAttr = clipPath ? ` clip-path="url(#${clipPath})"` : '';
  const spacingAttr = letterSpacing ? ` letter-spacing="${letterSpacing.toFixed(2)}"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="${family}" font-size="${size.toFixed(1)}" font-weight="${weight}"${spacingAttr} fill="${fill}" fill-opacity="${opacity}"${strokeAttrs}${clipAttr}${filter ? ` filter="url(#${filterId})"` : ''}>${escapeXml(text)}</text>`;
}

function multilineTextElement(
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  options: Omit<TextElementOptions, 'x' | 'y' | 'text'>,
): string {
  if (lines.length === 0) return '';
  const strokeAttrs = options.stroke
    ? ` stroke="${options.stroke}" stroke-width="${options.strokeWidth ?? 0}" paint-order="stroke fill"`
    : '';
  const clipAttr = options.clipPath ? ` clip-path="url(#${options.clipPath})"` : '';
  const filterAttr = options.filter === false
    ? ''
    : ` filter="url(#${options.filterId ?? 'textShadow'})"`;
  return `<text x="${x.toFixed(1)}" y="${firstBaseline.toFixed(1)}" text-anchor="${options.anchor ?? 'start'}" font-family="${options.family ?? BODY_FONT}" font-size="${options.size.toFixed(1)}" font-weight="${options.weight ?? 700}" fill="${options.fill}" fill-opacity="${options.opacity ?? 1}"${strokeAttrs}${clipAttr}${filterAttr}>${lines.map((line, index) => `<tspan x="${x.toFixed(1)}" dy="${index === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`).join('')}</text>`;
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
  const metalStops = palette.metal
    .map((color, index) => {
      const offset = Math.round((index / Math.max(1, palette.metal.length - 1)) * 100);
      return `<stop offset="${offset}%" stop-color="${color}"/>`;
    })
    .join('');
  return `<defs>
    <linearGradient id="titleGradient" x1="0" y1="0" x2="0" y2="1">
      ${metalStops}
    </linearGradient>
    <linearGradient id="titleShine" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.55"/>
      <stop offset="24%" stop-color="#FFFFFF" stop-opacity="0.08"/>
      <stop offset="42%" stop-color="#FFFFFF" stop-opacity="0"/>
      <stop offset="58%" stop-color="#FFFFFF" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="topScrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="leftScrim" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.62"/>
      <stop offset="70%" stop-color="#000000" stop-opacity="0.24"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="lightBand" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0"/>
      <stop offset="26%" stop-color="${palette.accent}" stop-opacity="0.28"/>
      <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.92"/>
      <stop offset="74%" stop-color="${palette.accent}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="bandCore" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.88"/>
      <stop offset="45%" stop-color="${palette.accentSoft}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="topWarmGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.5"/>
      <stop offset="38%" stop-color="#8A5A1E" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="cornerShade" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0%" stop-color="#000000" stop-opacity="0.95"/>
      <stop offset="55%" stop-color="#000000" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bottomShade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.55"/>
    </linearGradient>
    <filter id="textShadow" x="-30%" y="-30%" width="160%" height="180%">
      <feDropShadow dx="0" dy="${Math.max(2, Math.round(height * 0.004))}" stdDeviation="${Math.max(2, Math.round(width * 0.004))}" flood-color="#000000" flood-opacity="0.9"/>
    </filter>
    <filter id="titleGlow" x="-30%" y="-40%" width="160%" height="200%">
      <feDropShadow dx="0" dy="${Math.max(2, Math.round(height * 0.005))}" stdDeviation="${Math.max(2, Math.round(width * 0.0025))}" flood-color="#000000" flood-opacity="0.95"/>
      <feDropShadow dx="0" dy="0" stdDeviation="${Math.max(3, Math.round(width * 0.0035))}" flood-color="${palette.glow}" flood-opacity="0.2"/>
    </filter>
  </defs>`;
}

/** 标题裁剪路径序号（每次 buildTextOverlaySvg 重置） */
let clipSeq = 0;

function nextClipId(prefix: string): string {
  clipSeq += 1;
  return `${prefix}${clipSeq}`;
}

/**
 * 艺术字标题：3D 挤出层 + 金属渐变主体 + 顶部高光层 + 描边 + 外发光。
 * 高光层通过 clipPath 裁到字形内部，避免溢出笔画形成"糊边"。
 */
function artisticTitle(
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  size: number,
  palette: ThemePalette,
  anchor: 'start' | 'middle' | 'end',
): string {
  if (lines.length === 0) return '';
  const clipId = nextClipId('titleClip');
  const base = {
    size,
    anchor,
    weight: 800 as const,
    family: TITLE_FONT,
  };
  const depth = Math.max(1, size * 0.026);

  const clipDef = `<clipPath id="${clipId}">${multilineTextElement(lines, x, firstBaseline, lineHeight, {
    ...base,
    fill: '#000000',
    filter: false,
  })}</clipPath>`;

  const extrude = multilineTextElement(lines, x, firstBaseline + depth, lineHeight, {
    ...base,
    fill: palette.extrude,
    filter: false,
  });

  const main = multilineTextElement(lines, x, firstBaseline, lineHeight, {
    ...base,
    fill: 'url(#titleGradient)',
    stroke: palette.titleStroke,
    strokeWidth: Math.max(1.6, size * 0.042),
    filterId: 'titleGlow',
  });

  const shine = multilineTextElement(lines, x, firstBaseline, lineHeight, {
    ...base,
    fill: 'url(#titleShine)',
    filter: false,
    clipPath: clipId,
  });

  return `${clipDef}${extrude}${main}${shine}`;
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
    artisticTitle(titleFit.lines, width / 2, titleBaseline, titleFit.lineHeight, titleFit.size, palette, 'middle'),
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
    artisticTitle(titleFit.lines, x, titleBaseline, titleFit.lineHeight, titleFit.size, palette, 'start'),
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
  const maxWidth = width * 0.64;
  const titleFit = fitTitle(theme.title, width, 0.64, height * 0.28, height * 0.14, 2);
  const blockHeight = titleFit.lineHeight * titleFit.lines.length;
  const firstBaseline = Math.max(height * 0.3, (height - blockHeight) / 2 + titleFit.size * 0.78);
  const subtitleSize = fitSingleLine(theme.subtitle ?? '', maxWidth, height * 0.08, height * 0.045);
  const subtitleY = subtitleBaselineAfterTitle(firstBaseline, titleFit.lineHeight, titleFit.lines.length, titleFit.size, subtitleSize);
  const parts = [
    `<rect width="${width * 0.88}" height="${height}" fill="url(#leftScrim)"/>`,
    artisticTitle(titleFit.lines, x, firstBaseline, titleFit.lineHeight, titleFit.size, palette, 'start'),
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
    artisticTitle(titleFit.lines, width / 2, titleY, titleFit.lineHeight, titleFit.size, palette, 'middle'),
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
    artisticTitle(titleFit.lines, width / 2, height * 0.1 + titleFit.size, titleFit.lineHeight, titleFit.size, palette, 'middle'),
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

/**
 * 居中商务 banner（黑金直播 banner 风格）：
 * 纯色底图上居中一行金属艺术字，标题下方一条水平光带，
 * 再下方是浅色副标题，最底部是三段金色装饰线。
 */
function renderCenterBanner(width: number, height: number, theme: ThemeConfig, palette: ThemePalette): string {
  const titleFit = fitTitle(theme.title, width, 0.62, height * 0.36, height * 0.18, 1);
  const titleBaseline = height * 0.46;
  const bandY = height * 0.575;
  const subtitleBaseline = height * 0.7;
  const decoY = height * 0.79;

  const parts: string[] = [
    // 顶部暖金光晕：本地绘制，保证商务氛围不依赖 AI 随机结果
    `<ellipse cx="${(width * 0.6).toFixed(1)}" cy="${(height * 0.12).toFixed(1)}" rx="${(width * 0.5).toFixed(1)}" ry="${(height * 0.62).toFixed(1)}" fill="url(#topWarmGlow)"/>`,
    // 右上角压暗：抹掉 AI 偶尔画出的颗粒/星点
    `<ellipse cx="${(width * 1.0).toFixed(1)}" cy="${(height * 0.02).toFixed(1)}" rx="${(width * 0.45).toFixed(1)}" ry="${(height * 0.75).toFixed(1)}" fill="url(#cornerShade)"/>`,
    // 底部压暗：提亮文字对比，同时收掉底部杂点
    `<rect x="0" y="${(height * 0.58).toFixed(1)}" width="${width}" height="${(height * 0.42).toFixed(1)}" fill="url(#bottomShade)"/>`,
    // 水平光带：中间最亮，向两边衰减
    `<rect x="0" y="${(bandY - height * 0.007).toFixed(1)}" width="${width}" height="${(height * 0.014).toFixed(1)}" fill="url(#lightBand)"/>`,
    `<ellipse cx="${(width / 2).toFixed(1)}" cy="${bandY.toFixed(1)}" rx="${(width * 0.09).toFixed(1)}" ry="${(height * 0.07).toFixed(1)}" fill="url(#bandCore)"/>`,
    artisticTitle(titleFit.lines, width / 2, titleBaseline, titleFit.lineHeight, titleFit.size, palette, 'middle'),
  ];

  if (theme.subtitle?.trim()) {
    const subtitleSize = fitSingleLine(theme.subtitle, width * 0.66, height * 0.066, height * 0.04);
    parts.push(
      textElement({
        x: width / 2,
        y: subtitleBaseline,
        text: theme.subtitle,
        size: subtitleSize,
        fill: '#EDEDF0',
        anchor: 'middle',
        weight: 600,
        letterSpacing: subtitleSize * 0.08,
      }),
    );
  }

  // 底部三段装饰线：中间最长最亮
  const segWidths = [width * 0.03, width * 0.05, width * 0.03];
  const segGap = width * 0.007;
  const segTotal = segWidths.reduce((sum, value) => sum + value, 0) + segGap * (segWidths.length - 1);
  let cursor = width / 2 - segTotal / 2;
  const segColors = [palette.accent, '#FFF3D0', palette.accent];
  segWidths.forEach((segWidth, index) => {
    parts.push(
      `<rect x="${cursor.toFixed(1)}" y="${(decoY - height * 0.004).toFixed(1)}" width="${segWidth.toFixed(1)}" height="${(height * 0.008).toFixed(1)}" fill="${segColors[index]}" fill-opacity="${index === 1 ? 0.95 : 0.68}"/>`,
    );
    cursor += segWidth + segGap;
  });

  return parts.join('');
}

export function buildTextOverlaySvg(
  category: Category,
  theme: ThemeConfig & { title: string },
  width: number,
  height: number,
  colorTone: ColorTone = 'black_gold',
  layout: 'left' | 'center' = 'left',
): string {
  clipSeq = 0;
  const palette = PALETTES[colorTone] ?? PALETTES.black_gold;
  let content = '';
  if (layout === 'center') {
    content = renderCenterBanner(width, height, theme, palette);
  } else {
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
    options.layout ?? 'left',
  );
  const buffer = await sharp(image)
    .rotate()
    .composite([{input: Buffer.from(svg), top: 0, left: 0}])
    .jpeg({quality: 94, chromaSubsampling: '4:4:4'})
    .toBuffer();
  return {buffer, width, height};
}
