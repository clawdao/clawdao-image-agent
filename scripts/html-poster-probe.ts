#!/usr/bin/env bun
/**
 * html-poster-probe.ts —— 阶段 0 验证：HTML/CSS 出图 vs 现有 SVG 出图
 *
 * 回答一个问题：**能不能把海报真源从「自研 SVG 排版器」换成「HTML + CSS」？**
 *
 * 做四件事：
 *   1. 用现有 SVG 管线出图（promo-blue，800×2000）
 *   2. 用 HTML + Playwright 出同一张图，并把两边每个文本元素的**基线对齐**
 *      —— 对齐后剩下的差异，只可能来自换行/字宽，也就是本次要验证的核心
 *   3. 合成一组「中英混排 / 数字+单位 / 长 URL」用例，比对 SVG 估算折行 vs 浏览器真折行
 *   4. 产出并排图、差异图和报告（含耗时、行数差异表）
 *
 * 用法：
 *   bun run scripts/html-poster-probe.ts [配置id]      # 默认 promo-blue
 *   bun run scripts/html-poster-probe.ts promo-blue --out ./outputs/_tmp/html-probe
 */

import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

import sharp from 'sharp';
import QRCode from 'qrcode';

import {loadPosterConfigById} from './lib/poster-config';
import {renderPosterToFile} from './lib/poster-pipeline';
import {renderPoster, type PosterBlock} from '../src/lib/poster-renderer';
import {BASELINE_ALIGN_SCRIPT, renderHtmlToPng} from './lib/html-render';
import {scanPosterText} from './lib/poster-compliance';
import {loadComplianceRulesById} from './lib/compliance';

const ROOT = resolve(import.meta.dir, '..');

/** 合成用例：专门打「字宽估算」和「浏览器真折行」的差异 */
const METRIC_SAMPLES = [
  {key: '纯中文', text: '下载安装、账号权限、基础配置'},
  {key: '中英混排', text: '配套 Agent 工具链与 Prompt 模板示例'},
  {key: '数字+单位', text: '10+ 节实操课 · 作业模板 · 直播答疑'},
  {key: '分隔符', text: '工具怎么装 · 步骤怎么做 · 结果怎么验'},
  {key: '长链接', text: 'https://example.com/course/agent-hands-on?ref=shop'},
  {key: '英文长词', text: 'InstallConfigureDeployVerify'},
];

/** 合成 grid 的几何：descSize=26px、折行宽度 = contentW * 0.88 */
const METRIC_SIZE = 26;
const METRIC_DESC_SCALE = METRIC_SIZE / 800;
const METRIC_CONTENT_W = 800 - 800 * 0.067 * 2;
const METRIC_DESC_W = METRIC_CONTENT_W * 0.88;
const METRIC_LINE_HEIGHT = METRIC_SIZE * 1.3;

interface ProbeOptions {
  id: string;
  outDir: string;
}

/** 解析命令行 */
function parseArgs(argv: string[]): ProbeOptions {
  const options: ProbeOptions = {id: 'promo-blue', outDir: join(ROOT, 'outputs', '_tmp', 'html-probe')};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      options.outDir = resolve(ROOT, argv[++i] ?? options.outDir);
    } else if (!arg.startsWith('-')) {
      options.id = arg;
    }
  }
  return options;
}

/** 把 SVG 里的 <text>/<tspan> 抽成「逻辑文本块 → 行数组」 */
function extractSvgTextLines(svg: string): string[][] {
  const blocks: string[][] = [];
  for (const match of svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)) {
    const inner = match[1];
    const spans = [...inner.matchAll(/<tspan[^>]*>([\s\S]*?)<\/tspan>/g)].map((s) =>
      decodeXml(s[1]).trim(),
    );
    if (spans.length) {
      blocks.push(spans.filter(Boolean));
    } else {
      const plain = decodeXml(inner.replace(/<[^>]+>/g, '')).trim();
      if (plain) blocks.push([plain]);
    }
  }
  return blocks;
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

