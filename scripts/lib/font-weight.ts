/**
 * font-weight.ts — 读取字体文件里**真实存在**的字重
 *
 * 为什么需要（P1-T2）：
 *   浏览器对「请求的字重不存在」的请求会**静默合成**（synthetic bold），
 *   表面上「渲染成功」，实际字形宽度与设计稿不同 —— 而且没有任何警告。
 *   比如 PingFang SC 只有 W3/W6 两档，请求 900 会被合成，
 *   结果就是「900 的字看起来像 700」但没人知道。
 *
 *   本模块直接读 sfnt/ttc 的 `OS/2.usWeightClass`，把真实字重列出来，
 *   由 `fonts.yaml` 显式登记「这个字重是原生命中还是合成回退」，
 *   渲染前校验不允许出现未登记的静默回退。
 *
 * 支持：TTF / OTF / TTC（TrueType Collection）/ 变量字体 fvar 的 wght 轴
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface FontFaceInfo {
  /** 字体文件名（TTC 里带序号后缀） */
  face: string;
  /** usWeightClass（OS/2 表），100~900 */
  usWeightClass: number;
  /** 变量字体的 wght 轴范围 */
  variableWeight?: { min: number; max: number; default: number };
  /** 是否为 TrueType Collection 的成员 */
  inCollection: boolean;
  /** 集合内序号 */
  index: number;
  /**
   * CSS 能用的 family 名。
   * 关键：TTC 里的多个 face 常常**各有各的 family 名**
   * （如 "Hiragino Sans GB W3" / "Hiragino Sans GB W6" 是两个 family，
   *   而不是同一个 family 的两个字重）。
   * 如果 CSS 里写 'Hiragino Sans GB'，浏览器根本匹配不到任何一个 face，
   * 会静默落到后面的字体 —— 这正是「字重回退静默化」的根源。
   */
  familyNames: string[];
}

export interface FontFileInfo {
  path: string;
  format: 'ttf' | 'otf' | 'ttc' | 'unknown';
  faces: FontFaceInfo[];
  /** 所有字重（升序去重） */
  weights: number[];
  /** 解析过程中的告警 */
  warnings: string[];
}

/** 展开 `~` */
export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2));
  return filePath;
}

function readU16(buf: Buffer, offset: number): number {
  return buf.readUInt16BE(offset);
}
function readU32(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset);
}
function readI16(buf: Buffer, offset: number): number {
  return buf.readInt16BE(offset);
}

/** 从单个 sfnt 字体（offset 指向文件头）里读 OS/2 与 fvar */
function readFace(
  buf: Buffer,
  offset: number,
  faceName: string,
  index: number,
  inCollection: boolean,
  warnings: string[],
): FontFaceInfo | null {
  if (offset + 12 > buf.length) {
    warnings.push(`${faceName}: 文件头越界`);
    return null;
  }
  const tag = buf.readUInt32BE(offset);
  const isTrueType = tag === 0x00010000 || tag === 0x74727565; // 'true'
  const isCff = tag === 0x4f54544f; // 'OTTO'
  if (!isTrueType && !isCff) {
    warnings.push(`${faceName}: 未知 sfnt 版本 0x${tag.toString(16)}`);
    return null;
  }

  const numTables = readU16(buf, offset + 4);
  const tables: Record<string, { offset: number; length: number }> = {};
  for (let i = 0; i < numTables; i += 1) {
    const rec = offset + 12 + i * 16;
    if (rec + 16 > buf.length) break;
    const name = buf.toString('latin1', rec, rec + 4);
    tables[name] = { offset: readU32(buf, rec + 8), length: readU32(buf, rec + 12) };
  }

  let usWeightClass = 400;
  const os2 = tables['OS/2'];
  if (os2 && os2.offset + 8 <= buf.length) {
    usWeightClass = readU16(buf, os2.offset + 4);
  } else {
    warnings.push(`${faceName}: 缺 OS/2 表，字重按 400 记`);
  }

  // —— name 表：取 family 名（nameID 1 / 16）——
  const familyNames = readFamilyNames(buf, tables['name'], warnings, faceName);

  let variableWeight: FontFaceInfo['variableWeight'];
  const fvar = tables['fvar'];
  if (fvar && fvar.offset + 16 <= buf.length) {
    const axesCount = readU16(buf, fvar.offset + 8);
    const axisSize = readU16(buf, fvar.offset + 10);
    for (let i = 0; i < axesCount; i += 1) {
      const axis = fvar.offset + 16 + i * axisSize;
      if (axis + 20 > buf.length) break;
      const axisTag = buf.toString('latin1', axis, axis + 4);
      if (axisTag !== 'wght') continue;
      const min = readI16(buf, axis + 4);
      const def = readI16(buf, axis + 8);
      const max = readI16(buf, axis + 12);
      variableWeight = { min, default: def, max };
      break;
    }
  }

  return { face: faceName, usWeightClass, variableWeight, inCollection, index, familyNames };
}

/** name 表里的 nameID：1=legacy family, 16=typographic family, 21=WWS family */
const NAME_ID_FAMILY = new Set([1, 16, 21]);

