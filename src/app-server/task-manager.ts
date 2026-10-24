/**
 * app-server/task-manager.ts — Bun 运行时的任务管理（无 egg 依赖）
 *
 * 流程：创建任务 →（可选）M3 多模态分析取 DNA → 组装模板 → MiniMax image-01 生成
 * → base64 落盘 outputs/ → 返回 /outputs/ URL
 *
 * key 来源：MINIMAX_CN_API_KEY / MINIMAX_API_KEY env → ~/.clawdao/auth.json
 *
 * v0.2 新增：A/B 变体批量生成
 *   - 输入 variantCount（1~5，默认 1）
 *   - 走 image-01 的 n 参数一次请求 N 张（30~60s 出齐）
 *   - 兼容老 API：imageUrl 始终等于 variants[0].url
 */

import {writeFileSync, mkdirSync, existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {homedir} from 'node:os';

import {analyzeImages} from '../lib/multimodal-analyzer';
import {smartGenerate} from '../lib/image-generator';
import {applyTextOverlay} from '../lib/text-overlay';
import {composeBanner, defaultBrandAssetDir, resolveBrandAsset} from '../lib/banner-compositor';
import {getPreset} from '../lib/presets';
import {createStorage, asLegacyMap, type StorageTask} from '../lib/storage';

import type {VisualDNA} from '../lib/multimodal-analyzer';
import type {Task, Category, ColorTone, ThemeConfig, VariantConfig} from '../types/index';

export interface TaskInput {
  category: Category;
  refImages?: string[]; // base64 或 URL
  theme: ThemeConfig & { title: string };
  colorTone?: ColorTone;
  useLobster?: boolean;
  customPrompt?: string;
  scene?: string;  // 场景库 key（livestream/product_launch/holiday/recruiting）
  // —— v0.2 新增 ——
  /** 变体数量（1~5，默认 1） */
  variantCount?: number;
  /** 变体策略（默认 parallel；diverse 留给 v0.3） */
  variantStrategy?: 'parallel' | 'diverse';
}

export interface RuntimeConfig {
  apiKey: string;
  imageBaseUrl?: string;   // https://api.minimaxi.com
  llmBaseUrl?: string;     // anthropic 端点（多模态 M3）
  outputDir: string;       // 绝对路径
  urlPrefix?: string;      // /outputs/
  imageModel?: string;
  /** 测试或纯背景处理可关闭；生产默认开启精确文字叠加 */
  textOverlay?: boolean;
  /**
   * 品牌资产目录（IP 抠图稿）。默认 public/brand。
   * 目录里没有 lobster-cutout.png 时自动降级为“无 IP 的纯背景”，不会报错。
   */
  brandAssetDir?: string;
  /**
   * 图像生成函数的依赖注入口（默认真实 smartGenerate）。
   * 测试借此替换行为，而不必用 mock.module —— 后者是进程级全局替换，
   * 会污染同进程里其它测试文件对 image-generator 的导入。
   */
  generate?: typeof smartGenerate;
}

const DEFAULT_VARIANT_COUNT = 1;
const MAX_VARIANT_COUNT = 5;

// 存储层：默认 SQLite（bun:sqlite 零依赖），可降级为内存
// 用 legacy map 适配器保持现有 API 调用方不变
let _storageReady: Promise<unknown> | null = null;
let _store: ReturnType<typeof asLegacyMap> | null = null;

function getStore() {
  if (!_store) {
    _storageReady = createStorage().then(async (s) => {
      const store = asLegacyMap(s);
      await store.ready;
      _store = store;
    });
  }
  return _storageReady ?? Promise.resolve();
}

/** 等待 storage 就绪（在异步入口调一次即可） */
export async function ensureStorageReady(): Promise<void> {
  await getStore();
}

export function resolveApiKey(env = process.env): string {
  const k =
    env.MINIMAX_CN_API_KEY ??
    env.MINIMAX_API_KEY ??
    env.MINIMAX_KEY ??
    '';
  if (k) return k;
  // 回退：~/.clawdao/auth.json（ClawDao 桌面端存储的 provider key）
  try {
    const p = join(homedir(), '.clawdao', 'auth.json');
    if (existsSync(p)) {
      const auth = JSON.parse(readFileSync(p, 'utf8'));
      const m =
        auth['minimax-cn']?.key ??
        auth['minimax(cn)']?.key ??
        auth.minimax?.key ??
        '';
      if (m) return m;
    }
  } catch {
    /* ignore */
  }
  return '';
}

export async function listAll(): Promise<Task[]> {
  await ensureStorageReady();
  return _store!.listAll() as Task[];
}

export async function get(id: string): Promise<Task | undefined> {
  await ensureStorageReady();
  return _store!.get(id) as Task | undefined;
}

export async function remove(id: string): Promise<boolean> {
  await ensureStorageReady();
  return _store!.delete(id);
}

export async function cancel(id: string): Promise<boolean> {
  await ensureStorageReady();
  const t = _store!.get(id) as Task | undefined;
  if (!t) return false;
  if (t.status !== 'completed' && t.status !== 'failed') {
    t.status = 'failed';
    t.error = 'cancelled';
    t.completedAt = new Date().toISOString();
    _store!.set(t.id, t as unknown as StorageTask);
    return true;
  }
  return false;
}

/** 规范化 variantConfig（夹紧到 1~MAX） */
function normalizeVariantConfig(input: TaskInput): VariantConfig {
  const raw = Math.max(1, Math.min(MAX_VARIANT_COUNT, Math.floor(input.variantCount ?? DEFAULT_VARIANT_COUNT)));
  return {
    count: raw,
    strategy: input.variantStrategy ?? 'parallel',
  };
}

export async function createTask(input: TaskInput, cfg: RuntimeConfig): Promise<string> {
  await ensureStorageReady();
  const id = `tsk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const preset = getPreset(input.category);
  const variantConfig = normalizeVariantConfig(input);
  const task: Task = {
    id,
    userId: 'local',
    category: input.category,
    refImages: input.refImages ?? [],
    theme: input.theme,
    ratio: preset.ratio,
    scene: input.scene as Task['scene'],
    customPrompt: input.customPrompt,
    variantConfig,
    status: 'pending',
    progress: 0,
    createdAt: new Date().toISOString(),
  };
  _store!.set(id, task as unknown as StorageTask);
  // 异步执行，不阻塞响应
  void execute(task, input, cfg).catch((e) => {
    if (task.error === 'cancelled') return;
    task.status = 'failed';
    task.error = (e as Error).message;
    task.completedAt = new Date().toISOString();
    _store!.set(task.id, task as unknown as StorageTask);
    console.error(`[task ${id}]`, e);
  });
  return id;
}

async function execute(task: Task, input: TaskInput, cfg: RuntimeConfig): Promise<void> {
  if (task.error === 'cancelled') return;

  task.status = 'analyzing';
  task.progress = 0.15;
  _store!.set(task.id, task as unknown as StorageTask);

  let dna: VisualDNA | undefined;
  if (input.refImages?.length) {
    try {
      dna = await analyzeImages(input.refImages, {
        apiKey: cfg.apiKey,
        baseUrl: cfg.llmBaseUrl ?? 'https://api.minimaxi.com/anthropic',
        model: 'MiniMax-M3',
      });
    } catch (e) {
      console.warn('[task] 多模态分析失败，跳过 DNA：', (e as Error).message);
    }
  }
  if (task.error === 'cancelled') return;

  task.progress = 0.4;
  task.status = 'generating';
  _store!.set(task.id, task as unknown as StorageTask);

  // —— v0.2: A/B 变体（一次 HTTP 请求返回 N 张，30~60s 出齐）——
  const count = task.variantConfig?.count ?? 1;
  const preset = getPreset(input.category);
  mkdirSync(cfg.outputDir, {recursive: true});
  const ts = Date.now();
  const prefix = cfg.urlPrefix ?? '/outputs/';

  const generateFn = cfg.generate ?? smartGenerate;
  const result = await generateFn({
    category: input.category,
    theme: input.theme,
    aspectRatio: preset.ratio,
    refImages: input.refImages,
    customPrompt: input.customPrompt,
    scene: input.scene,
    brandContext: {
      colorTone: input.colorTone ?? 'blue_purple',
      useLobster: input.useLobster ?? true,
    },
    dna,
    variantCount: count,                            // v0.2: 一次 N 张
    config: {
      apiKey: cfg.apiKey,
      baseUrl: cfg.imageBaseUrl ?? 'https://api.minimaxi.com',
      outputDir: cfg.outputDir,
    },
  });

  if (task.error === 'cancelled') return;

  const b64List = result.base64 ?? [];
  if (b64List.length === 0) {
    throw new Error('image-01 返回空图像列表');
  }

  // 落盘：每张变体独立命名 <category>_<ts>_<i>.jpeg
  // 流水线：AI 纯背景 → 裁到 preset 目标尺寸 + 贴 IP 资产 → 本地叠字
  const brandDir = cfg.brandAssetDir ?? defaultBrandAssetDir();
  const ipAssetPath =
    (input.useLobster ?? true) ? resolveBrandAsset(brandDir, 'lobster-cutout.png') : null;
  const variants: Array<{url: string; width: number; height: number; bytes: number}> = [];
  for (let i = 0; i < b64List.length; i++) {
    const name = `${input.category}_${ts}_${i}.jpeg`;
    const absPath = join(cfg.outputDir, name);
    const raw = Buffer.from(b64List[i], 'base64');
    const composed = await composeBanner(raw, {
      width: preset.size.w,
      height: preset.size.h,
      ipAssetPath,
      colorTone: input.colorTone ?? 'blue_purple',
    });
    const rendered = cfg.textOverlay === false
      ? {buffer: composed.buffer, width: composed.width, height: composed.height}
      : await applyTextOverlay(composed.buffer, {
          category: input.category,
          theme: input.theme,
          colorTone: input.colorTone ?? 'blue_purple',
        });
    writeFileSync(absPath, rendered.buffer);
    variants.push({
      url: `${prefix}${name}`,
      width: rendered.width,
      height: rendered.height,
      bytes: rendered.buffer.length,
    });
  }

  task.progress = 1;
  task.status = 'completed';
  task.completedAt = new Date().toISOString();
  task.result = {
    imageUrl: variants[0].url,           // 兼容老 API（始终指向第一张）
    thumbUrl: variants[0].url,
    variants,                            // v0.2 新字段
    params: {
      category: input.category,
      dna,
      theme: input.theme,
      variantCount: count,
      variantSuccess: variants.length,
    },
  };
  _store!.set(task.id, task as unknown as StorageTask);
}

export function defaultOutputDir(): string {
  return resolve(process.cwd(), 'outputs');
}
