#!/usr/bin/env node
/**
 * 海报工作室端到端验证
 *
 * 覆盖链路：模板渲染 → 加文字/撤销/重做 → AI 指令（真实 LLM） → 文生图（真实 image-01）
 *           → 设为背景 → 保存草稿 → 载入草稿 → 导出 PNG
 *
 * 前置：
 *   1. 后端已启动：bun run dev:backend（http://localhost:18795）
 *   2. 前端已启动：cd web && npx vite --host --port 5182（http://localhost:5182）
 *   3. 已安装 Playwright：npm i -D playwright && npx playwright install chromium
 *      （或 NODE_PATH 指向已有安装）
 *
 * 运行：node scripts/e2e-poster-studio.mjs
 */
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
let chromium;
try {
  ({chromium} = require('playwright'));
} catch {
  console.error(
    '未找到 playwright。请先执行：npm i -D playwright && npx playwright install chromium',
  );
  process.exit(2);
}

const BASE = process.env.STUDIO_URL || 'http://localhost:5182/';
const results = [];
const ok = (name, detail) => {
  results.push({name, pass: true});
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
  results.push({name, pass: false});
  console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
};

const canvasStats = (page) =>
  page.evaluate(() => {
    const canvas = window.__posterStudio.getCanvas();
    const el = canvas.elements.lower.el;
    const ctx = el.getContext('2d');
    const data = ctx.getImageData(0, 0, el.width, el.height).data;
    let opaque = 0;
    const colors = new Set();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 0) {
        opaque++;
        if (colors.size < 5000) {
          colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
        }
      }
    }
    const sketch = canvas.getObjects().find((o) => o.id === 'ddn-poster-sketch');
    return {
      opaque,
      distinct: colors.size,
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      ids: canvas.getObjects().map((o) => o.id || o.type),
      sketchFill:
        !sketch ? null : typeof sketch.fill === 'string' ? sketch.fill : `gradient:${sketch.fill?.type}`,
    };
  });

const browser = await chromium.launch({
  channel: process.env.STUDIO_CHROME === '1' ? 'chrome' : undefined,
  headless: true,
});
const page = await browser.newPage({viewport: {width: 1680, height: 1020}});
const pageErrors = [];
const badResponses = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});

