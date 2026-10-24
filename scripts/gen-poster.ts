/**
 * gen-poster.ts — **通用海报 / 直播间封面统一出图入口**
 *
 * 「直播间封面图」和「海报」本质是同一件事：给定内容 + 主题 + 尺寸 → 出一张图。
 * 所以这里只有一份脚本 + N 份配置：
 *   configs/poster/<id>.yaml  —— 内容 + 主题 + 尺寸 + 版式
 *
 * 用法：
 *   bun run scripts/gen-poster.ts --list                       # 列出所有海报配置
 *   bun run scripts/gen-poster.ts live-cover                   # 按 id 出图
 *   bun run scripts/gen-poster.ts --config configs/poster/live-cover.yaml
 *   bun run scripts/gen-poster.ts live-cover --size 1080x1920  # 覆盖尺寸
 *   bun run scripts/gen-poster.ts live-cover --sizes 1600x2848,1080x1920   # 一次出多张（多尺寸）
 *   bun run scripts/gen-poster.ts live-cover --count 3          # 每个尺寸出 3 张
 *   bun run scripts/gen-poster.ts live-cover --tone tech_light  # 覆盖配色
 *   bun run scripts/gen-poster.ts live-cover --title "新标题"   # 覆盖主标题
 *   bun run scripts/gen-poster.ts live-cover --out ./outputs/poster
 *   bun run scripts/gen-poster.ts live-cover --ai              # 生成 AI 主视觉（调 image-01）
 *
 * 退出码：合规自查命中 → 1（可用于 CI 拦截）。
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from './args';
import {
  POSTER_CONFIG_DIR,
  applyVariant,
  findTitleBlockIndex,
  listPosterConfigs,
  loadPosterConfig,
  loadPosterConfigById,
  setByPath,
  type PosterConfig,
} from './lib/poster-config';
import { fillAiVisuals, renderPosterToFile } from './lib/poster-pipeline';
import { runPosterCompliance } from './lib/poster-compliance';

/* ------------------------------------------------------------------ */
/* --list                                                              */
/* ------------------------------------------------------------------ */

/** 布尔开关（不消费后随的值） */
const BOOLEAN_FLAGS = new Set(['list', 'ai', 'help']);

/**
 * 把布尔开关挪到参数末尾。
 *
 * 为什么：parseArgs 遇到 `--ai live-cover` 会把 live-cover 当成 --ai 的值，
 * 布尔开关必须与位置参数区分开。
 */
function normalizeArgv(argv: string[]): string[] {
  const booleans: string[] = [];
  const rest: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const body = arg.slice(2).split('=')[0];
      if (BOOLEAN_FLAGS.has(body) && !arg.includes('=')) {
        booleans.push(arg);
        continue;
      }
    }
    rest.push(arg);
  }
  return [...rest, ...booleans];
}

const { positional, flags } = parseArgs(normalizeArgv(process.argv.slice(2)));

const USAGE = `通用海报 / 直播间封面出图

  bun run scripts/gen-poster.ts --list                      列出所有海报配置
  bun run scripts/gen-poster.ts <id>                        按 id 出图
  bun run scripts/gen-poster.ts <id> --size 1080x1920       覆盖成品尺寸
  bun run scripts/gen-poster.ts <id> --sizes 1600x2848,1080x1920   一次出多张（多尺寸）
  bun run scripts/gen-poster.ts <id> --count 3              每个尺寸出 3 张
  bun run scripts/gen-poster.ts <id> --tone tech_light      覆盖配色方案
  bun run scripts/gen-poster.ts <id> --background aurora    覆盖背景模式
  bun run scripts/gen-poster.ts <id> --title "新标题"        覆盖主标题
  bun run scripts/gen-poster.ts <id> --subtitle "新副标题"    覆盖副标题
  bun run scripts/gen-poster.ts <id> --out ./outputs/poster  覆盖输出目录
  bun run scripts/gen-poster.ts <id> --ai                   生成 AI 主视觉（调 image-01）

布尔开关（--list / --ai）请放在命令行末尾，或写成 --ai=true。`;

if (flags.help || positional.includes('--help')) {
  console.log(USAGE);
  process.exit(0);
}