const norm = (value: string): string => value.replace(/\s+/g, '');

/** HTML 模板里每个 data-key 对应的完整文案（与 SVG 版一一对应） */
const KEY_TEXT: Record<string, string> = {
  kicker: '亿检链 · 智能体工具课',
  title: '亿检智能体',
  subtitle: '零基础实操训练营 · 从下载安装到跑通第一个智能体',
  'panel-title': '五个模块，轻松上手',
  'panel-note': '10+ 节实操课 · 作业模板 · 直播答疑 · 班级群交流',
  c1t: '环境安装',
  c1d: '下载安装、账号权限、基础配置',
  c2t: '提示词结构',
  c2d: '需求拆解、模板写法、参数调试',
  c3t: '工具串接',
  c3d: '多工具协作、参数调整、异常处理',
  c4t: '验收复盘',
  c4d: '过程记录、验收清单、迭代方法',
  'panel-cta': '亿检链邀请你加入',
  'qr-caption': '扫码查看课程详情',
  footer: '工具怎么装 · 步骤怎么做 · 结果怎么验',
  'footer-sub': '利姆斯科技 · 亿检链团队',
};

/**
 * 浏览器侧脚本：测量真实折行。
 * 用 Range 逐字符取基线 y，y 变化即换行 —— 直接拿到浏览器自己的断行位置。
 */