/** 读 name 表，抽出 family 名（优先 typographic family，其次 legacy） */
function readFamilyNames(
  buf: Buffer,
  table: { offset: number; length: number } | undefined,
  warnings: string[],
  faceName: string,
): string[] {
  if (!table || table.offset + 6 > buf.length) return [];
  const base = table.offset;
  const count = readU16(buf, base + 2);
  const stringOffset = readU16(buf, base + 4);
  const legacy: string[] = [];
  const typographic: string[] = [];

  for (let i = 0; i < count; i += 1) {
    const rec = base + 6 + i * 12;
    if (rec + 12 > buf.length) break;
    const platformId = readU16(buf, rec);
    const nameId = readU16(buf, rec + 6);
    if (!NAME_ID_FAMILY.has(nameId)) continue;
    const length = readU16(buf, rec + 8);
    const offset = readU16(buf, rec + 10);
    const start = base + stringOffset + offset;
    if (start + length > buf.length) continue;
    const raw = buf.subarray(start, start + length);
    let text: string;
    if (platformId === 3 || platformId === 0) {
      // UTF-16BE
      text = raw.toString('utf16le').split('').reverse().join('').length ? decodeUtf16Be(raw) : '';
    } else {
      text = raw.toString('latin1');
    }
    if (!text) continue;
    if (nameId === 1) legacy.push(text);
    else typographic.push(text);
  }

  const names = [...new Set([...typographic, ...legacy])].filter(Boolean);
  if (!names.length) warnings.push(`${faceName}: name 表里读不到 family 名`);
  return names;
}

/** UTF-16BE 解码 */
function decodeUtf16Be(buf: Buffer): string {
  let out = '';
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16BE(i);
    if (code === 0) continue;
    out += String.fromCharCode(code);
  }
  return out;
}

/** 解析字体文件（TTF / OTF / TTC） */
export function readFontFile(filePath: string): FontFileInfo {
  const abs = expandHome(filePath);
  const warnings: string[] = [];
  if (!existsSync(abs)) {
    return { path: abs, format: 'unknown', faces: [], weights: [], warnings: [`文件不存在：${abs}`] };
  }

  const buf = readFileSync(abs);
  if (buf.length < 12) {
    return { path: abs, format: 'unknown', faces: [], weights: [], warnings: ['文件过小，不是字体'] };
  }

  const tag = buf.toString('latin1', 0, 4);
  const faces: FontFaceInfo[] = [];

  if (tag === 'ttcf') {
    const numFonts = readU32(buf, 8);
    for (let i = 0; i < numFonts; i += 1) {
      const off = 12 + i * 4;
      if (off + 4 > buf.length) break;
      const face = readFace(buf, readU32(buf, off), `${abs}#${i}`, i, true, warnings);
      if (face) faces.push(face);
    }
  } else {
    const face = readFace(buf, 0, abs, 0, false, warnings);
    if (face) faces.push(face);
  }

  const weights = [...new Set(faces.map((f) => f.usWeightClass))].sort((a, b) => a - b);
  const format: FontFileInfo['format'] = tag === 'ttcf' ? 'ttc' : tag === 'OTTO' ? 'otf' : 'ttf';

  return { path: abs, format, faces, weights, warnings };
}

/** 渲染器实际用到的字重档位 */
export const USED_WEIGHTS = [400, 500, 600, 700, 800] as const;

/**
 * 判断「请求字重 → 实际命中」的关系。
 *
 * - `native`      —— 文件里就有这个字重（或变量字体轴覆盖它）
 * - `synthesized` —— 浏览器会用最近的那档合成（视觉有粗细，但不是设计的那一档）
 * - `missing`     —— 文件里一个字重都没有（不该发生）
 */
export type WeightResolution = 'native' | 'synthesized' | 'missing';

export function resolveWeight(info: FontFileInfo, requested: number): WeightResolution {
  if (!info.faces.length) return 'missing';
  for (const face of info.faces) {
    if (face.variableWeight) {
      const { min, max } = face.variableWeight;
      if (requested >= min && requested <= max) return 'native';
    }
    if (face.usWeightClass === requested) return 'native';
  }
  let bestDelta = Infinity;
  for (const face of info.faces) {
    for (const w of [face.usWeightClass, face.variableWeight?.min, face.variableWeight?.max]) {
      if (w == null) continue;
      bestDelta = Math.min(bestDelta, Math.abs(w - requested));
    }
  }
  if (!Number.isFinite(bestDelta)) return 'missing';
  return bestDelta <= 100 ? 'synthesized' : 'missing';
}

/** 人类可读的解析说明 */
export function describeResolution(info: FontFileInfo, requested: number): string {
  const resolution = resolveWeight(info, requested);
  if (resolution === 'native') return `原生命中（文件字重 ${info.weights.join('/')}）`;
  if (resolution === 'missing') return `无匹配字重（文件只有 ${info.weights.join('/')}）`;
  const nearest = info.weights.reduce(
    (best, w) => (Math.abs(w - requested) < Math.abs(best - requested) ? w : best),
    info.weights[0] ?? 400,
  );
  return `合成回退（文件只有 ${info.weights.join('/')}，浏览器会合成到 ${nearest}）`;
}
