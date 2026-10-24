/**
 * render-env.ts — HTML 海报渲染环境锁（加载 / 解析 / 校验 / 浏览器实测）
 *
 * 背景：出图链路切到 HTML 之后，「同一份配置」必须在任何机器上排出**同一张图**。
 * 会改变像素的环境因素：
 *   1. 浏览器版本与启动参数（抗锯齿、字距、GPU 光栅化）
 *   2. 页面上下文（deviceScaleFactor / 色彩方案 / locale / 时区）
 *   3. 字体 family 命中（缺 family 会静默回退，字宽全变）
 *   4. 字体字重命中（缺字重会静默合成粗体，同样静默）
 *   5. 渲染时机（字体未就绪就截图 = 用 fallback 字排的版）
 *
 * 锁文件：
 *   - `configs/poster-html/render-env.lock.yaml`（浏览器 + 上下文）
 *   - `configs/poster-html/fonts.yaml`（family + 字重 + 文件指纹）
 *
 * 校验分两层：
 *   静态层 —— 读字体文件的 OS/2.usWeightClass 与 name 表，核对锁文件登记
 *   浏览器层 —— 量宽比对，确认浏览器**真的**命中了登记的 face
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Page } from 'playwright';

import { loadConfig } from './config';
import { readFontFile, type WeightResolution } from './font-weight';

export interface RenderEnvBrowserConfig {
  channel: string;
  revision: number;
  browserVersion: string;
  playwrightVersion: string;
  args: string[];
}

export interface RenderEnvContextConfig {
  deviceScaleFactor: number;
  colorScheme: 'light' | 'dark' | 'no-preference';
  reducedMotion: 'reduce' | 'no-preference';
  forcedColors: 'none' | 'active';
  locale: string;
  timezoneId: string;
  hasTouch: boolean;
  isMobile: boolean;
  javaScriptEnabled: boolean;
}

export interface FontStackSlot {
  family: string;
  stack: string;
  required: string[];
  legacyStack?: string;
}

export interface FontWeightEntry {
  resolved: number;
  mode: 'native' | 'synthesized' | 'nearest';
  note?: string;
}

export interface FontWeightGroup {
  family: string;
  file: string;
  fileWeights: number[];
  map: Record<string, FontWeightEntry>;
}

export interface FontsConfig {
  id: string;
  version: number;
  updated: string;
  stacks: { title: FontStackSlot; body: FontStackSlot };
  weights: FontWeightGroup[];
  semantic: Record<string, number>;
  files: Record<string, string>;
}

export interface RenderEnvConfig {
  id: string;
  version: number;
  updated: string;
  browser: RenderEnvBrowserConfig;
  context: RenderEnvContextConfig;
  fonts: FontsConfig;
}

export interface RenderEnvIssue {
  level: 'error' | 'warn';
  code: string;
  message: string;
}

export interface RenderEnvReport {
  ok: boolean;
  issues: RenderEnvIssue[];
  executable: string;
  playwrightVersion: string;
  fontHashes: Record<string, string>;
}

export const RENDER_ENV_PATH = 'configs/poster-html/render-env.lock.yaml';
export const FONTS_PATH = 'configs/poster-html/fonts.yaml';

/** 展开 `~` */
export function expandHome(filePath: string): string {
  if (filePath.startsWith('~/')) return join(homedir(), filePath.slice(2));
  return filePath;
}

/** 读取渲染环境锁文件 */
export function loadRenderEnv(
  envPath: string = RENDER_ENV_PATH,
  fontsPath: string = FONTS_PATH,
): RenderEnvConfig {
  const env = loadConfig<Omit<RenderEnvConfig, 'fonts'>>(resolve(envPath));
  if (!env?.data?.browser || !env?.data?.context) {
    throw new Error(`渲染环境锁文件不完整：${envPath}`);
  }
  const fonts = loadConfig<FontsConfig>(resolve(fontsPath));
  if (!fonts?.data?.stacks || !fonts?.data?.weights) {
    throw new Error(`字体锁文件不完整：${fontsPath}`);
  }
  return { ...env.data, fonts: fonts.data };
}

