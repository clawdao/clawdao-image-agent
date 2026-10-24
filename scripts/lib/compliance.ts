/**
 * compliance.ts — 合规规则的数据模型与加载器
 *
 * 规则全部外置到 configs/compliance/*.yaml：
 *   - 词库（直接禁用 / 间接话术 / 关联高危 / 英文高危 / 平台高危 / 版本专属追加）
 *   - 断言（语义红线、英文缩写、旧交付节奏、主题词、标题结构、品牌位）
 *   - 正向词（覆盖提示）
 *
 * 版本配置用 `extends` 继承基线（configs/compliance/_base.yaml），只写差异项。
 * 加一个版本 = 加一个 YAML，不改检查器代码。
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig, resolveRefs } from './config';

export interface ForbiddenWords {
  /** 直接禁用词 */
  direct: string[];
  /** 间接话术（换皮表达） */
  indirect: string[];
  /** 关联高危词 */
  risky: string[];
  /** 英文高危词 */
  english: string[];
  /** 平台高危词 */
  platform: string[];
  /** 平台绑定词（V8 起） */
  platformBinding?: string[];
  /** 经营口径词（V8 起） */
  businessHint?: string[];
  /** 承诺类表述（V8 起） */
  promise?: string[];
}

export interface RegexRule {
  /** 字面量（与 pattern 二选一） */
  text?: string;
  /** 正则（与 text 二选一） */
  pattern?: string;
  /** 展示名（可选） */
  label?: string;
}

export interface BrandSlotAssertion {
  enabled: boolean;
  /** 允许出现品牌全称的海报文件名 */
  fullBrandOnlyOn: string[];
}

export interface TitleAssertion {
  enabled: boolean;
  /** 修饰词变量名（vars.<modifierVar>） */
  modifierVar: string;
  /** 主标题变量名（vars.<mainVar>） */
  mainVar: string;
  /** 封面海报文件名清单 */
  coverFiles: string[];
  /** 商品名里禁止出现短周期表述（如「3天」） */
  forbidShortCycleInName: boolean;
  /** 交付形式必须包含的词 */
  deliveryMustInclude: string[];
  /** 对外文案必须出现的字面量 / 正则 */
  copyMustInclude: RegexRule[];
  /** 对外文案禁止出现的字面量 */
  copyMustNotInclude: string[];
  /** 页脚白名单（除商品名称外允许的页脚文案） */
  footerAllowlist: string[];
  /** 禁止残留在页脚的旧标题 */
  staleTitles: string[];
}

export interface ComplianceAssertions {
  brandSlot: BrandSlotAssertion;
  title: TitleAssertion;
}

export interface ComplianceRules {
  id: string;
  label?: string;
  extends?: string;
  forbidden: ForbiddenWords;
  /** 主题词（对外 0 次） */
  themeForbidden: string[];
  /** 语义红线（对外 0 次） */
  semanticForbidden: string[];
  /** 英文缩写等正则断言 */
  acronymForbidden: RegexRule[];
  /** 旧交付节奏断言 */
  staleDelivery: { words: string[]; patterns: string[] };
  /** 正向词（覆盖提示） */
  positiveHints: string[];
  assertions: ComplianceAssertions;
  /** 内部运营备注分隔标记 */
  internalMarker: string;
}

/** 合规配置目录（相对 cwd） */
export const COMPLIANCE_CONFIG_DIR = './configs/compliance';

/** 列出所有合规规则配置（不含基线与下划线前缀的公共文件） */
export function listComplianceConfigs(dir = COMPLIANCE_CONFIG_DIR): string[] {
  const abs = resolve(dir);
  if (!existsSync(abs)) return [];
  return readdirSync(abs)
    .filter((name) => /\.(ya?ml|json)$/i.test(name) && !name.startsWith('_'))
    .map((name) => name.replace(/\.(ya?ml|json)$/i, ''))
    .sort();
}

function deepMerge<T extends Record<string, any>>(base: T, override: Record<string, any>): T {
  const out: Record<string, any> = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined) continue;
    if (isPlain(value) && isPlain(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}

function isPlain(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const EMPTY_RULES: ComplianceRules = {
  id: '',
  forbidden: { direct: [], indirect: [], risky: [], english: [], platform: [] },
  themeForbidden: [],
  semanticForbidden: [],
  acronymForbidden: [],
  staleDelivery: { words: [], patterns: [] },
  positiveHints: [],
  assertions: {
    brandSlot: { enabled: false, fullBrandOnlyOn: [] },
    title: {
      enabled: false,
      modifierVar: 'titleModifier',
      mainVar: 'titleMain',
      coverFiles: [],
      forbidShortCycleInName: false,
      deliveryMustInclude: [],
      copyMustInclude: [],
      copyMustNotInclude: [],
      footerAllowlist: [],
      staleTitles: [],
    },
  },
  internalMarker: '## 运营备注',
};

/**
 * 读取合规规则（含 extends 继承链）。
 * extends 用相对 cwd 的路径；基线先加载，版本配置后加载并深度覆盖。
 */
export function loadComplianceRules(filePath: string): ComplianceRules {
  const chain: string[] = [];
  let current = resolve(filePath);
  const seen = new Set<string>();

  while (current) {
    if (seen.has(current)) throw new Error(`合规规则 extends 出现循环：${current}`);
    seen.add(current);
    chain.unshift(current);
    const loaded = loadConfig<Record<string, any>>(current);
    const parent = loaded.data?.extends;
    if (!parent) break;
    current = resolve(parent);
  }

  let merged: Record<string, any> = {};
  for (const path of chain) {
    const loaded = loadConfig<Record<string, any>>(path);
    merged = deepMerge(merged, loaded.data);
  }

  const rules = deepMerge(EMPTY_RULES as unknown as Record<string, any>, merged) as unknown as ComplianceRules;
  // 词库里的每个分组都要是数组
  for (const key of ['direct', 'indirect', 'risky', 'english', 'platform'] as const) {
    if (!Array.isArray(rules.forbidden[key])) rules.forbidden[key] = [];
  }
  for (const key of ['platformBinding', 'businessHint', 'promise'] as const) {
    if (rules.forbidden[key] && !Array.isArray(rules.forbidden[key])) rules.forbidden[key] = [];
  }
  return rules;
}

/** 按 id 加载（configs/compliance/<id>.yaml） */
export function loadComplianceRulesById(id: string, dir = COMPLIANCE_CONFIG_DIR): ComplianceRules {
  const candidates = [
    join(dir, `${id}.yaml`),
    join(dir, `${id}.yml`),
    join(dir, `${id}.json`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return loadComplianceRules(candidate);
  }
  throw new Error(
    `找不到合规规则配置：${id}\n已尝试：${candidates.join('、')}\n可用规则：${listComplianceConfigs(dir).join('、')}`,
  );
}

export { resolveRefs };
