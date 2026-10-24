/**
 * poster-compliance.ts — 海报文案合规自查
 *
 * 复用 configs/compliance/*.yaml 里已有的规则（词库 + 语义红线 + 缩写 + 旧交付节奏），
 * 对海报里出现的所有文字做扫描。
 *
 * 为什么单独一个文件而不是直接用 check-listing-compliance.ts：
 *   那个检查器绑死了商品图配置结构（商品字段 / 海报 blocks / 详情页文案三段式），
 *   通用海报没有「商品字段」这一层。这里只做「文本 → 规则」这一层，
 *   规则与词库仍然共用同一份配置，不重复维护。
 *
 * 用法：在海报配置里写 `compliance: v8` 就会自动跑；命中即 exit 1。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadComplianceRules, type ComplianceRules } from './compliance';
import { extractBlockTexts, type PosterConfig } from './poster-config';

export interface ComplianceHit {
  scope: string;
  word: string;
  kind: string;
  context: string;
}

/** 词库 → 类别 */
function wordGroups(rules: ComplianceRules): Array<[string, string[] | undefined]> {
  return [
    ['直接禁用词', rules.forbidden.direct],
    ['间接话术', rules.forbidden.indirect],
    ['关联高危词', rules.forbidden.risky],
    ['英文高危词', rules.forbidden.english],
    ['平台高危词', rules.forbidden.platform],
    ['平台绑定词', rules.forbidden.platformBinding],
    ['经营口径词', rules.forbidden.businessHint],
    ['承诺类表述', rules.forbidden.promise],
  ];
}

/** 在一段文本里找出命中的词 */
export function scanPosterText(text: string, rules: ComplianceRules): ComplianceHit[] {
  const hits: ComplianceHit[] = [];
  const lower = text.toLowerCase();

  for (const [kind, words] of wordGroups(rules)) {
    for (const word of words ?? []) {
      const needle = word.toLowerCase();
      if (!needle) continue;
      if (lower.includes(needle)) {
        hits.push({ scope: '海报文案', word, kind, context: text });
      }
    }
  }

  for (const word of rules.themeForbidden ?? []) {
    if (lower.includes(word.toLowerCase())) {
      hits.push({ scope: '海报文案', word, kind: '主题词', context: text });
    }
  }

  for (const word of rules.semanticForbidden ?? []) {
    if (lower.includes(word.toLowerCase())) {
      hits.push({ scope: '海报文案', word, kind: '语义红线', context: text });
    }
  }

  for (const word of rules.staleDelivery?.words ?? []) {
    if (lower.includes(word.toLowerCase())) {
      hits.push({ scope: '海报文案', word, kind: '旧交付口径', context: text });
    }
  }

  for (const rule of rules.acronymForbidden ?? []) {
    const pattern = rule.pattern ? new RegExp(rule.pattern, 'g') : rule.text
      ? new RegExp(rule.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
      : null;
    if (!pattern) continue;
    if (pattern.test(text)) {
      hits.push({
        scope: '海报文案',
        word: rule.label ?? rule.pattern ?? rule.text ?? '',
        kind: '英文缩写断言',
        context: text,
      });
    }
  }

  for (const pattern of rules.staleDelivery?.patterns ?? []) {
    try {
      if (new RegExp(pattern, 'g').test(text)) {
        hits.push({ scope: '海报文案', word: pattern, kind: '旧交付口径', context: text });
      }
    } catch {
      /* 忽略非法正则 */
    }
  }

  return hits;
}

/** 扫描整份海报配置 */
export function checkPosterCompliance(
  config: PosterConfig,
  rules: ComplianceRules,
): ComplianceHit[] {
  const texts = extractBlockTexts(config.blocks ?? []);
  if (config.brand?.text) texts.push(config.brand.text);

  const hits: ComplianceHit[] = [];
  for (const text of texts) {
    hits.push(...scanPosterText(text, rules));
  }
  return hits;
}

/** 加载规则并扫描，返回 { hits, rules } */
export function runPosterCompliance(
  config: PosterConfig,
  rulesId: string,
): { hits: ComplianceHit[]; rules: ComplianceRules } {
  const rulesPath = `./configs/compliance/${rulesId}.yaml`;
  if (!existsSync(resolve(rulesPath))) {
    throw new Error(`找不到合规规则配置：${rulesPath}`);
  }
  const rules = loadComplianceRules(rulesPath);
  return { hits: checkPosterCompliance(config, rules), rules };
}