/** 当前安装的 Playwright 版本 */
export function installedPlaywrightVersion(): string {
  try {
    const pkgPath = require.resolve('playwright/package.json');
    return JSON.parse(readFileSync(pkgPath, 'utf-8')).version as string;
  } catch {
    return 'unknown';
  }
}

/**
 * 解析**锁定的** Chromium 可执行文件。
 *
 * 不兜底到「本机缓存里随便哪个 Chromium」——那会让出图结果随机器漂移。
 * 找不到锁定版本就明确报错，让使用者去跑 `playwright install chromium`。
 */
export function resolvePinnedChromium(config: RenderEnvConfig): string {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (explicit && existsSync(explicit)) return explicit;

  let pinned: string;
  try {
    pinned = chromium.executablePath();
  } catch (error) {
    throw new Error(
      `锁定版 Chromium（revision ${config.browser.revision}）未安装。\n` +
        `请执行：bunx playwright install chromium\n` +
        `原始错误：${(error as Error).message}`,
    );
  }
  if (!existsSync(pinned)) {
    throw new Error(
      `锁定版 Chromium 不存在：${pinned}\n` +
        `请执行：bunx playwright install chromium`,
    );
  }
  return pinned;
}

/** 生成 Playwright 的 context 参数 */
export function renderContextOptions(config: RenderEnvConfig) {
  const ctx = config.context;
  return {
    viewport: { width: 1080, height: 1080 },
    deviceScaleFactor: ctx.deviceScaleFactor,
    colorScheme: ctx.colorScheme,
    reducedMotion: ctx.reducedMotion,
    forcedColors: ctx.forcedColors,
    locale: ctx.locale,
    timezoneId: ctx.timezoneId,
    hasTouch: ctx.hasTouch,
    isMobile: ctx.isMobile,
    javaScriptEnabled: ctx.javaScriptEnabled,
  };
}

/** 生成 Playwright 的 launch 参数 */
export function renderLaunchOptions(config: RenderEnvConfig) {
  return {
    executablePath: resolvePinnedChromium(config),
    args: config.browser.args,
  };
}

/** 字体文件指纹 */
export function hashFontFile(filePath: string): string | null {
  const abs = expandHome(filePath);
  if (!existsSync(abs)) return null;
  const buffer = readFileSync(abs);
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12);
}

/**
 * 静态校验：不启动浏览器就能查的部分。
 * 浏览器内的 family / 字重实测见 `scripts/lib/font-probe.ts`（像素级 coverage 指纹）。
 */