try {
  console.log('\n[1] 打开工作室');
  await page.goto(BASE, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: '海报工作室'}).click();
  await page.waitForSelector('canvas', {timeout: 20000});
  await page.waitForTimeout(2500);

  let stats = await canvasStats(page);
  stats.opaque > 1000
    ? ok('画布有内容', `opaque=${stats.opaque} distinct=${stats.distinct}`)
    : fail('画布有内容', `opaque=${stats.opaque}`);
  stats.width === 684 && stats.height === 1440
    ? ok('画布尺寸正确', `${stats.width}×${stats.height}`)
    : fail('画布尺寸正确', `${stats.width}×${stats.height}`);
  stats.sketchFill?.startsWith('gradient')
    ? ok('模板渐变背景生效', stats.sketchFill)
    : fail('模板渐变背景生效', String(stats.sketchFill));
  const layerRows = await page.locator('[data-testid="layer-row"]').count();
  layerRows >= 9 ? ok('图层列表渲染', `${layerRows} 行`) : fail('图层列表渲染', `${layerRows} 行`);

  console.log('\n[2] 加文字 / 撤销 / 重做');
  const before = stats.ids.length;
  await page.getByRole('button', {name: '加文字'}).click();
  await page.waitForTimeout(800);
  const afterAdd = (await canvasStats(page)).ids.length;
  afterAdd === before + 1
    ? ok('加文字新增图层', `${before} → ${afterAdd}`)
    : fail('加文字新增图层', `${before} → ${afterAdd}`);

  await page.getByRole('button', {name: '撤销'}).click();
  await page.waitForTimeout(1000);
  const afterUndo = (await canvasStats(page)).ids.length;
  afterUndo === before
    ? ok('撤销回到原状', `${afterAdd} → ${afterUndo}`)
    : fail('撤销回到原状', `${afterAdd} → ${afterUndo}`);

  await page.getByRole('button', {name: '重做'}).click();
  await page.waitForTimeout(1000);
  const afterRedo = (await canvasStats(page)).ids.length;
  afterRedo === afterAdd
    ? ok('重做恢复修改', `${afterUndo} → ${afterRedo}`)
    : fail('重做恢复修改', `${afterUndo} → ${afterRedo}`);

  console.log('\n[3] AI 指令（真实 LLM 调用）');
  await page
    .getByPlaceholder('例：把主标题改成「智能体实操课」，字号 96，白色')
    .fill('把主标题改成「自动化质检实训」，字号 90，颜色 #0A2455');
  await page.getByRole('button', {name: '执行指令'}).click();
  let titleText = '';
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    titleText = await page.evaluate(() => {
      const canvas = window.__posterStudio.getCanvas();
      const t = canvas.getObjects().find((o) => o.id === 'title');
      return t?.text || '';
    });
    if (titleText.includes('自动化质检实训')) break;
  }
  titleText.includes('自动化质检实训')
    ? ok('AI 指令改写标题', titleText.slice(0, 20))
    : fail('AI 指令改写标题', titleText.slice(0, 40));

  console.log('\n[4] 文生图（真实 MiniMax image-01）');
  await page
    .getByPlaceholder('例：深蓝渐变背景，几何光带，右侧留出标题区，干净无文字')
    .fill('极简科技风背景，深蓝到藏青渐变，右侧留出标题区，无文字');
  await page.getByRole('button', {name: /文生图|图生图/}).click();
  await page.waitForSelector('img[src*="/outputs/poster/studio/"]', {timeout: 180000});
  await page.waitForTimeout(1200);
  const genUrl = await page
    .locator('img[src*="/outputs/poster/studio/"]')
    .first()
    .getAttribute('src');
  ok('文生图产出', genUrl);

  console.log('\n[5] 设为背景');
  await page.getByRole('button', {name: '设为背景'}).first().click();
  await page.waitForTimeout(1500);
  stats = await canvasStats(page);
  stats.ids.includes('ddn-poster-bg-image')
    ? ok('背景图层已插入')
    : fail('背景图层已插入', JSON.stringify(stats.ids));

  console.log('\n[6] 保存草稿');
  await page.getByPlaceholder('草稿名').fill('e2e-海报');
  await page.getByRole('button', {name: '保存'}).click();
  await page.waitForTimeout(2500);
  const draftList = await page.evaluate(async () => {
    const res = await fetch('/api/poster/drafts');
    const data = await res.json();
    return data.drafts || data.data || [];
  });
  draftList.length >= 1
    ? ok('草稿已保存', `${draftList.length} 条`)
    : fail('草稿已保存', '列表为空');

  console.log('\n[7] 载入草稿');
  await page.locator('.ant-select-selector').last().click();
  await page.waitForTimeout(600);
  await page.locator('.ant-select-item-option').first().click();
  await page.waitForTimeout(2500);
  stats = await canvasStats(page);
  stats.ids.includes('ddn-poster-bg-image')
    ? ok('草稿含背景图层', `${stats.ids.length} 个对象`)
    : fail('草稿含背景图层', JSON.stringify(stats.ids));

  console.log('\n[8] 导出 PNG');
  const exported = await page.evaluate(async () => {
    return await window.__posterStudio.editorRef.current.exportPng(
      {},
      {multiplier: 1, background: window.__posterStudio.getDesign().background},
    );
  });
  if (exported && exported.startsWith('data:image/png')) {
    const dims = await page.evaluate(async (dataUrl) => {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = rej;
        img.src = dataUrl;
      });
      return {w: img.naturalWidth, h: img.naturalHeight, len: dataUrl.length};
    }, exported);
    dims.w === 1080 && dims.h === 1440
      ? ok('导出 PNG 尺寸正确', `${dims.w}×${dims.h}, ${Math.round(dims.len / 1024)}KB`)
      : fail('导出 PNG 尺寸正确', `${dims.w}×${dims.h}`);
  } else {
    fail('导出 PNG', String(exported).slice(0, 60));
  }

  console.log('\n[9] 运行时异常');
  pageErrors.length === 0
    ? ok('无运行时异常')
    : fail('无运行时异常', JSON.stringify(pageErrors.slice(0, 3)));
  if (badResponses.length) {
    console.log(`  ! 存在 ${badResponses.length} 个 4xx/5xx 响应：`);
    badResponses.slice(0, 5).forEach((r) => console.log(`    - ${r}`));
  }
} catch (e) {
  fail('E2E 执行', e.message);
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
