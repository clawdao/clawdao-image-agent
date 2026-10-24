/**
 * check-render-env.ts — 渲染环境体检
 *
 * 出图链路切到 HTML 之后，「环境漂移」就等于「同样的配置出不同的成品」。
 * 这个脚本是体检入口，分两层：
 *
 *   静态校验（默认）
 *     • Playwright 版本是否与锁文件一致
 *     • 锁定版 Chromium 是否装好
 *     • 字体文件是否在位、family 名是否与文件里的 name 表对得上
 *     • 登记的字重是否在文件里存在
 *
 *   浏览器实测（--probe）
 *     • 必装字族**真的命中**了吗（像素级判定，不是 document.fonts.check）
 *     • 每个请求字重落到哪个真实 face？是「原生」「落到另一档」还是「合成加粗」？
 *     • 浏览器实测结果与 fonts.yaml 的登记是否一致
 *
 * 用法：
 *   bun run scripts/check-render-env.ts            # 静态校验
 *   bun run scripts/check-render-env.ts --probe    # 静态 + 浏览器实测
 *   bun run scripts/check-render-env.ts --env configs/poster-html/render-env.lock.yaml
 */

import { chromium } from 'playwright';

import { probeFamilies, type FontProbeReport } from './lib/font-probe';
import {
  loadRenderEnv,
  renderContextOptions,
  renderLaunchOptions,
  verifyRenderEnv,
  type RenderEnvConfig,
  type RenderEnvIssue,
} from './lib/render-env';

const args = process.argv.slice(2);
const probe = args.includes('--probe');
const envPath = (() => {
  const idx = args.indexOf('--env');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : undefined;
})();

function ok(text: string): void {
  console.log(`  ✓ ${text}`);
}

function bad(text: string): void {
  console.log(`  ✗ ${text}`);
}

function warn(text: string): void {
  console.log(`  ! ${text}`);
}

/** 浏览器实测 + 与锁文件登记交叉核对 */
async function probeFonts(env: RenderEnvConfig): Promise<boolean> {
  console.log('\n[浏览器实测] 字体命中探针（像素级判定）');

  let browser;
  try {
    browser = await chromium.launch(renderLaunchOptions(env) as any);
  } catch (error) {
    bad(`无法启动浏览器：${(error as Error).message}`);
    return false;
  }

  try {
    const context = await browser.newContext(renderContextOptions(env) as any);
    const page = await context.newPage();
    await page.setContent(
      '<!doctype html><html><head><meta charset="utf-8"></head>' +
        '<body style="margin:0;background:#fff"><div style="font:40px sans-serif">亿检链</div></body></html>',
      { waitUntil: 'load' },
    );

    const specs = Object.values(env.fonts.stacks).map((stack) => ({
      family: stack.family,
      file: env.fonts.files?.[stack.family] ?? '',
    }));
    // 只探测锁文件里登记过的字重 —— 未登记的字重不允许存在
    const weights = [
      ...new Set(env.fonts.weights.flatMap((g) => Object.keys(g.map ?? {}).map(Number))),
    ].sort((a, b) => a - b);
    const result: FontProbeReport = await probeFamilies(page, specs, weights);

    let allGood = true;
    for (const family of result.families) {
      const mark = family.resolved ? ok : bad;
      mark(
        `${family.family.padEnd(22)} 命中=${family.resolved} ` +
          `与泛型回退一致=${family.equalsGeneric} face 数=${family.faces.length}`,
      );
      if (!family.resolved) allGood = false;
    }

    console.log('');
    for (const family of result.families) {
      const group = env.fonts.weights.find((g) => g.family === family.family);
      for (const hit of family.hits) {
        const declared = group?.map?.[String(hit.requested)];
        const declaredText = declared
          ? `${declared.mode} → ${declared.resolved}`
          : '(未登记)';
        const actualText = hit.mode === 'synthesized' ? '合成加粗' : `${hit.face} (${hit.mode})`;
        const consistent = declared
          ? declared.mode === hit.mode &&
            (hit.mode !== 'synthesized' || true) &&
            (hit.mode === 'synthesized' || declared.resolved === family.faces.find((f) => f.familyName === hit.face)?.usWeightClass)
          : false;
        const line =
          `  ${family.family} @${String(hit.requested).padEnd(4)} ` +
          `实测=${actualText.padEnd(28)} 登记=${declaredText}` +
          (consistent ? '' : '  ← 不一致');
        if (consistent) ok(line);
        else {
          warn(line);
          allGood = false;
        }
      }
    }

    for (const note of result.notes) warn(note);
    await context.close();
    return allGood;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  console.log('═══ 渲染环境体检 ═══\n');
  const env = loadRenderEnv(envPath);
  console.log(`锁文件：${envPath ?? 'configs/poster-html/render-env.lock.yaml'}`);
  console.log(`字体锁：configs/poster-html/fonts.yaml`);
  console.log(`锁版本：${env.id} v${env.version}（更新于 ${env.updated}）\n`);

  console.log('[静态校验]');
  const report = verifyRenderEnv(env);
  ok(`Playwright 版本：${report.playwrightVersion}`);
  ok(`Chromium 可执行文件：${report.executable}`);
  const hashes = Object.entries(report.fontHashes).filter(([k]) => !k.includes(':size'));
  for (const [family, hash] of hashes) {
    const size = report.fontHashes[`${family}:size`];
    ok(`字体 ${family} 指纹 ${hash}（${size} 字节）`);
  }

  let failed = false;
  for (const issue of report.issues) {
    if (issue.level === 'error') {
      bad(`[${issue.code}] ${issue.message}`);
      failed = true;
    } else {
      warn(`[${issue.code}] ${issue.message}`);
    }
  }

  if (probe && !failed) {
    const fontsOk = await probeFonts(env);
    if (!fontsOk) failed = true;
  } else if (probe) {
    warn('静态校验已失败，跳过浏览器实测');
  }

  console.log('');
  if (failed) {
    console.log('❌ 渲染环境不合格 —— 出图结果不可复现，请按上面的提示修复。');
    process.exit(1);
  }
  console.log('✅ 渲染环境合格。');
  process.exit(0);
}

main().catch((error) => {
  console.error(`体检失败：${error?.message ?? error}`);
  process.exit(1);
});