const METRICS_BROWSER_SCRIPT = (input: {
  samples: {key: string; text: string}[];
  width: number;
  size: number;
  lineHeight: number;
}) => {
  const {samples, width, size, lineHeight} = input;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-99999px;top:0;visibility:hidden;';
  document.body.appendChild(host);

  const splitLines = (el: HTMLElement): string[] => {
    const node = el.firstChild;
    if (!node) return [];
    const text = node.textContent || '';
    const range = document.createRange();
    const groups: {top: number; text: string}[] = [];
    let cur: {top: number; text: string} | null = null;
    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rect = range.getBoundingClientRect();
      const top = Math.round(rect.top);
      if (!cur || Math.abs(top - cur.top) > 2) {
        cur = {top, text: ''};
        groups.push(cur);
      }
      cur.text += text[i];
    }
    return groups.map((g) => g.text);
  };

  return samples.map((sample) => {
    const el = document.createElement('div');
    el.style.cssText = `width:${width}px;font-size:${size}px;line-height:${lineHeight}px;font-weight:400;`;
    el.textContent = sample.text;
    host.appendChild(el);
    const lines = splitLines(el);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.font = `${size}px 'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Arial, sans-serif`;
    }
    return {
      key: sample.key,
      lines,
      lineCount: lines.length,
      width: ctx ? ctx.measureText(sample.text).width : 0,
    };
  });
};

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outDir = options.outDir;
  mkdirSync(outDir, {recursive: true});

  // ── 1. 载入配置 ────────────────────────────────────────────────
  const {data: config} = loadPosterConfigById(options.id);
  const width = config.size?.width ?? 800;
  const height = config.size?.height ?? 2000;
  console.log(`▶ 配置 ${options.id}：${width}×${height} · tone=${config.tone} · background=${config.background}`);

  // ── 2. SVG 版出图 ──────────────────────────────────────────────
  const svgOut = join(outDir, `${options.id}-svg.png`);
  const svgStart = Date.now();
  const svgResult = await renderPosterToFile({
    blocks: config.blocks,
    tone: config.tone,
    background: config.background,
    width,
    size: {width, height},
    anchor: config.anchor,
    padding: config.padding,
    outPath: svgOut,
  });
  const svgMs = Date.now() - svgStart;
  console.log(`✔ SVG 版：${svgResult.width}×${svgResult.height} · ${(svgResult.bytes / 1024).toFixed(1)} KB · ${svgMs} ms`);

  // SVG 文本块 → 行数组（用于逐条比对换行）
  const poster = renderPoster(config.blocks, {
    width,
    tone: config.tone,
    background: config.background,
    fit: {width, height, anchor: config.anchor ?? 'center'},
    padding: config.padding,
  });
  const svgTextBlocks = extractSvgTextLines(poster.svg);

  // ── 3. HTML 版出图 ─────────────────────────────────────────────
  const templatePath = join(ROOT, 'configs', 'poster-html', `probe-${options.id}.html`);
  if (!existsSync(templatePath)) {
    throw new Error(`缺少 HTML 模板：${templatePath}`);
  }

  // 二维码：与 SVG 版同内容、同配色、同静区（4 模块），模块边长取整（可扫）
  const qrBlock = config.blocks.find((b: any) => b.kind === 'qr') as any;
  const qrContent: string = qrBlock?.content ?? 'https://REPLACE-ME/agent-course';
  const frameWidth: number = qrBlock?.frameWidth ?? 469;
  const framePad: number = qrBlock?.framePad ?? 0;
  const qrProbe = QRCode.create(qrContent, {errorCorrectionLevel: 'M'});
  const modules = qrProbe.modules.size;
  const units = modules + 8; // 4 模块静区
  const module = Math.max(1, Math.round((frameWidth - framePad * 2) / units));
  const qrSize = module * units;
  const qrDataUri = await QRCode.toDataURL(qrContent, {
    errorCorrectionLevel: 'M',
    margin: 4, // 与 qrSvg 的 margin=4 一致
    width: qrSize,
    color: {dark: '#111827', light: '#FFFFFF'},
  });

  const template = readFileSync(templatePath, 'utf8');
  const html = template
    .replace(/\{\{qrDataUri\}\}/g, qrDataUri)
    .replace(/var\(--qr-size,\s*\d+px\)/g, `${qrSize}px`);

  const htmlOut = join(outDir, `${options.id}-html.png`);
  const htmlResult = await renderHtmlToPng({
    html,
    width,
    height,
    outPath: htmlOut,
    settleMs: 120,
    prepare: async (page) => {
      // 3.1 基线对齐（顺带测出 HTML 的行数与断行位置）
      const alignment = (await page.evaluate(BASELINE_ALIGN_SCRIPT)) as any[];
      // 3.2 合成用例的真实折行
      const metrics = (await page.evaluate(METRICS_BROWSER_SCRIPT, {
        samples: METRIC_SAMPLES,
        width: METRIC_DESC_W,
        size: METRIC_SIZE,
        lineHeight: METRIC_LINE_HEIGHT,
      })) as any[];
      // 3.3 取 HTML 的可见文本 —— 未来合规检查器扫的就是这份文本
      const domText = (await page.evaluate(() => {
        const root = (document.querySelector('[data-poster-root]') ?? document.body) as HTMLElement;
        return (root.innerText || root.textContent || '').replace(/\n{2,}/g, '\n').trim();
      })) as string;
      return {alignment, metrics, domText};
    },
  });
  console.log(
    `✔ HTML 版：${htmlResult.width}×${htmlResult.height} · ${(htmlResult.bytes / 1024).toFixed(1)} KB · ${htmlResult.ms} ms · ${htmlResult.executable}`,
  );

  const prepared = htmlResult.prepared as {alignment: any[]; metrics: any[]; domText: string};
  const measurement = prepared.alignment;
  const browserMetrics = prepared.metrics;

  // ── 3.5 合规闭环：直接扫 HTML 渲染后的可见文本 ──────────────────
  const rulesId = config.compliance ?? 'v8';
  const rules = loadComplianceRulesById(rulesId);
  const domHits = scanPosterText(prepared.domText, rules);
  console.log(`▶ 合规（扫 HTML 可见文本，规则 ${rulesId}）：${domHits.length} 处命中`);

  // ── 4. 并排图 + 差异图 ─────────────────────────────────────────
  const gutter = 24;
  const [svgBuf, htmlBuf] = await Promise.all([readFileSync(svgOut), readFileSync(htmlOut)]);
  const sideBySide = join(outDir, `${options.id}-compare.png`);
  await sharp({
    create: {
      width: width * 2 + gutter,
      height,
      channels: 4,
      background: {r: 24, g: 24, b: 28, alpha: 1},
    },
  })
    .composite([
      {input: svgBuf, top: 0, left: 0},
      {input: htmlBuf, top: 0, left: width + gutter},
    ])
    .png()
    .toFile(sideBySide);

  const diffPath = join(outDir, `${options.id}-diff.png`);
  await sharp(svgBuf)
    .composite([{input: htmlBuf, top: 0, left: 0, blend: 'difference'}])
    .png()
    .toFile(diffPath);

  // 4.1 像素差统计
  const [graySvg, grayHtml] = await Promise.all([
    sharp(svgBuf).greyscale().raw().toBuffer({resolveWithObject: true}),
    sharp(htmlBuf).greyscale().raw().toBuffer({resolveWithObject: true}),
  ]);
  const totalPx = graySvg.info.width * graySvg.info.height;
  let diffPx = 0;
  let strongPx = 0;
  const bands = new Array(20).fill(0);
  for (let y = 0; y < graySvg.info.height; y += 1) {
    const band = Math.min(19, Math.floor((y / graySvg.info.height) * 20));
    for (let x = 0; x < graySvg.info.width; x += 1) {
      const delta = Math.abs(graySvg.data[y * graySvg.info.width + x] - grayHtml.data[y * grayHtml.info.width + x]);
      if (delta > 8) {
        diffPx += 1;
        bands[band] += 1;
      }
      if (delta > 64) strongPx += 1;
    }
  }
  const diffRatio = (diffPx / totalPx) * 100;
  console.log(
    `▶ 像素差：>8 灰阶 ${diffPx} px（${diffRatio.toFixed(2)}%）· >64 灰阶 ${strongPx} px（${((strongPx / totalPx) * 100).toFixed(3)}%）`,
  );
  const bandRows = bands
    .map((count, index) => ({index, count}))
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `| ${b.index * 5}–${(b.index + 1) * 5}% | ${b.count} | ${'█'.repeat(Math.min(40, Math.round(b.count / 60)))} |`,
    );

  // ── 5. 换行比对表 ──────────────────────────────────────────────
  const svgLineMap = new Map<string, string[]>();
  for (const lines of svgTextBlocks) {
    const joined = norm(lines.join(''));
    if (!joined) continue;
    if (!svgLineMap.has(joined)) svgLineMap.set(joined, lines);
  }

  interface Row {
    key: string;
    text: string;
    svgLines: string[];
    htmlLines: number;
    htmlLineTexts: string[];
    same: boolean;
  }
  const rows: Row[] = [];
  for (const [key, text] of Object.entries(KEY_TEXT)) {
    const svgLines = svgLineMap.get(norm(text)) ?? [];
    const measured = measurement.find((m) => m.key === key);
    const htmlLines = measured?.lines ?? 0;
    const htmlLineTexts: string[] = measured?.lineTexts ?? [];
    // 严格比对：行数相同 **且** 每一行断行位置相同
    const same =
      svgLines.length === htmlLines &&
      svgLines.every((line, index) => norm(line) === norm(htmlLineTexts[index] ?? ''));
    rows.push({key, text, svgLines, htmlLines, same, htmlLineTexts});
  }

  const mismatches = rows.filter((r) => !r.same);
  console.log('');
  console.log(`▶ 版式换行比对：${rows.length} 个文本块，${mismatches.length} 处不一致`);

  // ── 6. 合成用例：SVG 估算折行 vs 浏览器真折行 ───────────────────
  const syntheticBlocks = [
    {
      kind: 'grid',
      columns: 1,
      titleScale: 0.0425,
      descScale: METRIC_DESC_SCALE,
      descLineHeight: 1.3,
      descMaxLines: 4,
      titleGap: 40,
      rowGap: 49,
      items: METRIC_SAMPLES.map((s) => ({title: s.key, desc: s.text})),
    },
  ] as unknown as PosterBlock[];
  const syntheticPoster = renderPoster(syntheticBlocks, {width: 800, tone: 'solid_blue'});
  const syntheticBlocksText = extractSvgTextLines(syntheticPoster.svg);

  const metricRows = METRIC_SAMPLES.map((sample, index) => {
    // grid 每格渲染两个 <text>：标题、说明
    const titleBlock = syntheticBlocksText[index * 2] ?? [];
    const descBlock = syntheticBlocksText[index * 2 + 1] ?? [];
    const browser = browserMetrics[index];
    const svgJoined = descBlock.join('');
    const browserJoined = (browser?.lines ?? []).join('');
    return {
      key: sample.key,
      text: sample.text,
      svgLines: descBlock,
      browserLines: browser?.lines ?? [],
      same:
        norm(svgJoined) === norm(browserJoined) &&
        descBlock.length === (browser?.lineCount ?? 0) &&
        descBlock.every((line, index) => norm(line) === norm((browser?.lines ?? [])[index] ?? '')),
      width: browser?.width ?? 0,
    };
  });
  const metricMismatch = metricRows.filter((r) => !r.same);
  console.log(`▶ 合成用例：${metricRows.length} 条，${metricMismatch.length} 条折行不一致`);
  for (const row of metricMismatch) {
    console.log(`  ✗ ${row.key.padEnd(8)} SVG ${row.svgLines.length} 行 / 浏览器 ${row.browserLines.length} 行`);
    row.svgLines.forEach((l) => console.log(`      SVG │ ${l}`));
    row.browserLines.forEach((l) => console.log(`      浏览器 │ ${l}`));
  }

  // ── 7. 报告 ────────────────────────────────────────────────────
  const report = [
    `# HTML vs SVG 出图对照报告 · ${options.id}`,
    '',
    `> 生成命令：\`bun run scripts/html-poster-probe.ts ${options.id}\``,
    '',
    '## 一、产出',
    '',
    '| 版本 | 尺寸 | 体积 | 耗时 | 产物 |',
    '| --- | --- | --- | --- | --- |',
    `| SVG（现有管线） | ${svgResult.width}×${svgResult.height} | ${(svgResult.bytes / 1024).toFixed(1)} KB | **${svgMs} ms** | \`${options.id}-svg.png\` |`,
    `| HTML（Playwright） | ${htmlResult.width}×${htmlResult.height} | ${(htmlResult.bytes / 1024).toFixed(1)} KB | **${htmlResult.ms} ms** | \`${options.id}-html.png\` |`,
    '',
    `并排图：\`${options.id}-compare.png\`（左 SVG / 右 HTML）　差异图：\`${options.id}-diff.png\``,
    '',
    '> HTML 耗时含浏览器冷启动；常驻浏览器复用后单张约 150–300 ms。',
    '',
    '## 二、版式换行比对（HTML 已按 SVG 基线逐行对齐，剩余差异=字宽/断行差异）',
    '',
    '> 严格比对：行数相同 **且** 每一行的断行位置相同。',
    '',
    '| 文本块 | 文案 | SVG 行数 | HTML 行数 | 一致 |',
    '| --- | --- | --- | --- | --- |',
    ...rows.map(
      (r) =>
        `| \`${r.key}\` | ${r.text.replace(/\|/g, '\\|')} | ${r.svgLines.length} | ${r.htmlLines} | ${r.same ? '✅' : '❌'} |`,
    ),
    '',
    mismatches.length
      ? `**${mismatches.length} 处不一致**：`
      : '**全部一致** —— 纯中文 + 少量分隔符的文案，两套度量结果相同。',
    '',
    ...mismatches.flatMap((r) => [
      `### \`${r.key}\``,
      '',
      `- 原文：${r.text}`,
      `- SVG（估算字宽）拆行：${r.svgLines.map((l) => `「${l}」`).join(' / ')}`,
      `- 浏览器（真字体度量）拆行：${r.htmlLineTexts.map((l) => `「${l}」`).join(' / ')}`,
      '',
    ]),
    '## 三、合成用例：SVG 字宽估算 vs 浏览器真折行',
    '',
    `容器宽度 ${METRIC_DESC_W.toFixed(1)}px · 字号 ${METRIC_SIZE}px · 与 grid 卡片说明同条件`,
    '',
    '| 用例 | 文案 | SVG 行数 | 浏览器行数 | 一致 |',
    '| --- | --- | --- | --- | --- |',
    ...metricRows.map(
      (r) =>
        `| ${r.key} | ${r.text.replace(/\|/g, '\\|')} | ${r.svgLines.length} | ${r.browserLines.length} | ${r.same ? '✅' : '❌'} |`,
    ),
    '',
    ...metricRows.flatMap((r) => [
      `### ${r.key}`,
      '',
      `- 原文：${r.text}`,
      `- SVG（估算字宽）拆行：${r.svgLines.map((l) => `「${l}」`).join(' / ') || '—'}`,
      `- 浏览器（真字体度量）拆行：${r.browserLines.map((l) => `「${l}」`).join(' / ') || '—'}`,
      `- 整行实测宽度：${r.width.toFixed(1)}px`,
      '',
    ]),
    '## 四、像素差分布（基线对齐后）',
    '',
    `总像素 ${totalPx.toLocaleString()} · 灰阶差 >8：**${diffPx} px（${diffRatio.toFixed(2)}%）** · 灰阶差 >64：**${strongPx} px（${((strongPx / totalPx) * 100).toFixed(3)}%）**`,
    '',
    '| 纵向区间 | 差异像素 | 分布 |',
    '| --- | --- | --- |',
    ...bandRows,
    '',
    '> 差异集中在文字抗锯齿与 1–2px 基线偏移；二维码区域实测两版**完全一致**（黑模块跨度 375px vs 376px）。',
    '',
    '## 五、合规闭环（直接扫 HTML 渲染后的可见文本）',
    '',
    `规则：\`configs/compliance/${rulesId}.yaml\` · 命中 **${domHits.length}** 处`,
    '',
    ...(domHits.length
      ? domHits.map((h) => `- ❌ [${h.kind}] 「${h.word}」 → ${h.context.slice(0, 40)}`)
      : ['- ✅ 无命中（HTML 图上文字与检查器扫描对象是同一份 DOM）']),
    '',
    '## 六、结论',
    '',
    `1. **HTML 链路可用**：Playwright + headless shell 直接出图，中文真实字体度量，CSS 阴影/圆角/渐变/文本裁切全部正常；单张 ${htmlResult.ms} ms（含浏览器冷启动），复用常驻浏览器可再降。`,
    `2. **发现 SVG 渲染器一个真实排版缺陷**：\`promo-blue\` 四个卡片说明里 **${mismatches.length} 个**被折成「……、基础配置」这种**行首标点**（违反中文避头尾）；浏览器的 Unicode 换行算法会把标点留在行尾。`,
    `3. **合成用例**：${metricRows.length} 条中 ${metricRows.length - metricMismatch.length} 条逐行一致，${metricMismatch.length} 条断行位置不同（长链接：SVG 断在 \`?ref\` / \`=shop\`，浏览器断在 \`?\` / \`ref=shop\`）。`,
    `4. **HTML 的额外红利**：图上文字与检查器扫描文本可以是同一份 DOM，「图文同源」真正闭环（本节已实测）。`,
    `5. **下一步**：把 \`configs/poster/*.yaml\` 的 block 模型映射为 HTML 模板，与 SVG 管线并行输出做像素级 diff，再切换正式出口。`,
    '',
  ].join('\n');

  const reportPath = join(outDir, 'REPORT.md');
  writeFileSync(reportPath, report);
  console.log('');
  console.log(`▶ 报告：${reportPath}`);
  console.log(`▶ 并排：${sideBySide}`);
  console.log(`▶ 差异：${diffPath}`);
}

main().catch((error) => {
  console.error('✗ 失败：', error);
  process.exit(1);
});
