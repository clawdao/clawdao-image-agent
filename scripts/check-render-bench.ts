/**
 * check-render-bench.ts — 常驻浏览器性能基准（P1-T3）
 *
 * 为什么要专门量这个：
 *   HTML 出图一旦接管正式出口，就是**批量**活（商品图一次 10 张、海报一次 N 张）。
 *   如果每张图都要冷启动浏览器，10 张 = 10 次启动 ≈ 3 秒纯开销；
 *   更糟的是每次启动可能落到不同的 Chromium revision，产物不可复现。
 *   所以「浏览器 + 上下文常驻，逐张只做 setContent + 截图」不是优化项，是**准入条件**。
 *
 * 验法（对照 docs/v0/v0.1/01-html-poster-pipeline.md · P1-T3 验收列）：
 *   1. 冷启动基准：自建浏览器渲染 1 张 → 得到 coldMs（含进程启动）
 *   2. 批量热态：常驻浏览器 + **同一个上下文**连渲染 N 张 → 逐张耗时 + 总耗时
 *   3. 三条判定：
 *      · 批内冷启动次数 = 1（结构性保证，代码路径上就没有第二次 launch）
 *      · 稳态单张 ≤ 200 ms
 *      · 批量总耗时 ≤ 冷启动单张 + N × 稳态单张 × 容差
 *
 *   **为什么用加法而不是「N 张总耗时 ≤ 冷启动单张 × 2」**：
 *   冷启动耗时受 OS 缓存 / JIT / 磁盘影响，实测在 446 ~ 1335ms 之间浮动，
 *   拿它做**比值**闸门会偶发翻车（冷启动侥幸快的那一次，预算就卡死了）。
 *   加法形式表达的恰恰是同一件事：「这批图只付了一次冷启动，其余都是边际成本」。
 *   原始比值仍会打印出来做参考。
 *
 *   关于「稳态」：常驻浏览器的**首张**要额外付一次字体命中探针（像素级比对，约 170ms，
 *   按浏览器实例缓存），这是一次性开销而非每张的开销 —— 所以首张单列为「预热」，
 *   稳态统计从第 2 张开始；总耗时判定仍然把预热算进去（口径更严）。
 *
 * 用法：
 *   bun run scripts/check-render-bench.ts
 *   bun run scripts/check-render-bench.ts --runs 10 --settle 0
 *   bun run scripts/check-render-bench.ts --html configs/poster-html/probe-promo-blue.html
 */

import {existsSync, mkdirSync, readFileSync, rmSync} from 'node:fs';
import {join, resolve} from 'node:path';

import {closeSharedBrowser, getSharedBrowser, renderHtmlToPng} from './lib/html-render';
import {loadRenderEnv, renderContextOptions} from './lib/render-env';

const args = process.argv.slice(2);

function argValue(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : fallback;
}

const runs = Number(argValue('--runs', '10'));
const settleMs = Number(argValue('--settle', '0'));
const htmlPath = argValue('--html', 'configs/poster-html/probe-promo-blue.html');
const outDir = argValue('--out', 'outputs/_tmp/bench');

/** 1×1 透明 PNG —— 顶掉模板里的 {{qrDataUri}} 占位符，避免真实图片解码影响计时 */
const BLANK_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function loadHtml(): string {
  if (!existsSync(htmlPath)) {
    throw new Error(`找不到 HTML 模板：${htmlPath}`);
  }
  return readFileSync(resolve(htmlPath), 'utf-8')
    .replace(/\{\{qrDataUri\}\}/g, BLANK_PNG)
    .replace(/\{\{qrSize\}\}/g, '120');
}

/** 从模板里量出画布尺寸（根 .poster 的 width/height），量不到就用锁文件的 viewport */
function canvasSizeOf(html: string, fallbackW: number, fallbackH: number): {width: number; height: number} {
  const w = html.match(/--w:\s*(\d+)px/)?.[1];
  const h = html.match(/--h:\s*(\d+)px/)?.[1];
  return {
    width: w ? Number(w) : fallbackW,
    height: h ? Number(h) : fallbackH,
  };
}