export function verifyRenderEnv(config: RenderEnvConfig): RenderEnvReport {
  const issues: RenderEnvIssue[] = [];

  // —— 浏览器 ——
  const pwVersion = installedPlaywrightVersion();
  if (pwVersion !== config.browser.playwrightVersion) {
    issues.push({
      level: 'error',
      code: 'playwright-version',
      message:
        `Playwright 版本不匹配：期望 ${config.browser.playwrightVersion}，实际 ${pwVersion}。` +
        `版本差异会改变 Chromium 版本，进而改变字距与抗锯齿。`,
    });
  }

  let executable = '(未解析)';
  try {
    executable = resolvePinnedChromium(config);
  } catch (error) {
    issues.push({ level: 'error', code: 'chromium-missing', message: (error as Error).message });
  }

  // —— 字体文件 ——
  const fontHashes: Record<string, string> = {};
  for (const [family, filePath] of Object.entries(config.fonts.files ?? {})) {
    const abs = expandHome(filePath);
    if (!existsSync(abs)) {
      issues.push({
        level: 'error',
        code: 'font-file-missing',
        message: `字体文件缺失：${family} → ${abs}（缺字体会静默回退，出图与设计稿不一致）`,
      });
      continue;
    }
    const hash = hashFontFile(filePath);
    if (hash) fontHashes[family] = hash;
    fontHashes[`${family}:size`] = String(statSync(abs).size);
  }

  // —— family 名是否真的存在于字体文件里 ——
  for (const slot of ['title', 'body'] as const) {
    const stack = config.fonts.stacks[slot];
    if (!stack?.stack) {
      issues.push({ level: 'error', code: 'font-stack-missing', message: `字体槽 ${slot} 缺少 stack` });
      continue;
    }
    for (const family of stack.required ?? []) {
      const filePath = config.fonts.files?.[family];
      if (!filePath) {
        issues.push({
          level: 'error',
          code: 'font-file-unregistered',
          message: `必装字族 ${family} 没有登记字体文件路径`,
        });
        continue;
      }
      const info = readFontFile(filePath);
      if (!info.faces.length) {
        issues.push({
          level: 'error',
          code: 'font-file-unreadable',
          message: `字体文件解析失败：${family} → ${info.path}（${info.warnings.join('；')}）`,
        });
        continue;
      }
      const names = new Set(info.faces.flatMap((f) => f.familyNames));
      if (!names.has(family)) {
        issues.push({
          level: 'error',
          code: 'font-family-name-mismatch',
          message:
            `字族名对不上：锁文件写「${family}」，但 ${info.path} 里的 family 名是 ` +
            `${[...names].slice(0, 6).join(' / ')}。CSS 匹配不到这个名字 → 浏览器会静默落到别的字体。`,
        });
      }
    }
  }

  // —— 字重登记 vs 文件实际字重 ——
  for (const group of config.fonts.weights ?? []) {
    const filePath = group.file ?? config.fonts.files?.[group.family];
    if (!filePath) {
      issues.push({
        level: 'error',
        code: 'weight-group-no-file',
        message: `字重组 ${group.family} 没有字体文件路径`,
      });
      continue;
    }
    const info = readFontFile(filePath);
    if (!info.faces.length) continue;

    const actual = info.weights;
    const declared = group.fileWeights ?? [];
    if (declared.length && declared.join(',') !== actual.join(',')) {
      issues.push({
        level: 'error',
        code: 'weight-file-mismatch',
        message:
          `字重登记与字体文件不符：${group.family} 登记 [${declared.join('/')}]，` +
          `文件实际 [${actual.join('/')}]。请更新 fonts.yaml 或重装字体。`,
      });
    }

    for (const [requested, entry] of Object.entries(group.map ?? {})) {
      const want = Number(requested);
      // 语义（与浏览器一致）：
      //   native     —— 请求的字重文件里就有，浏览器直接用它
      //   nearest    —— 文件里没有这一档，浏览器落到**另一档真实 face**（字形是真的，只是更粗/更细）
      //   synthesized —— 文件里既没有这一档、也没有更接近的真实 face，浏览器**合成加粗**（字形被改过）
      // 「文件里没有请求的字重」本身不是错误 —— 浏览器永远会落到某一档，
      // 错的是**没把它登记下来**，或者登记成 native 但文件里根本没有。
      if (entry.mode === 'native' && !actual.includes(want)) {
        issues.push({
          level: 'error',
          code: 'weight-claimed-native',
          message:
            `${group.family} 字重 ${want} 在文件里**不存在**（只有 ${actual.join('/')}），` +
            `不能登记成 mode: native。`,
        });
      }
      if (entry.mode === 'nearest' && !actual.includes(entry.resolved)) {
        issues.push({
          level: 'error',
          code: 'weight-claimed-nearest',
          message:
            `${group.family} 字重 ${want} 登记 nearest → ${entry.resolved}，` +
            `但文件里没有 ${entry.resolved} 这一档（只有 ${actual.join('/')}）。`,
        });
      }
      if (entry.mode === 'synthesized' && actual.includes(want)) {
        issues.push({
          level: 'error',
          code: 'weight-claimed-synthesized',
          message:
            `${group.family} 字重 ${want} 在文件里是**真实存在**的（${actual.join('/')}），` +
            `不该登记成 mode: synthesized。`,
        });
      }
      if (entry.mode !== 'native' && entry.mode !== 'nearest' && entry.mode !== 'synthesized') {
        issues.push({
          level: 'error',
          code: 'weight-mode-unknown',
          message: `${group.family} 字重 ${want} 的 mode 非法：${entry.mode}`,
        });
      }
    }
  }

  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    issues,
    executable,
    playwrightVersion: pwVersion,
    fontHashes,
  };
}