if (flags.list || positional.includes('--list')) {
  console.log(`海报配置目录：${POSTER_CONFIG_DIR}`);
  const ids = listPosterConfigs();
  if (!ids.length) {
    console.log('（暂无配置）');
  } else {
    for (const id of ids) {
      const loaded = loadPosterConfigById(id);
      const size = loaded.data.size;
      console.log(
        `  ${id.padEnd(16)} ${loaded.data.label ?? '(未命名)'}\n` +
          `                   类型：${loaded.data.kind ?? 'poster'}　配色：${loaded.data.tone ?? 'deep_blue'}　` +
          `背景：${loaded.data.background ?? 'gradient'}\n` +
          `                   尺寸：${size.width}×${size.height ?? '自适应'}　输出：${loaded.data.outputDir ?? './outputs/poster'}`,
      );
    }
  }
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 解析目标配置                                                        */
/* ------------------------------------------------------------------ */
const configId =
  flags.config ?? flags.c ?? positional.find((value) => !value.startsWith('-')) ?? 'live-cover';

const configPath = existsSync(configId)
  ? configId
  : ['yaml', 'yml', 'json'].map((ext) => join(POSTER_CONFIG_DIR, `${configId}.${ext}`)).find((p) => existsSync(p));

if (!configPath) {
  throw new Error(`找不到海报配置：${configId}\n可用配置：${listPosterConfigs().join('、')}`);
}

const loaded = loadPosterConfig(configPath);
const baseConfig = loaded.data;

/* ------------------------------------------------------------------ */
/* 命令行覆盖                                                          */
/* ------------------------------------------------------------------ */

/** 解析尺寸：`1600x2848` / `1600` / `1600:2848` */
function parseSize(value: string): { width: number; height?: number } {
  const normalized = value.trim().toLowerCase().replace(/[×*:]/g, 'x');
  const [rawW, rawH] = normalized.split('x');
  const width = Number(rawW);
  if (!Number.isFinite(width) || width <= 0) throw new Error(`无法解析尺寸：${value}`);
  if (rawH === undefined) return { width };
  const height = Number(rawH);
  if (!Number.isFinite(height) || height <= 0) throw new Error(`无法解析尺寸：${value}`);
  return { width, height };
}

const sizeFlags = flags.sizes ? String(flags.sizes).split(',').map((item) => parseSize(item)) : null;
const singleSize = flags.size ? parseSize(String(flags.size)) : null;
const sizes = sizeFlags ?? (singleSize ? [singleSize] : [baseConfig.size ?? { width: 1080 }]);

const count = flags.count ? Math.max(1, Number(flags.count)) : 1;
const outDir = flags.out ?? flags.o ?? baseConfig.outputDir ?? './outputs/poster';
const tone = flags.tone ?? flags.t ?? baseConfig.tone;
const background = flags.background ?? flags.bg ?? baseConfig.background;
const anchor = flags.anchor ?? baseConfig.anchor ?? 'center';
const format = (flags.format ?? baseConfig.format ?? 'png') as 'png' | 'jpg';
const useAi = flags.ai !== undefined && flags.ai !== 'false';

/** 主标题 / 副标题覆盖 */
function applyTextOverrides(config: PosterConfig): PosterConfig {
  const next: PosterConfig = JSON.parse(JSON.stringify(config));
  const index = findTitleBlockIndex(next.blocks);
  if (index < 0) return next;
  if (flags.title) {
    setByPath(next, `blocks.${index}.title`, String(flags.title));
    if (next.blocks[index].kind === 'title') {
      setByPath(next, `blocks.${index}.spec.title`, String(flags.title));
    }
  }
  if (flags.subtitle) {
    setByPath(next, `blocks.${index}.subtitle`, String(flags.subtitle));
    if (next.blocks[index].kind === 'title') {
      setByPath(next, `blocks.${index}.spec.subtitle`, String(flags.subtitle));
    }
  }
  return next;
}

/* ------------------------------------------------------------------ */
/* API Key（AI 主视觉用）                                              */
/* ------------------------------------------------------------------ */
function resolveApiKey(): string {
  if (process.env.MINIMAX_CN_API_KEY?.trim()) return process.env.MINIMAX_CN_API_KEY.trim();
  if (process.env.MINIMAX_API_KEY?.trim()) return process.env.MINIMAX_API_KEY.trim();
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.clawdao/auth.json'), 'utf-8'));
    for (const key of ['minimax-cn', 'minimax(cn)', 'minimax']) {
      const entry = auth[key];
      const value = entry?.apiKey ?? entry?.key ?? entry?.token;
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
  } catch {
    /* ignore */
  }
  throw new Error('未找到 MiniMax API Key（.env 或 ~/.clawdao/auth.json）');
}

/* ------------------------------------------------------------------ */
/* 执行                                                                */
/* ------------------------------------------------------------------ */
console.log(`配置：${loaded.relPath}（${baseConfig.label ?? baseConfig.id}）`);
console.log(`类型：${baseConfig.kind ?? 'poster'}　配色：${tone ?? 'deep_blue'}　背景：${background ?? 'gradient'}`);
console.log(`输出目录：${outDir}`);

const variants = baseConfig.variants?.length ? baseConfig.variants : [{}];
const jobs: Array<{ config: PosterConfig; variantId: string; fileBase: string }> = [];

for (const [variantIndex, variant] of variants.entries()) {
  const variantId = variant.id ?? (variants.length > 1 ? String(variantIndex + 1) : '');
  const applied = applyTextOverrides(applyVariant(baseConfig, variant));
  const fileBase =
    variant.file ??
    `${baseConfig.fileNamePrefix ?? baseConfig.id}${variantId ? `-${variantId}` : ''}`;
  jobs.push({ config: applied, variantId, fileBase });
}

/* 合规自查（配置里写了 compliance 才会跑） */
if (baseConfig.compliance) {
  const { hits } = runPosterCompliance(baseConfig, baseConfig.compliance);
  if (hits.length) {
    console.error(`\n❌ 合规自查未通过（规则：${baseConfig.compliance}），命中 ${hits.length} 处：`);
    for (const hit of hits) {
      console.error(`   · [${hit.kind}] 「${hit.word}」→ ${hit.context.slice(0, 60)}`);
    }
    process.exit(1);
  }
  console.log(`合规自查：通过（规则：${baseConfig.compliance}）`);
}

mkdirSync(resolve(outDir), { recursive: true });

const written: string[] = [];
let total = 0;

for (const job of jobs) {
  for (const size of sizes) {
    for (let index = 0; index < count; index += 1) {
      total += 1;

      let blocks = job.config.blocks;
      if (useAi) {
        const hasAiVisual = blocks.some((block) => (block as any).kind === 'visual' && (block as any).aiPrompt);
        if (hasAiVisual) {
          console.log(`  🎨 生成 AI 主视觉（${size.width}×${size.height ?? '自适应'}）…`);
          blocks = await fillAiVisuals(blocks, {
            apiKey: resolveApiKey(),
            baseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
            aspectRatio: size.height && size.height / size.width > 1.2 ? '9:16' : '16:9',
            assetDir: join(outDir, '_assets'),
            fileName: `${job.fileBase}-${size.width}x${size.height ?? 'auto'}`,
          });
        }
      }

      const sizeTag = sizes.length > 1 || count > 1 ? `-${size.width}x${size.height ?? 'auto'}` : '';
      const countTag = count > 1 ? `-${index + 1}` : '';
      const outPath = join(outDir, `${job.fileBase}${sizeTag}${countTag}.${format}`);

      const result = await renderPosterToFile({
        blocks,
        brand: job.config.brand,
        cornerMark: job.config.cornerMark,
        tone: tone as any,
        background: background as any,
        width: size.width,
        size,
        anchor: anchor as any,
        padding: job.config.padding,
        outPath,
        format,
      });

      written.push(result.path);
      console.log(`  ✅ ${result.path} (${result.width}×${result.height}, ${(result.bytes / 1024).toFixed(0)} KB)`);
    }
  }
}

console.log(`\n完成：共 ${written.length} 张`);
for (const path of written) console.log(`  ${path}`);
