/**
 * check-listing-compliance.ts — 视频号小店 / 视频号、抖音尚品「教育培训类目」合规自查
 *
 * 依据官方规则（教育培训类目）：
 *   暂不开放售卖「教授使用 AI 开展商业活动或营利」的课程
 *   （使用 AI 创业 / 提升营业额 / 开展副业 / 赚钱 / 获客 / 变现…）
 *   允许纯技术类：AI 工具基础操作、技术原理、提示词学习、代码开发、模型原理
 *
 * 检查范围：
 *   1. 海报里出现的每一个文本（标题/副标题/卡片/时间轴/问答/页脚…）→ 图上文字同样过审
 *   2. 商品文案 markdown 的「对外展示部分」（内部运营备注不参与扫描）
 *   3. 商品名称 / 属性 / 交付形式等商品字段
 *
 * 规则全部来自 configs/compliance/<版本>.yaml（词库 + 断言），
 * 新增一个版本不需要改这个脚本。
 *
 * 退出码：命中即 1（可用于 CI 拦截）
 *
 * 用法：
 *   bun run scripts/check-listing-compliance.ts          # 默认检查当前交付版 v8
 *   bun run scripts/check-listing-compliance.ts v3       # 复查历史版 v3
 *   bun run scripts/check-listing-compliance.ts v7       # 复查历史版 v7（已被驳回）
 *   bun run scripts/check-listing-compliance.ts --list   # 列出所有可查版本
 *
 * 平台口径：视频号小店 / 视频号与抖音尚品的教育培训类目都禁止教授使用 AI 开展商业活动或营利的课程，
 * 允许纯技术类（工具操作、技术原理、提示词、代码开发、系统搭建）。具体条款以两个平台后台最新规则为准。
 */

import { loadListingConfigById } from './lib/listing-config';
import { buildPosters, extractBlockTexts, renderCopyMarkdown } from './lib/listing-content';
import {
  COMPLIANCE_CONFIG_DIR,
  listComplianceConfigs,
  loadComplianceRules,
  type ComplianceRules,
} from './lib/compliance';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/* ------------------------------------------------------------------ */
/* 目标版本                                                            */
/* ------------------------------------------------------------------ */
const arg = (process.argv[2] || 'v8').replace(/^--/, '').toLowerCase();

if (arg === 'list' || process.argv.includes('--list')) {
  console.log(`合规规则目录：${COMPLIANCE_CONFIG_DIR}`);
  for (const id of listComplianceConfigs()) console.log(`  ${id}`);
  process.exit(0);
}

const listing = loadListingConfigById(arg);
const config = listing.data;

const rulesPath = config.compliance ?? `./configs/compliance/${config.id}.yaml`;
if (!existsSync(resolve(rulesPath))) {
  throw new Error(`找不到合规规则配置：${rulesPath}`);
}
const rules: ComplianceRules = loadComplianceRules(rulesPath);

const POSTERS = buildPosters(config);
const COPY_MARKDOWN = renderCopyMarkdown(config);
const PRODUCT = config.product;
const INTERNAL_MARKER = rules.internalMarker ?? '## 运营备注';

/** 课程卡片（模块 / 按天单元） */
const COURSE_CARDS = (config.content?.modules ?? []) as { title: string; lines?: string[] }[];
/** 目标客户卡片 */
const TARGET_CARDS = (config.content?.targets ?? []) as { title: string; lines?: string[] }[];
/** FAQ */
const FAQ_ITEMS = (config.content?.faq ?? []) as { label: string; title: string; lines: string[] }[];

interface Hit {
  scope: string;
  word: string;
  kind:
    | '直接禁用词'
    | '间接话术'
    | '关联高危词'
    | '英文高危词'
    | '平台高危词'
    | '平台绑定词'
    | '经营口径词'
    | '承诺类表述';
  context: string;
}

/** 在一段文本里找出所有命中的词 */
function scan(text: string, scope: string, hits: Hit[]): void {
  const lower = text.toLowerCase();

  const check = (words: string[] | undefined, kind: Hit['kind']) => {
    for (const word of words ?? []) {
      const needle = word.toLowerCase();
      let from = 0;
      for (;;) {
        const index = lower.indexOf(needle, from);
        if (index === -1) break;
        hits.push({ scope, word, kind, context: text.trim() });
        from = index + needle.length;
      }
    }
  };

  check(rules.forbidden.direct, '直接禁用词');
  check(rules.forbidden.indirect, '间接话术');
  check(rules.forbidden.risky, '关联高危词');
  check(rules.forbidden.english, '英文高危词');
  check(rules.forbidden.platform, '平台高危词');
}

