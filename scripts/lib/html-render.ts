/**
 * html-render.ts — HTML → PNG（无头浏览器渲染）
 *
 * 背景：项目里 `poster-renderer.ts` 是自研 SVG 排版器，中文换行靠
 * `textUnits()` **估算**字宽（汉字 1.0 / 空格 0.3 / 大写数字 0.62 / 其他 0.52）。
 * 浏览器有真字体度量（CoreText/Pango），两者会在中英混排处产生不同的换行结果。
 *
 * 本模块提供「同一份 HTML 在浏览器里排版 + 截图」的出图能力，
 * 并把「可复现」这件事做成硬约束：
 *   1. 浏览器走**常驻进程**（批量出图不再每次冷启动，省 200ms+ 一次）
 *   2. 浏览器 / 上下文参数全部来自 `configs/poster-html/render-env.lock.yaml` 锁文件
 *   3. 截图前强制等 `document.fonts.ready` + 字体命中探针，**不允许**用 fallback 字排版
 *   4. 启动参数关掉 GPU 光栅化 / 次像素定位等一切不确定因素
 *
 * 浏览器解析顺序（严格模式，正式出图用）：
 *   1. 环境变量 PLAYWRIGHT_CHROMIUM_EXECUTABLE
 *   2. Playwright 锁定版本的 Chromium（`chromium.executablePath()`）
 *   3. 报错（不兜底到系统 Chrome —— 会随系统升级漂移）
 *
 * 宽松模式（仅供阶段 0 探针与排障用）：见 `resolveChromiumExecutable()`。
 */

import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {homedir} from 'node:os';

import {chromium, type Browser, type BrowserContext, type Page} from 'playwright';

import {probeFamilies, type FontProbeReport} from './font-probe';
import {
  loadRenderEnv,
  renderContextOptions,
  renderLaunchOptions,
  type RenderEnvConfig,
} from './render-env';

export interface HtmlRenderOptions {
  /** HTML 源码 */
  html: string;
  /** 视口宽（= 成品宽） */
  width: number;
  /** 视口高（= 成品高） */
  height: number;
  /** 输出文件（.png） */
  outPath: string;
  /** 设备像素比（2 = 二倍图）；不填取锁文件值 */
  deviceScaleFactor?: number;
  /** 截图前的额外等待（毫秒），用于等图片解码 */
  settleMs?: number;
  /** 截图前的钩子：页面已加载后执行（如基线对齐）；返回值由调用方自行接收 */
  prepare?: (page: Page) => Promise<unknown>;
  /** 复用已打开的浏览器（批量出图时省冷启动） */
  browser?: Browser;
  /**
   * 复用已有上下文（批量出图时省 context 创建开销）。
   *
   * 传了它**不会**被本次渲染关闭 —— 生命周期归调用方管。
   * 批量出图的正确姿势：浏览器 + 上下文各建一次，逐张只做 `setContent` + 截图。
   */
  context?: BrowserContext;
  /** 自建浏览器并在本次结束后关闭（默认 false：走常驻池） */
  ownBrowser?: boolean;
  /** 渲染环境锁（不填读默认锁文件） */
  env?: RenderEnvConfig;
  /** 字体命中探针：true 时若必装字族未生效直接抛错 */
  verifyFonts?: boolean;
}

export interface HtmlRenderResult {
  path: string;
  width: number;
  height: number;
  bytes: number;
  /** 渲染耗时（毫秒，含浏览器启动） */
  ms: number;
  /** 实际使用的浏览器可执行文件 */
  executable: string;
  /** prepare 钩子的返回值（由调用方自行解读） */
  prepared?: unknown;
  /** 字体探针结果 */
  fonts?: FontProbeReport;
}

/** 从 ms-playwright 缓存目录里找 Chromium（按版本号倒序取最新）—— 宽松模式专用 */
function findCachedChromium(): string | null {
  const cacheRoot = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const linuxRoot = join(homedir(), '.cache', 'ms-playwright');
  const roots = [cacheRoot, linuxRoot].filter((dir) => existsSync(dir));

  const candidates: string[] = [];

  for (const root of roots) {
    let entries: string[] = [];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    const chromiumDirs = entries
      .filter((name) => name.startsWith('chromium'))
      .sort((a, b) => Number(b.replace(/\D+/g, '') || 0) - Number(a.replace(/\D+/g, '') || 0));

    for (const dir of chromiumDirs) {
      const base = join(root, dir);
      for (const rel of [
        'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
        'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
        'chrome-linux/chrome',
      ]) {
        const abs = join(base, rel);
        if (existsSync(abs)) candidates.push(abs);
      }
      // headless shell（更轻，截图够用）
      for (const rel of [
        'chrome-headless-shell-mac-arm64/chrome-headless-shell',
        'chrome-headless-shell-linux/chrome-headless-shell',
      ]) {
        const abs = join(base, rel);
        if (existsSync(abs)) candidates.push(abs);
      }
    }
  }
  return candidates[0] ?? null;
}