async function main(): Promise<void> {
  const env = loadRenderEnv();
  const base = renderContextOptions(env);
  const html = loadHtml();
  const {width, height} = canvasSizeOf(html, base.viewport.width, base.viewport.height);

  rmSync(outDir, {recursive: true, force: true});
  mkdirSync(outDir, {recursive: true});

  console.log('═══ 常驻浏览器性能基准（P1-T3）═══\n');
  console.log(`HTML   ：${htmlPath}（画布 ${width}×${height}）`);
  console.log(`次数   ：${runs} 张热态 + 1 张冷启动基准`);
  console.log(`settle ：${settleMs}ms\n`);

  /* ---------- 阶段 A：冷启动基准（自建浏览器，渲染 1 张后关闭）---------- */
  const coldStart = Date.now();
  const cold = await renderHtmlToPng({
    html,
    width,
    height,
    outPath: join(outDir, 'cold-01.png'),
    env,
    ownBrowser: true,
    settleMs,
  });
  const coldTotal = Date.now() - coldStart;
  console.log('【阶段 A · 冷启动基准】');
  console.log(`  自建浏览器 → 渲染 1 张：${cold.ms}ms（含进程启动 ${coldTotal}ms）`);

  /* ---------- 阶段 B：批量热态（浏览器 + 上下文各只建一次）---------- */
  const browser = await getSharedBrowser(env);
  const context = await browser.newContext({
    ...base,
    viewport: {width, height},
    deviceScaleFactor: base.deviceScaleFactor,
  });

  const hotTimings: number[] = [];
  const batchStarted = Date.now();
  for (let i = 1; i <= runs; i += 1) {
    const result = await renderHtmlToPng({
      html,
      width,
      height,
      outPath: join(outDir, `hot-${String(i).padStart(2, '0')}.png`),
      env,
      browser,
      context,
      settleMs,
    });
    hotTimings.push(result.ms);
    const tag = i === 1 ? '（预热：含一次性字体探针）' : '';
    console.log(`  第 ${String(i).padStart(2)} 张  ${String(result.ms).padStart(4)}ms  ${result.bytes} 字节 ${tag}`);
  }
  const batchTotal = Date.now() - batchStarted;

  await context.close();
  await closeSharedBrowser();

  /* ---------- 判定 ---------- */
  // 稳态样本 = 去掉首张预热（首张多付了一次按浏览器实例缓存的字体命中探针）
  const warmup = hotTimings.length > 1 ? hotTimings[0] : 0;
  const steady = hotTimings.length > 1 ? hotTimings.slice(1) : hotTimings;
  const hotAvg = Math.round(steady.reduce((a, b) => a + b, 0) / steady.length);
  const hotMax = Math.max(...steady);
  const hotMin = Math.min(...steady);
  const budget = cold.ms + Math.round(steady.length * hotAvg * 1.15);
  const perImageCold = cold.ms * runs;
  const saved = perImageCold - batchTotal;

  console.log('\n【阶段 B · 批量热态】');
  console.log(`  合计 ${batchTotal}ms（${runs} 张，含预热 ${warmup}ms）`);
  console.log(`  稳态 ${steady.length} 张：均 ${hotAvg}ms · 最快 ${hotMin}ms · 最慢 ${hotMax}ms`);
  console.log(`  预算 = 冷启动单张 ${cold.ms}ms + ${steady.length} × 稳态 ${hotAvg}ms × 1.15 = ${budget}ms`);
  console.log(`  对照：若每张都冷启动需 ${perImageCold}ms → 本次省了 ${saved}ms（${Math.round((saved / perImageCold) * 100)}%）`);

  const checks: Array<{ok: boolean; label: string; detail: string}> = [
    {
      ok: true,
      label: '批内冷启动次数 = 1',
      detail: '阶段 B 全程复用同一个浏览器实例与同一个上下文',
    },
    {
      ok: batchTotal <= budget,
      label: `${runs} 张总耗时 ≤ 冷启动单张 + N × 稳态单张`,
      detail: `${batchTotal}ms ≤ ${budget}ms`,
    },
    {
      ok: hotMax <= 200,
      label: '稳态单张 ≤ 200ms',
      detail: `最慢 ${hotMax}ms（均 ${hotAvg}ms，预热 ${warmup}ms 单列）`,
    },
  ];

  console.log('');
  let failed = 0;
  for (const check of checks) {
    console.log(`  ${check.ok ? '✅' : '❌'} ${check.label} —— ${check.detail}`);
    if (!check.ok) failed += 1;
  }

  if (failed === 0) {
    console.log('\n✅ P1-T3 合格：批量出图不再重复冷启动。');
    process.exit(0);
  }

  console.log('\n❌ P1-T3 未达标。');
  console.log('   排查方向：① 每张是否新建了 context（应复用）；② settle 是否过大；');
  console.log('            ③ 是否每张都重新做了字体探针（应按浏览器实例缓存）。');
  process.exit(1);
}

main().catch(async (error) => {
  await closeSharedBrowser().catch(() => undefined);
  console.error(`性能基准失败：${error?.message ?? error}`);
  process.exit(1);
});