function main(): void {
  const hits: Hit[] = [];
  const themeHits: { scope: string; text: string }[] = [];
  const semanticHits: { scope: string; word: string; text: string }[] = [];
  const acronymHits: { scope: string; label: string; text: string }[] = [];
  const staleDeliveryHits: { scope: string; word: string; text: string }[] = [];

  const publicCopy = COPY_MARKDOWN.split(INTERNAL_MARKER)[0];

  /* ---------------- 扫描范围：商品字段 / 海报 / 对外文案 ---------------- */
  const scanAll = (text: string, scope: string) => {
    scan(text, scope, hits);
    for (const word of rules.themeForbidden ?? []) {
      if (text.includes(word)) themeHits.push({ scope, text: text.trim() });
    }
    for (const word of rules.semanticForbidden ?? []) {
      if (text.includes(word)) semanticHits.push({ scope, word, text: text.trim() });
    }
    for (const rule of rules.acronymForbidden ?? []) {
      if (new RegExp(rule.pattern).test(text)) {
        acronymHits.push({ scope, label: rule.label, text: text.trim() });
      }
    }
    for (const word of rules.staleDelivery?.words ?? []) {
      if (text.includes(word)) staleDeliveryHits.push({ scope, word, text: text.trim() });
    }
    for (const pattern of rules.staleDelivery?.patterns ?? []) {
      if (new RegExp(pattern).test(text)) {
        staleDeliveryHits.push({ scope, word: pattern, text: text.trim() });
      }
    }
  };

  // 1. 商品字段
  for (const [key, value] of Object.entries(PRODUCT)) {
    scanAll(String(value), `商品字段.${key}`);
  }

  // 2. 海报文本（含右上角品牌位——图上文字同样过审）
  for (const spec of POSTERS) {
    for (const text of extractBlockTexts(spec.blocks)) {
      scanAll(text, `图片 ${spec.file}`);
    }
    if (spec.brand?.text) {
      scanAll(spec.brand.text, `图片 ${spec.file} 品牌位`);
    }
  }

  // 3. 商品文案（仅对外展示部分）
  scanAll(publicCopy, '商品文案（对外）');

  /* ---------------- 输出 ---------------- */
  const total = hits.length;
  console.log('═'.repeat(64));
  console.log(`视频号小店 / 抖音尚品「教育培训类目」合规自查 — ${config.id.toUpperCase()}`);
  console.log('═'.repeat(64));
  console.log(
    `规则来源：${rulesPath}${rules.label ? `（${rules.label}）` : ''}\n` +
      `扫描范围：商品字段 ${Object.keys(PRODUCT).length} 项、海报 ${POSTERS.length} 张、对外文案 ${publicCopy.length} 字`,
  );
  console.log(
    `禁用词库：直接禁用词 ${rules.forbidden.direct.length} 个 / 间接话术 ${rules.forbidden.indirect.length} 个 / ` +
      `关联高危词 ${rules.forbidden.risky.length} 个 / 英文高危词 ${rules.forbidden.english.length} 个 / ` +
      `平台高危词 ${rules.forbidden.platform.length} 个`,
  );
  console.log('');

  if (total === 0) {
    console.log('✅ 未命中任何禁用词或高危词。');
  } else {
    console.log(`❌ 命中 ${total} 处：\n`);
    const grouped = new Map<string, Hit[]>();
    for (const hit of hits) {
      const key = `${hit.kind}｜${hit.word}`;
      const list = grouped.get(key) ?? [];
      list.push(hit);
      grouped.set(key, list);
    }
    for (const [key, list] of grouped) {
      console.log(`  · [${key}] × ${list.length}`);
      for (const hit of list.slice(0, 4)) {
        console.log(`      ${hit.scope}：${hit.context.replace(/\n/g, ' / ').slice(0, 90)}`);
      }
      if (list.length > 4) console.log(`      … 其余 ${list.length - 4} 处同词`);
    }
  }

  /* ---------------- 主题词 ---------------- */
  if ((rules.themeForbidden ?? []).length > 0) {
    if (themeHits.length === 0) {
      console.log(
        `✅ 主题词干净：对外文案与海报中「${rules.themeForbidden.join('、')}」出现 0 次。`,
      );
    } else {
      console.log(`❌ 主题词命中 ${themeHits.length} 处（「${rules.themeForbidden.join('、')}」）：`);
      for (const hit of themeHits.slice(0, 8)) {
        console.log(`   · ${hit.scope}：${hit.text.replace(/\n/g, ' / ').slice(0, 80)}`);
      }
    }
    console.log('');
  }

  /* ---------------- 语义红线 ---------------- */
  if ((rules.semanticForbidden ?? []).length > 0) {
    if (semanticHits.length === 0) {
      console.log(
        `✅ 语义红线干净：对外文案与海报中「${rules.semanticForbidden.join('、')}」出现 0 次。`,
      );
    } else {
      console.log(`❌ 语义红线命中 ${semanticHits.length} 处（「${rules.semanticForbidden.join('、')}」）：`);
      for (const hit of semanticHits.slice(0, 10)) {
        console.log(`   · [${hit.word}] ${hit.scope}：${hit.text.replace(/\n/g, ' / ').slice(0, 80)}`);
      }
    }
    console.log('');
  }

  /* ---------------- 英文缩写等正则断言 ---------------- */
  if ((rules.acronymForbidden ?? []).length > 0) {
    if (acronymHits.length === 0) {
      console.log(
        `✅ 英文缩写干净：对外文案、海报与商品字段中 ${rules.acronymForbidden.map((r) => r.label).join('、')}出现 0 次。`,
      );
    } else {
      console.log(`❌ 英文缩写命中 ${acronymHits.length} 处：`);
      for (const hit of acronymHits.slice(0, 10)) {
        console.log(`   · [${hit.label}] ${hit.scope}：${hit.text.replace(/\n/g, ' / ').slice(0, 80)}`);
      }
    }
    console.log('');
  }

  /* ---------------- 旧交付节奏 ---------------- */
  if ((rules.staleDelivery?.words.length ?? 0) + (rules.staleDelivery?.patterns.length ?? 0) > 0) {
    if (staleDeliveryHits.length === 0) {
      console.log('✅ 旧交付节奏干净：对外内容中没有与实际交付不符的表述。');
    } else {
      console.log(`❌ 旧交付节奏表述命中 ${staleDeliveryHits.length} 处：`);
      for (const hit of staleDeliveryHits.slice(0, 10)) {
        console.log(`   · [${hit.word}] ${hit.scope}：${hit.text.replace(/\n/g, ' / ').slice(0, 80)}`);
      }
    }
    console.log('');
  }

  /* ---------------- 平台绑定 / 经营口径 / 承诺类 ---------------- */
  const extraGroups: { words: string[] | undefined; kind: Hit['kind'] }[] = [
    { words: rules.forbidden.platformBinding, kind: '平台绑定词' },
    { words: rules.forbidden.businessHint, kind: '经营口径词' },
    { words: rules.forbidden.promise, kind: '承诺类表述' },
  ];
  const extraHits = hits.filter(
    (hit) => hit.kind === '平台绑定词' || hit.kind === '经营口径词' || hit.kind === '承诺类表述',
  );
  if (extraGroups.some((group) => (group.words ?? []).length > 0)) {
    if (extraHits.length === 0) {
      console.log('✅ 平台绑定、经营口径与承诺类表述干净：无内容平台名称，无接管 / 经营结果类表述，无「速成 / 见效 / 包学会」式承诺。');
    } else {
      console.log(`❌ 平台绑定 / 经营口径 / 承诺类表述命中 ${extraHits.length} 处：`);
      for (const hit of extraHits.slice(0, 10)) {
        console.log(`   · [${hit.kind}｜${hit.word}] ${hit.scope}：${hit.context.replace(/\n/g, ' / ').slice(0, 80)}`);
      }
    }
    console.log('');
  }

  /* ---------------- 品牌位断言 ---------------- */
  const brandAssertion = rules.assertions.brandSlot;
  if (brandAssertion?.enabled) {
    const fullBrand = PRODUCT.brand;
    const files = POSTERS.map((spec) => spec.file);
    const withFullBrand = POSTERS.filter((spec) =>
      extractBlockTexts(spec.blocks).some((text) => text.includes(fullBrand)),
    ).map((spec) => spec.file);
    const withoutBrand = POSTERS.filter((spec) => !spec.brand?.text).map((spec) => spec.file);
    const brandOk =
      withFullBrand.length === 1 &&
      withFullBrand[0] === brandAssertion.fullBrandOnlyOn[0] &&
      withoutBrand.length === 0 &&
      files.length === POSTERS.length;
    if (brandOk) {
      console.log(
        `✅ 品牌位：右上角「Logo + ${config.brand?.text ?? ''}」覆盖 ${POSTERS.length} 张；全称「${fullBrand}」只出现在 ${withFullBrand[0]}。`,
      );
    } else {
      console.log(
        `❌ 品牌位不合规：全称出现于 ${withFullBrand.join('、') || '无'}（应仅 ${brandAssertion.fullBrandOnlyOn.join('、')}）；缺品牌位的海报：${withoutBrand.join('、') || '无'}`,
      );
    }
    console.log('');
  }

  /* ---------------- 标题结构与交付节奏断言 ---------------- */
  const titleAssertion = rules.assertions.title;
  if (titleAssertion?.enabled) {
    const productName = String(PRODUCT.name ?? '');
    const delivery = String(PRODUCT.delivery ?? '');
    const modifier = String(config.vars?.[titleAssertion.modifierVar] ?? '').trim();
    const mainTitle = String(config.vars?.[titleAssertion.mainVar] ?? '').trim();
    const copyFlatName = publicCopy.replace(/\s/g, '');
    const nameFlat = productName.replace(/\s/g, '');

    const issues: string[] = [];

    if (!modifier || !mainTitle) {
      issues.push(`缺少 vars.${titleAssertion.modifierVar} / vars.${titleAssertion.mainVar}，标题结构无法校验`);
    } else {
      if (productName !== mainTitle) {
        issues.push(`商品名称应为「${mainTitle}」（当前：${productName}）`);
      }
      if (productName.includes('|')) {
        issues.push(`商品名称应为单段标题，不应再带「|」分段（当前：${productName}）`);
      }
      if (!copyFlatName.includes(mainTitle.replace(/\s/g, ''))) {
        issues.push(`对外文案未出现主标题「${mainTitle}」`);
      }
      if (!copyFlatName.includes(modifier.replace(/\s/g, ''))) {
        issues.push(`对外文案未出现修饰词「${modifier}」`);
      }
      // 封面类海报的主标题上方槽位必须是修饰词
      const modifierSlots: { file: string; slot: string; value: string }[] = [];
      for (const spec of POSTERS) {
        for (const block of spec.blocks ?? []) {
          if (block.kind === 'title' && block.spec?.eyebrow) {
            modifierSlots.push({ file: spec.file, slot: 'eyebrow', value: String(block.spec.eyebrow) });
          }
          if (block.kind === 'hero' && block.kicker) {
            modifierSlots.push({ file: spec.file, slot: 'kicker', value: String(block.kicker) });
          }
        }
      }
      const coverSlots = modifierSlots.filter((slot) => titleAssertion.coverFiles.includes(slot.file));
      if (coverSlots.length === 0) {
        issues.push('未找到任何封面海报的主标题上方槽位（eyebrow / kicker）');
      }
      for (const slot of coverSlots) {
        if (slot.value !== modifier) {
          issues.push(`图片 ${slot.file} 的主标题上方「${slot.slot}」应为修饰词「${modifier}」（当前：${slot.value}）`);
        }
      }
      // 封面主标题必须就是主标题常量
      for (const spec of POSTERS) {
        if (!titleAssertion.coverFiles.includes(spec.file)) continue;
        for (const block of spec.blocks ?? []) {
          const t = block.kind === 'title' ? block.spec?.title : block.kind === 'hero' ? block.title : null;
          if (t && String(t).replace(/\s/g, '') !== mainTitle.replace(/\s/g, '')) {
            issues.push(`图片 ${spec.file} 主标题应为「${mainTitle}」（当前：${String(t).replace(/\n/g, ' ')}）`);
          }
        }
      }
    }

    if (titleAssertion.forbidShortCycleInName && /3\s*[天日]/.test(productName)) {
      issues.push(`商品名称含「3天」等短周期表述，易被读成速成承诺（当前：${productName}）`);
    }
    for (const word of titleAssertion.deliveryMustInclude) {
      if (!delivery.includes(word)) {
        issues.push(`交付形式未写明「${word}」（当前：${delivery}）`);
      }
    }
    for (const rule of titleAssertion.copyMustInclude) {
      const hit = rule.pattern
        ? new RegExp(rule.pattern).test(publicCopy)
        : publicCopy.includes(rule.text);
      if (!hit) {
        issues.push(`对外文案未出现「${rule.pattern ?? rule.text}」`);
      }
    }
    for (const word of titleAssertion.copyMustNotInclude) {
      if (publicCopy.includes(word)) {
        issues.push(`对外文案仍含「${word}」，该内容已下线`);
      }
    }

    // 页脚：不允许残留旧标题，且除白名单外必须与商品名称完全一致
    const footerAllowlist = [...(titleAssertion.footerAllowlist ?? []), String(PRODUCT.brand)];
    const footerTexts = POSTERS.flatMap((spec) =>
      (spec.blocks ?? [])
        .filter((block) => block.kind === 'footer')
        .map((block) => String((block as any).text ?? '')),
    );
    const staleFooters = footerTexts.filter((text) =>
      (titleAssertion.staleTitles ?? []).some((stale) => text.includes(stale)),
    );
    if (staleFooters.length > 0) {
      issues.push(`有 ${staleFooters.length} 张海报页脚仍残留旧标题：${staleFooters.join('、')}`);
    }
    const mismatchedFooters = footerTexts.filter((text) => {
      const flat = text.replace(/\s/g, '');
      if (flat === nameFlat) return false;
      return !footerAllowlist.some((allowed) => allowed.replace(/\s/g, '') === flat);
    });
    if (mismatchedFooters.length > 0) {
      issues.push(`有 ${mismatchedFooters.length} 张海报页脚既非商品名称也不在白名单：${mismatchedFooters.join('、')}`);
    }

    if (issues.length === 0) {
      console.log(`✅ 标题结构一致：商品名称「${productName}」= 主标题（单段，不含「3天」）；`);
      console.log(
        `   封面主标题按两行排版（去空白后与主标题一致），修饰词「${modifier}」置于 ${titleAssertion.coverFiles.length} 张封面主标题上方，`,
      );
      console.log(`   页脚与商品名称一致；交付节奏与商品字段一致。`);
    } else {
      console.log(`❌ 标题结构 / 交付节奏不一致（${issues.length} 项）：`);
      for (const issue of issues) console.log(`   · ${issue}`);
    }
    console.log('');
  }

  /* ---------------- 图文一致性断言 ---------------- */
  const copyFlat = publicCopy.replace(/\s/g, '');
  const required: { label: string; text: string }[] = [];
  for (const item of FAQ_ITEMS) {
    required.push({ label: 'FAQ 标题', text: item.title });
    for (const line of item.lines) required.push({ label: 'FAQ 答案', text: line });
  }
  for (const card of TARGET_CARDS) required.push({ label: '目标客户', text: card.title });
  for (const card of COURSE_CARDS) required.push({ label: '课程单元', text: card.title });
  for (const bullet of config.author?.bullets ?? []) required.push({ label: '作者资历', text: bullet });
  if (config.author?.name) {
    required.push({ label: '作者署名', text: `${config.author.name} · ${config.author.role}` });
  }

  const missingItems = required.filter((item) => !copyFlat.includes(item.text.replace(/\s/g, '')));
  if (missingItems.length > 0) {
    console.log(`⚠️  对外文案缺少 ${missingItems.length} 项与海报同源的内容：`);
    for (const item of missingItems.slice(0, 10)) console.log(`   · [${item.label}] ${item.text.slice(0, 40)}`);
  } else {
    console.log(`✅ 图文一致：${required.length} 项同源内容均已写入对外文案。`);
  }
  console.log('');

  /* ---------------- 正向词覆盖提示（不作为失败条件） ---------------- */
  const combined = [...POSTERS.flatMap((spec) => extractBlockTexts(spec.blocks)), publicCopy].join('\n');
  const missing = (rules.positiveHints ?? []).filter((hint) => !combined.includes(hint));
  console.log(`正向词覆盖：${(rules.positiveHints ?? []).length - missing.length}/${(rules.positiveHints ?? []).length}`);
  if (missing.length > 0) console.log(`  未出现：${missing.join('、')}`);
  console.log('');

  /* ---------------- 结论 ---------------- */
  const failed =
    total > 0 ||
    themeHits.length > 0 ||
    semanticHits.length > 0 ||
    acronymHits.length > 0 ||
    staleDeliveryHits.length > 0;

  if (failed) {
    console.log(`结论：❌ 存在违规表述，请改写后重新出图（bun run scripts/gen-shop-listing.ts ${config.id}）`);
    process.exit(1);
  }
  console.log('结论：✅ 合规自查通过，可提交平台审核');
}

main();