/** 解析可用的浏览器可执行文件（宽松模式：兜底到系统 Chrome） */
export function resolveChromiumExecutable(): string | null {
  const fromEnv = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const cached = findCachedChromium();
  if (cached) return cached;

  for (const abs of [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ]) {
    if (existsSync(abs)) return abs;
  }
  return null;
}

/* ============================ 常驻浏览器池 ============================ */

let sharedBrowserPromise: Promise<Browser> | null = null;
let sharedEnvKey = '';

/** 环境锁的指纹：换了锁就换一个浏览器实例（参数不同不能复用） */
function envKeyOf(env: RenderEnvConfig): string {
  return JSON.stringify({
    args: env.browser.args,
    context: env.context,
  });
}

/**
 * 取常驻浏览器（首次调用会启动，之后复用）。
 *
 * 为什么必须常驻：
 *   一次冷启动 ≈ 280ms（阶段 0 实测），批量出 10 张图光启动就 3 秒；
 *   而且每次启动都可能落到不同的缓存 Chromium revision，结果不可复现。
 */
export async function getSharedBrowser(env: RenderEnvConfig = loadRenderEnv()): Promise<Browser> {
  const key = envKeyOf(env);
  if (sharedBrowserPromise && sharedEnvKey === key) return sharedBrowserPromise;

  if (sharedBrowserPromise) {
    // 锁变了：先关掉旧的
    const old = sharedBrowserPromise;
    sharedBrowserPromise = null;
    old.then((browser) => browser.close()).catch(() => undefined);
  }

  sharedEnvKey = key;
  sharedBrowserPromise = chromium.launch(renderLaunchOptions(env) as any);
  return sharedBrowserPromise;
}

/** 关闭常驻浏览器（进程退出前调用，避免留僵尸进程） */
export async function closeSharedBrowser(): Promise<void> {
  const pending = sharedBrowserPromise;
  sharedBrowserPromise = null;
  sharedEnvKey = '';
  if (!pending) return;
  try {
    const browser = await pending;
    await browser.close();
  } catch {
    /* 忽略关闭异常 */
  }
}

/* ============================ 字体就绪 ============================ */

/**
 * 字体探针结果的缓存。
 *
 * 探针是像素级的（每个候选 family 名都画一遍 canvas 再取指纹），
 * 单次约 200ms。字体环境在一个浏览器实例内不会变，
 * 所以每个浏览器实例只验一次，后续渲染直接复用结果。
 */
const fontProbeCache = new WeakMap<Browser, {key: string; report: FontProbeReport}>();

/**
 * 等字体真正就绪，并（可选）验证必装字族确实生效。
 *
 * `document.fonts.ready` 只保证「已经触发加载的字体加载完」，
 * 不保证「你要的字族真的存在」—— 不存在时会静默回退到别的字，字宽全变。
 * 所以这里额外用**像素级**探针做二次确认：把字画出来比轮廓指纹，
 * 与泛型回退一致就说明根本没命中。
 */
export async function waitForFonts(
  page: Page,
  env: RenderEnvConfig,
  verify = true,
  browser?: Browser,
): Promise<FontProbeReport | undefined> {
  await page.evaluate(() => (document as any).fonts?.ready);

  if (!verify) return undefined;

  const key = JSON.stringify({ stacks: env.fonts.stacks, files: env.fonts.files });
  if (browser) {
    const cached = fontProbeCache.get(browser);
    if (cached && cached.key === key) return cached.report;
  }

  const specs = Object.values(env.fonts.stacks).map((stack) => ({
    family: stack.family,
    file: env.fonts.files?.[stack.family] ?? '',
  }));
  const report = await probeFamilies(page, specs);

  const unresolved = report.families.filter((f) => !f.resolved).map((f) => f.family);
  if (unresolved.length) {
    throw new Error(
      `必装字体未生效：${unresolved.join('、')}。` +
        `这会导致出图与设计稿字宽不一致。` +
        `请检查 fonts.yaml 的 files 指向的字体文件是否存在，或该字族本机是否安装。` +
        `（指纹：${report.families.map((f) => `${f.family}=${f.resolved ? '命中' : '未命中'}`).join('、')}）`,
    );
  }

  if (browser) fontProbeCache.set(browser, {key, report});
  return report;
}

