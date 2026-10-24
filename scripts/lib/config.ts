/**
 * config.ts — 通用配置加载器（JSON / YAML）+ 变量引用解析
 *
 * 设计目标
 *   把「版本差异」从代码里搬到配置文件里：新增一个商品图版本 = 加一个 YAML，
 *   不再新增一个 .ts 脚本。所有配置共用同一套加载与引用语义。
 *
 * 能力
 *   1. 按扩展名自动识别 JSON / YAML（Bun 内置 YAML 解析，零依赖）
 *   2. `{{path.to.value}}` 变量引用：海报 blocks 与商品文案共用同一份内容常量，
 *      改一处两处同步（对应 AGENTS.md 的「图与文案同源」纪律）
 *   3. 数组既支持数字下标，也支持按 label / tag / id / name 命名查找：
 *      `{{content.modules.M1.title}}` 与 `{{content.modules.0.title}}` 等价
 */

import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

export type ConfigFormat = 'json' | 'yaml';

export interface LoadedConfig<T = any> {
  /** 绝对路径 */
  path: string;
  /** 相对 cwd 的路径（打印用） */
  relPath: string;
  format: ConfigFormat;
  data: T;
}

/** 配置文件扩展名 → 解析格式 */
export function detectFormat(filePath: string): ConfigFormat {
  const ext = extname(filePath).toLowerCase();
  if (ext === '.json') return 'json';
  if (ext === '.yaml' || ext === '.yml') return 'yaml';
  throw new Error(`不支持的配置文件格式：${filePath}（支持 .json / .yaml / .yml）`);
}

/** 解析配置文本（JSON / YAML） */
export function parseConfigText(text: string, format: ConfigFormat, filePath: string): any {
  try {
    if (format === 'json') return JSON.parse(text);
    const yaml = (globalThis as any).Bun?.YAML;
    if (!yaml?.parse) {
      throw new Error('当前运行时不支持 Bun.YAML，请改用 .json 配置');
    }
    return yaml.parse(text);
  } catch (error) {
    throw new Error(`配置解析失败：${filePath}\n${(error as Error).message}`);
  }
}

/** 读取并解析一个配置文件（不做引用解析） */
export function loadConfig<T = any>(filePath: string): LoadedConfig<T> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`配置文件不存在：${filePath}`);
  const format = detectFormat(abs);
  const data = parseConfigText(readFileSync(abs, 'utf-8'), format, filePath);
  if (data === null || typeof data !== 'object') {
    throw new Error(`配置文件内容不是对象：${filePath}`);
  }
  return { path: abs, relPath: relative(process.cwd(), abs), format, data: data as T };
}

/* ============================ 变量引用 ============================ */

/** `{{ path.to.value }}` */
const REF_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * 按路径取值。
 *   - 对象：点号逐层下钻
 *   - 数组：数字段按下标；非数字段按 label / tag / id / name 命中
 */
export function resolvePath(root: unknown, path: string): unknown {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean);
  let current: any = root;

  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      if (/^\d+$/.test(segment)) {
        current = current[Number(segment)];
        continue;
      }
      const found = current.find(
        (item) =>
          item &&
          typeof item === 'object' &&
          (item.label === segment ||
            item.tag === segment ||
            item.id === segment ||
            item.name === segment),
      );
      if (!found) return undefined;
      current = found;
      continue;
    }
    if (typeof current === 'object') {
      current = current[segment];
      continue;
    }
    return undefined;
  }
  return current;
}

/** 深拷贝 + 解析所有 `{{...}}` 引用（引用根 = 整份配置） */
export function resolveRefs<T>(node: T, root: unknown = node): T {
  if (typeof node === 'string') {
    // 整串就是一个引用 → 直接返回原值（可能是对象 / 数组）
    const whole = /^\{\{\s*([^{}]+?)\s*\}\}$/.exec(node);
    if (whole) {
      const value = resolvePath(root, whole[1]);
      if (value === undefined || value === null) {
        throw new Error(`配置引用无法解析：${node}`);
      }
      return value as unknown as T;
    }
    // 字符串内嵌引用 → 做字符串插值
    return node.replace(REF_PATTERN, (match, path: string) => {
      const value = resolvePath(root, path);
      if (value === undefined || value === null) {
        throw new Error(`配置引用无法解析：${match}`);
      }
      return String(value);
    }) as unknown as T;
  }
  if (Array.isArray(node)) {
    return node.map((item) => resolveRefs(item, root)) as unknown as T;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      out[key] = resolveRefs(value, root);
    }
    return out as unknown as T;
  }
  return node;
}

/** 把配置里的相对路径字段解析成绝对路径（相对 cwd） */
export function resolvePathFromCwd(value: string, baseDir = process.cwd()): string {
  if (!value) return value;
  if (value.startsWith('data:')) return value;
  return resolve(baseDir, value);
}
