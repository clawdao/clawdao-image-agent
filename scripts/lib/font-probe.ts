/**
 * font-probe.ts — 浏览器内的字体命中实测（权威证据）
 *
 * 为什么必须进浏览器量（而不是只读字体文件）：
 *   字体文件只告诉你「有哪些 face、每个 face 什么字重」，
 *   浏览器实际怎么匹配是另一回事：
 *     • 请求 400，family 里只有 300/600 → 落到 300（真实 face，**没有**合成加粗）
 *     • 请求 600，family 里只有 400      → 落到 400 并**合成加粗**（字形被改过）
 *   这两种情况在文件层看都是「没有这一档」，但**渲染结果完全不同**：
 *     前者字形是真的，只是更细；后者字形被浏览器改粗了。
 *
 * 判定方法（像素级，客观可复现）：
 *   1. 把一段文字画到 canvas，记录 coverage 轮廓指纹
 *   2. 每个候选 family 名各画一遍 → 得到该名字对应的「指纹」
 *      （同名在 TTC 里可能指向**不同**的 face，也可能压根没装 → 指纹与泛型回退相同）
 *   3. 请求字重的指纹 == 某个 face 的指纹 → 落到那一档（native / nearest）
 *   4. 请求字重的指纹谁都不像 → 浏览器合成的加粗（synthesized）
 *
 * 指纹取 alpha 通道的粗网格轮廓（每格是否非零）：
 *   对合成加粗敏感（笔画变宽 → 轮廓变化），对亚像素抗锯齿不敏感（抗锯齿只改灰度）。
 *
 * 本机实测要点（Hiragino Sans GB.ttc）：
 *   • 4 个 face，只有 2 个真的装了：
 *       #0 W3 → 英文名 "Hiragino Sans GB W3" / 简体名 "冬青黑体简体中文 W3" 可用
 *       #2 W6 → 英文名 "Hiragino Sans GB W6" / 简体名 "冬青黑体简体中文 W6" 可用
 *       #1/#3 ".Hiragino Sans GB Interface *" 与繁体名「冬青黑體簡體中文 *」**不可用**
 *   • W3 与 W6 共享 legacy family "Hiragino Sans GB"，
 *     所以 CSS 只写 'Hiragino Sans GB' 时，实际由**字重**决定落 W3 还是 W6。
 */

import type { Page } from 'playwright';

import { readFontFile } from './font-weight';

export interface ProbeFace {
  /** 该 face 在 CSS 里可用的 family 名（浏览器实测确认能解析的那个） */
  familyName: string;
  /** 该 face 的真实字重 */
  usWeightClass: number;
  /** 字体文件路径 */
  file: string;
}

export interface WeightHit {
  requested: number;
  /** 命中的真实 face 名；null = 合成加粗（没落到任何真实 face） */
  face: string | null;
  mode: 'native' | 'nearest' | 'synthesized';
  /** coverage 轮廓指纹 */
  coverage: string;
}

export interface FamilyProbe {
  family: string;
  /** 浏览器是否真的命中了这个 family（与泛型回退的 coverage 不一致） */
  resolved: boolean;
  faces: ProbeFace[];
  hits: WeightHit[];
  equalsGeneric: boolean;
}

export interface FontProbeReport {
  ok: boolean;
  families: FamilyProbe[];
  genericCoverage: string;
  notes: string[];
}

const PROBE_TEXT = '亿检链智能体实操训练营 ABC 123';

/** 名字里带 Latin-1 补充字符的，多半是 UTF-16BE 被当 Latin-1 解出来的乱码 */
function looksMojibake(name: string): boolean {
  return /[\u0080-\u00ff]/.test(name);
}

interface FaceCandidate {
  usWeightClass: number;
  file: string;
  /** 候选名（优先「只有这一个 face 用」的名字） */
  names: string[];
}

/** 收集一个 family 涉及的每个真实 face 及其候选名 */
export function collectFaceCandidates(file: string): FaceCandidate[] {
  const info = readFontFile(file);
  const nameCount = new Map<string, number>();
  for (const face of info.faces) {
    for (const name of face.familyNames) nameCount.set(name, (nameCount.get(name) ?? 0) + 1);
  }
  const candidates: FaceCandidate[] = [];
  for (const face of info.faces) {
    const clean = face.familyNames.filter((n) => !looksMojibake(n));
    const unique = clean.filter((n) => (nameCount.get(n) ?? 0) === 1);
    const names = unique.length ? unique : clean;
    if (!names.length) continue;
    candidates.push({ usWeightClass: face.usWeightClass, file: info.path, names });
  }
  return candidates;
}

