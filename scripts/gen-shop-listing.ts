/**
 * gen-shop-listing.ts — **商品图统一出图入口**（替代 gen-shop-listing-v*.ts）
 *
 * 以前每个版本一个脚本（gen-shop-listing-v3/v4/v7/v8.ts），内容各写一份，
 * 加版本就得加脚本。现在：**一份脚本 + N 份配置**。
 *
 * 用法：
 *   bun run scripts/gen-shop-listing.ts                       # 出当前交付版（默认配置）
 *   bun run scripts/gen-shop-listing.ts v8                    # 按 id 出图
 *   bun run scripts/gen-shop-listing.ts --config configs/shop-listing/v8.yaml
 *   bun run scripts/gen-shop-listing.ts --list                # 列出所有可用配置
 *   bun run scripts/gen-shop-listing.ts v8 --theme blue       # 换配色方案
 *   bun run scripts/gen-shop-listing.ts v8 --out ./outputs/shop-listing-v8-blue
 *   bun run scripts/gen-shop-listing.ts v8 --with-ai-bg      # 实验：叠加 AI 质感底图
 *
 * 新增一个版本 = 在 configs/shop-listing/ 下加一个 YAML，不动这个脚本。
 */

import { resolve } from 'node:path';
import { parseArgs } from './args';
import { renderShopListing } from './shop-listing-render';
import { getPosterTheme, describePosterThemes, POSTER_THEMES } from '../src/lib/poster-themes';
import {
  LISTING_CONFIG_DIR,
  listListingConfigs,
  loadListingConfig,
  loadListingConfigById,
} from './lib/listing-config';
import { buildPosters, renderCopyMarkdown } from './lib/listing-content';

const { positional, flags } = parseArgs(process.argv.slice(2));

/* ------------------------------------------------------------------ */
/* --list：列出所有可用配置                                            */
/* ------------------------------------------------------------------ */
if (flags.list || positional.includes('--list')) {
  const ids = listListingConfigs();
  console.log(`商品图配置目录：${LISTING_CONFIG_DIR}`);
  if (ids.length === 0) {
    console.log('（暂无配置）');
  } else {
    for (const id of ids) {
      const loaded = loadListingConfigById(id);
      console.log(
        `  ${id.padEnd(6)} ${loaded.data.label ?? '(未命名)'}\n` +
          `         输出目录：${loaded.data.outputDir}　配色方案：${loaded.data.theme ?? 'fresh'}`,
      );
    }
  }
  console.log('\n配色方案：');
  console.log(describePosterThemes());
  process.exit(0);
}

/* ------------------------------------------------------------------ */
/* 解析目标配置                                                        */
/* ------------------------------------------------------------------ */
const DEFAULT_CONFIG_ID = 'v8';

function resolveConfigPath(): { path: string; id: string } {
  if (flags.config || flags.c) {
    const path = flags.config ?? flags.c;
    return { path: resolve(path), id: '' };
  }
  const id = positional.find((value) => !value.startsWith('-')) ?? DEFAULT_CONFIG_ID;
  return { path: '', id };
}

const target = resolveConfigPath();
const loaded = target.path
  ? loadListingConfig(target.path)
  : loadListingConfigById(target.id);

const config = loaded.data;

/* ------------------------------------------------------------------ */
/* 配色方案 / 输出目录                                                 */
/* ------------------------------------------------------------------ */
const themeId = flags.theme ?? flags.t;
if (themeId && !POSTER_THEMES.some((theme) => theme.id === themeId.toLowerCase())) {
  console.error(`未知配色方案：${themeId}\n可用方案：`);
  console.error(describePosterThemes());
  process.exit(1);
}
const theme = getPosterTheme(themeId ?? config.theme);

const outDir = flags.out ?? flags.o ?? config.outputDir;

console.log(`配置：${loaded.relPath}（${config.label ?? config.id}）`);
console.log(`配色方案：${theme.name}（${theme.id}）`);
console.log(`输出目录：${outDir}`);

/* ------------------------------------------------------------------ */
/* 渲染 + 落盘                                                        */
/* ------------------------------------------------------------------ */
const posters = buildPosters(config);
const copy = renderCopyMarkdown(config);

const written = await renderShopListing({
  outDir,
  posters,
  copy,
  productName: config.product.name,
  copyFileName: config.copy.fileName,
  withAiBg: Boolean(flags['with-ai-bg'] ?? flags.aiBg),
  theme,
});

console.log('\n完成：');
for (const path of written) console.log(`  ${path}`);
console.log(`\n提示：出图后请跑合规自查 → bun run scripts/check-listing-compliance.ts ${config.id}`);