/* ============================ 主渲染 ============================ */

/**
 * 渲染 HTML 为 PNG。
 *
 * 关键细节：
 *   - viewport 精确等于成品尺寸 + deviceScaleFactor，截出来就是 1:1 像素；
 *   - 等待 `document.fonts.ready` + 字体命中探针，否则中文可能用 fallback 字体排版（字宽全变）；
 *   - 注入 `__baselineOf()` 探针：返回元素内首行文本基线相对元素顶部的偏移，
 *     供「HTML 版式 vs SVG 版式」逐行基线对齐使用。
 */
export async function renderHtmlToPng(options: HtmlRenderOptions): Promise<HtmlRenderResult> {
  const started = Date.now();
  const env = options.env ?? loadRenderEnv();
  const ownBrowser = options.ownBrowser === true;
  const executable = renderLaunchOptions(env).executablePath;

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const ownsContext = !options.context;
  try {
    browser = options.browser ?? (ownBrowser ? await chromium.launch(renderLaunchOptions(env) as any) : await getSharedBrowser(env));
    const base = renderContextOptions(env);
    context = options.context ?? await browser.newContext({
      ...base,
      viewport: {width: options.width, height: options.height},
      deviceScaleFactor: options.deviceScaleFactor ?? base.deviceScaleFactor,
    });
    const page = await context.newPage();

    await page.setContent(options.html, {waitUntil: 'load'});
    const fonts = await waitForFonts(page, env, options.verifyFonts !== false, browser);
    if (options.settleMs) await page.waitForTimeout(options.settleMs);
    const prepared = options.prepare ? await options.prepare(page) : undefined;

    mkdirSync(dirname(options.outPath), {recursive: true});
    const buffer = await page.screenshot({type: 'png', fullPage: false});
    writeFileSync(options.outPath, buffer);

    return {
      path: options.outPath,
      width: options.width,
      height: options.height,
      bytes: buffer.length,
      ms: Date.now() - started,
      executable,
      prepared,
      fonts,
    };
  } finally {
    if (ownsContext) await context?.close();
    if (ownBrowser) await browser?.close();
  }
}

/**
 * 浏览器里跑的基线探针脚本（注入页面执行）。
 *
 * 对每个带 `data-base` 属性的元素：
 *   - 测量它的首行文本基线（相对元素顶部）
 *   - 与 `data-base` 指定的 SVG 基线对齐（translateY 校正）
 *   - 回传测量结果，供报告使用。
 */
export const BASELINE_ALIGN_SCRIPT = `
(() => {
  const baselineOffset = (el) => {
    const marker = document.createElement('span');
    marker.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline;';
    el.appendChild(marker);
    const top = marker.getBoundingClientRect().top;
    marker.remove();
    return top - el.getBoundingClientRect().top;
  };

  // 逐字符取基线 y，y 变化即换行 —— 拿到浏览器真实的断行位置
  const splitLineTexts = (el) => {
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) return [];
    const text = node.textContent || '';
    const range = document.createRange();
    const groups = [];
    let cur = null;
    for (let i = 0; i < text.length; i++) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const top = Math.round(range.getBoundingClientRect().top);
      if (!cur || Math.abs(top - cur.top) > 2) {
        cur = {top, text: ''};
        groups.push(cur);
      }
      cur.text += text[i];
    }
    return groups.map((g) => g.text);
  };

  const results = [];
  document.querySelectorAll('[data-base]').forEach((el) => {
    const target = parseFloat(el.getAttribute('data-base'));
    const box = el.getBoundingClientRect();
    const offset = baselineOffset(el);
    const current = box.top + offset;
    const delta = target - current;
    if (Math.abs(delta) > 0.5) {
      const prev = el.style.transform;
      el.style.transform = prev ? prev + ' translateY(' + delta + 'px)' : 'translateY(' + delta + 'px)';
    }
    const style = getComputedStyle(el);
    const lineTexts = splitLineTexts(el);
    results.push({
      key: el.getAttribute('data-key') || el.className,
      target,
      current,
      delta,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      lines: lineTexts.length || Math.round(el.getBoundingClientRect().height / (parseFloat(style.lineHeight) || 1)),
      lineTexts,
      text: (el.textContent || '').trim().slice(0, 60),
    });
  });
  return results;
})()
`;