/** 在页面里跑的采集脚本（参数内联，避免序列化问题） */
function buildProbeScript(args: {
  text: string;
  families: string[];
  weights: number[];
  names: string[];
  fontSize: number;
  padding: number;
}): string {
  return `(() => {
  const args = ${JSON.stringify(args)};
  const { text, families, weights, names, fontSize, padding } = args;
  const W = 1200, H = 220;

  const coverage = (font) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#000';
    g.textBaseline = 'top';
    g.font = font;
    g.fillText(text, padding, padding);
    const data = g.getImageData(0, 0, W, H).data;
    const CELL = 4;
    const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL);
    let bits = '';
    for (let ry = 0; ry < rows; ry++) {
      for (let cx = 0; cx < cols; cx++) {
        let on = 0;
        for (let y = ry * CELL; y < Math.min((ry + 1) * CELL, H) && !on; y++) {
          for (let x = cx * CELL; x < Math.min((cx + 1) * CELL, W); x++) {
            if (data[(y * W + x) * 4 + 3] > 8) { on = 1; break; }
          }
        }
        bits += on ? '1' : '0';
      }
    }
    let h = 0x811c9dc5;
    for (let i = 0; i < bits.length; i++) {
      h ^= bits.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  };

  const out = { generic: '', families: {}, names: {} };
  out.generic = coverage(fontSize + 'px "__clawdao_missing__", sans-serif');
  for (const n of names) {
    out.names[n] = coverage(fontSize + 'px "' + n.replace(/"/g, '') + '", sans-serif');
  }
  for (const family of families) {
    const stack = '"' + family + '", sans-serif';
    const widths = {};
    for (const w of weights) widths[w] = coverage(w + ' ' + fontSize + 'px ' + stack);
    out.families[family] = widths;
  }
  return out;
})()`;
}

/**
 * 跑一遍浏览器实测。
 * @param page 已经 setContent 过的页面
 * @param specs 要探测的 family 列表（family + 字体文件）
 * @param weights 要探测的请求字重
 */
export async function probeFamilies(
  page: Page,
  specs: { family: string; file: string }[],
  weights: number[] = [300, 400, 500, 600, 700, 800, 900],
): Promise<FontProbeReport> {
  await page.evaluate(() => (document as any).fonts?.ready);

  // 候选 face 与候选名
  const perSpecCandidates: Record<string, FaceCandidate[]> = {};
  const allNames = new Set<string>();
  for (const spec of specs) {
    const candidates = collectFaceCandidates(spec.file);
    perSpecCandidates[spec.family] = candidates;
    for (const c of candidates) for (const n of c.names) allNames.add(n);
    allNames.add(spec.family);
  }

  const script = buildProbeScript({
    text: PROBE_TEXT,
    families: specs.map((s) => s.family),
    weights,
    names: [...allNames],
    fontSize: 64,
    padding: 12,
  });

  const raw = (await page.evaluate(script)) as {
    generic: string;
    families: Record<string, Record<string, string>>;
    names: Record<string, string>;
  };

  const generic = raw.generic;
  const notes: string[] = [];
  const families: FamilyProbe[] = [];

  for (const spec of specs) {
    const candidates = perSpecCandidates[spec.family];

    // 每个 face 挑一个「浏览器确实能解析」的名字
    const faces: ProbeFace[] = [];
    for (const c of candidates) {
      const resolvedName = c.names.find((n) => raw.names[n] && raw.names[n] !== generic);
      if (!resolvedName) continue; // 这个 face 本机没装
      faces.push({
        familyName: resolvedName,
        usWeightClass: c.usWeightClass,
        file: c.file,
      });
    }

    const widths = raw.families[spec.family] ?? {};
    const equalsGeneric = Object.values(widths).every((w) => w === generic);
    const resolved = !equalsGeneric;

    if (!resolved) {
      notes.push(
        `字族「${spec.family}」在浏览器里**没有命中**（像素轮廓与泛型回退完全一致）。` +
          `CSS 会静默落到别的字体。`,
      );
    }
    for (const c of candidates) {
      const installed = faces.some((f) => f.usWeightClass === c.usWeightClass);
      if (!installed) {
        notes.push(
          `字体文件里的 face（字重 ${c.usWeightClass}）本机**没有对应安装**，` +
            `候选名都解析不到：${c.names.slice(0, 3).join(' / ')}`,
        );
      }
    }

    const hits: WeightHit[] = [];
    for (const weight of weights) {
      const cov = widths[String(weight)];
      if (!cov) continue;
      const matched = faces.find((f) => raw.names[f.familyName] === cov);
      if (matched) {
        hits.push({
          requested: weight,
          face: matched.familyName,
          mode: matched.usWeightClass === weight ? 'native' : 'nearest',
          coverage: cov,
        });
      } else {
        hits.push({ requested: weight, face: null, mode: 'synthesized', coverage: cov });
      }
    }

    families.push({ family: spec.family, resolved, faces, hits, equalsGeneric });
  }

  return {
    ok: families.every((f) => f.resolved),
    families,
    genericCoverage: generic,
    notes,
  };
}
