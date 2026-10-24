/**
 * check-render-determinism.ts — 确定性验证
 *
 * 为什么要专门验这个：
 *   HTML 出图的「同一份 HTML 排出同一张图」不是自动成立的。
 *   任何一处不确定性都会让批量出图变成「每张都不一样」：
 *     • 字体还没加载完就截图 → 某些张用 fallback 字排版
 *     • GPU 光栅化 / 次像素定位 → 同样的字有细微差别
 *     • 随机数 / 时间戳参与布局 → 每次都不一样
 *     • 动画 / 过渡未结束 → 截到中间帧
 *
 *   验法：同一份 HTML 连跑 N 次（每次**新开 context**，模拟批量出图），
 *   比对 PNG 的 SHA-256。必须**完全一致**，不是「差不多」。
 *
 * 用法：
 *   bun run scripts/check-render-determinism.ts
 *   bun run scripts/check-render-determinism.ts --html configs/poster-html/probe-promo-blue.html --runs 5
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { closeSharedBrowser, getSharedBrowser, renderHtmlToPng } from './lib/html-render';
import { loadRenderEnv, renderContextOptions } from './lib/render-env';

const args = process.argv.slice(2);
const runs = Number((() => {
  const idx = args.indexOf('--runs');
  return idx >= 0 && args[idx + 1] ? Number(args[idx + 1]) : 5;
})());
const htmlPath = (() => {
  const idx = args.indexOf('--html');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : 'configs/poster-html/probe-promo-blue.html';
})();
const outDir = (() => {
  const idx = args.indexOf('--out');
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : 'outputs/_tmp/determinism';
})();

const DEFAULT_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:1080px;height:1080px;overflow:hidden}
  body{background:linear-gradient(160deg,#123A86 0%,#0A2455 55%,#050F28 100%);font-family:'Hiragino Sans GB',sans-serif;color:#fff}
  h1{font-family:'YouSheBiaoTiHei',sans-serif;font-size:96px;margin:80px 0 24px;letter-spacing:2px}
  p{font-size:30px;line-height:1.7;margin:0 80px}
  .card{margin:60px 80px;padding:40px;border:2px solid #E8B24C;border-radius:24px;background:rgba(255,255,255,.06)}
</style></head>
<body>
  <h1>亿检链智能体实操训练营</h1>
  <p>从下载安装到跑通第一个智能体：10+ 节实操课 + 作业模板 + 直播答疑 + 班级群交流。</p>
  <div class="card"><p>环境安装 · 参数调试 · 提示词结构 · 流程编排 · 复盘验收</p></div>
</body></html>`;

async function main(): Promise<void> {
  const env = loadRenderEnv();
  const html = existsSync(htmlPath)
    ? readFileSync(resolve(htmlPath), 'utf-8')
    : DEFAULT_HTML;
  if (!existsSync(htmlPath)) {
    console.log(`（找不到 ${htmlPath}，改用内置样例 HTML）`);
  }

  rmSync(outDir, {recursive: true, force: true});
  mkdirSync(outDir, {recursive: true});

  console.log('═══ 确定性验证 ═══\n');
  console.log(`HTML：${existsSync(htmlPath) ? htmlPath : '(内置样例)'}`);
  console.log(`次数：${runs}   输出：${outDir}\n`);

  const browser = await getSharedBrowser(env);
  const base = renderContextOptions(env);
  const hashes: string[] = [];
  const timings: number[] = [];

  for (let i = 1; i <= runs; i += 1) {
    const outPath = join(outDir, `run-${String(i).padStart(2, '0')}.png`);
    const result = await renderHtmlToPng({
      html,
      width: base.viewport.width,
      height: base.viewport.height,
      outPath,
      env,
      browser,
      settleMs: 120,
    });
    const hash = createHash('sha256').update(readFileSync(outPath)).digest('hex');
    hashes.push(hash);
    timings.push(result.ms);
    console.log(
      `  第 ${i} 次  ${hash.slice(0, 16)}…  ${String(result.bytes).padStart(7)} 字节  ${result.ms}ms`,
    );
  }

  await closeSharedBrowser();

  const unique = [...new Set(hashes)];
  const avg = Math.round(timings.reduce((a, b) => a + b, 0) / timings.length);

  console.log('');
  if (unique.length === 1) {
    console.log(`✅ ${runs} 次渲染结果**完全一致**（SHA-256 ${unique[0].slice(0, 16)}…）`);
    console.log(`   平均耗时 ${avg}ms`);
    process.exit(0);
  }

  console.log(`❌ 渲染结果不一致：${unique.length} 种不同的输出`);
  for (const hash of unique) {
    const count = hashes.filter((h) => h === hash).length;
    console.log(`   ${hash}  ×${count}`);
  }
  console.log('   → 先查：字体是否每次都命中 / 是否引入了随机数或时间戳 / 动画是否未停');
  process.exit(1);
}

main().catch(async (error) => {
  await closeSharedBrowser().catch(() => undefined);
  console.error(`确定性验证失败：${error?.message ?? error}`);
  process.exit(1);
});
