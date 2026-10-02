/**
 * prompt_builder.ts — 轻量提示词模板组装器
 *
 * 为什么不用 LangChain？
 *  - 本应用只需要：模板渲染 + 变量替换 + Few-shot 选择
 *  - Node.js 自带 `String.prototype.replace` 完全够用
 *  - 0 依赖、0 启动延迟
 *
 * 用法：
 *   const tpl = readFileSync('prompts/cover.md', 'utf-8');
 *   const prompt = renderTemplate(tpl, {
 *     role: 'ClawDao 图像工厂',
 *     task: '生成直播间封面',
 *     title: '把重复工作，交给数字员工',
 *     ...
 *   });
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PROMPTS_DIR = resolve(process.cwd(), 'prompts');

export interface PromptVars {
  role?: string;
  task?: string;
  title?: string;
  subtitle?: string;
  subtitle_size?: number;
  tags?: string[];
  colorTone?: 'blue_purple' | 'black_gold';
  useLobster?: boolean;
  gifts?: Array<{ name: string; value: string }>;
  refImages_dna?: string;          // 由 multimodal-analyzer 注入
  [key: string]: unknown;
}

/**
 * 渲染模板：把 `{{var}}` 替换为 `vars[var]`，未匹配保留原样。
 */
export function renderTemplate(tpl: string, vars: PromptVars = {}): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (full, key: string) => {
    const value = vars[key];
    if (value === undefined || value === null) return full;
    const arr = Array.isArray(value) ? value.join('、') : value;
    return String(arr).replace(/\$/g, '$$$$');
  });
}

/**
 * 从 prompts 目录读取 .md 文件，并按 vars 渲染。
 * 同时支持 YAML frontmatter 解析（如有）。
 */
export function loadPrompt(name: string, vars: PromptVars = {}): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const path = join(PROMPTS_DIR, `${name}.md`);
  const raw = readFileSync(path, 'utf-8');
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: renderTemplate(raw, vars) };
  }
  return {
    frontmatter: parseSimpleYaml(fmMatch[1]),
    body: renderTemplate(fmMatch[2], vars),
  };
}

/**
 * 极简 YAML 解析 —— 正确处理标量引号剥离、数值、布尔。
 * 支持 v0.1 模板字段：ratio(带引号字符串)、size(对象)、model、tags等。
 */
function parseSimpleYaml(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const stripQuote = (s: string): string => {
    const x = s.trim();
    if (x.length >= 2 && ((x[0] === '"' && x.endsWith('"')) || (x[0] === "'" && x.endsWith("'")))) {
      // 保留内部未配对引号；简单场景直接剥首尾
      return x.slice(1, -1);
    }
    return x;
  };
  for (const line of raw.split('\n')) {
    const m = line.match(/^([\w][\w_]*):\s*(.*?)\s*$/);
    if (!m || m[2] === '') continue;
    const key = m[1];
    const rawVal = m[2].trim();
    let val: unknown = rawVal;

    // 数组 [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      val = rawVal.slice(1, -1).split(',').map(s => stripQuote(s)).filter(s => s !== '');
    }
    // 对象 { a: 1, b: 2 }
    else if (rawVal.startsWith('{') && rawVal.endsWith('}')) {
      const inner: Record<string, unknown> = {};
      for (const pair of rawVal.slice(1, -1).split(',')) {
        const idx = pair.indexOf(':');
        if (idx < 0) continue;
        const k = stripQuote(pair.slice(0, idx));
        const v = pair.slice(idx + 1).trim();
        inner[k] = /^-?\d+$/.test(v) ? Number(v) : stripQuote(v);
      }
      val = inner;
    }
    // 标量
    else {
      const cleaned = stripQuote(rawVal);
      if (cleaned === 'true') val = true;
      else if (cleaned === 'false') val = false;
      else if (cleaned === 'null') val = null;
      else if (/^-?\d+$/.test(cleaned)) val = Number(cleaned);
      else val = cleaned;
    }
    out[key] = val;
  }
  return out;
}
