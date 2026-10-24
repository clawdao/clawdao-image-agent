/**
 * poster-api.ts — 「海报工作室」后端
 *
 * 迁移自 ddn-hub 的 admin/src/modules/poster（Fabric 编辑器内核）+ 本项目的
 * MiniMax 图像/文本能力，合成一套「文生图 / 图生图 → 可视化编辑 → 导出」的链路。
 *
 * 路由：
 *   POST   /api/poster/generate   文生图 / 图生图（image-01），落盘到 outputs/poster/studio/
 *   POST   /api/poster/ai-ops     自然语言指令 → 受控 PosterOperation[]（LLM + 校验闸门）
 *   POST   /api/poster/save       保存草稿（Fabric JSON）到 outputs/poster/drafts/
 *   GET    /api/poster/drafts     草稿列表
 *   GET    /api/poster/draft      读取草稿（?id=）
 *   DELETE /api/poster/draft      删除草稿（?id=）
 *
 * 与 ddn-hub 的差别：
 *   1. 不依赖 egg / MySQL / 登录态 —— 草稿就是本地 JSON 文件；
 *   2. AI 指令是真的 LLM（ddn-hub 那边是随机 mock）；
 *   3. 图像生成走本项目统一的 image-generator（同一套 key、同一套比例快照逻辑）。
 */

import {mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync, unlinkSync} from 'node:fs';
import {join, resolve, sep} from 'node:path';

import {generateImage, TEXT_FREE_CONSTRAINT, type AspectRatio} from '../lib/image-generator';
import {normalizeImageReference} from '../lib/image-source';
import {chat} from '../lib/llm-gateway';
import {
  buildOpsUserPrompt,
  parseAndValidateOps,
  OPS_SYSTEM_PROMPT,
  type PosterDesignLike,
} from '../lib/poster-ops';

export interface PosterApiConfig {
  apiKey: string;
  imageBaseUrl?: string;
  llmBaseUrl?: string;
  outputDir: string;
  urlPrefix?: string;
}

const STUDIO_DIR = 'poster/studio';
const DRAFT_DIR = 'poster/drafts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*'},
  });
}

function readBody(req: Request): Promise<Record<string, unknown>> {
  return req
    .json()
    .then((v) => (v ?? {}) as Record<string, unknown>)
    .catch(() => ({}));
}

function isInside(root: string, target: string): boolean {
  const normalizedRoot = root.endsWith(sep) ? root : root + sep;
  return target === root || target.startsWith(normalizedRoot);
}

/**
 * 从图片字节头读真实尺寸。
 *
 * 注意：MiniMax image-01 返回的 base64 常常是 **JPEG**（不是 PNG），
 * 所以这里同时支持 PNG / JPEG / WebP，并返回真实扩展名 ——
 * 否则会出现「.png 文件里其实是 JPEG」的错配。
 */
export function readImageInfo(bytes: Buffer): {
  width?: number;
  height?: number;
  ext: 'png' | 'jpg' | 'webp';
} {
  if (bytes.length < 16) return {ext: 'png'};

  // PNG: 89 50 4E 47
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return {
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
      ext: 'png',
    };
  }

  // JPEG: FF D8 ... 扫 SOFn 段
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      // 填充字节
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const length = bytes.readUInt16BE(offset + 2);
      const isSof =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isSof) {
        return {
          width: bytes.readUInt16BE(offset + 7),
          height: bytes.readUInt16BE(offset + 5),
          ext: 'jpg',
        };
      }
      offset += 2 + length;
    }
    return {ext: 'jpg'};
  }

  // WebP: RIFF....WEBP
  if (
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return {ext: 'webp'};
  }

  return {ext: 'png'};
}

/* ------------------------------------------------------------------ */
/* 文生图 / 图生图                                                       */
/* ------------------------------------------------------------------ */

export interface PosterGenerateInput {
  prompt: string;
  aspectRatio?: AspectRatio;
  n?: number;
  /** 参考图（data: URL 或 http(s) URL）—— 有图走图生图 */
  refImages?: string[];
  /** 是否禁止画面出现文字（默认 true：文字一律本地排版层叠加） */
  noText?: boolean;
}

export async function generatePosterImages(
  input: PosterGenerateInput,
  cfg: PosterApiConfig,
): Promise<{
  images: Array<{url: string; file: string; width?: number; height?: number; bytes: number}>;
  aspectRatio: string;
  mode: 't2i' | 'i2i';
}> {
  const prompt = String(input.prompt ?? '').trim();
  if (!prompt) throw new Error('提示词不能为空');
  if (!cfg.apiKey) throw new Error('未配置 MiniMax API Key');

  const refs = (input.refImages ?? []).filter(Boolean);
  const mode: 't2i' | 'i2i' = refs.length > 0 ? 'i2i' : 't2i';

  const n = Math.max(1, Math.min(4, Math.floor(input.n ?? 1)));
  const aspectRatio = (input.aspectRatio ?? '9:16') as AspectRatio;

  const finalPrompt = input.noText === false ? prompt : `${prompt}\n${TEXT_FREE_CONSTRAINT}`;

  const subjectReference = refs.length
    ? await Promise.all(
        refs.slice(0, 3).map(async (ref) => ({
          type: 'object' as const,
          imageFile: await normalizeImageReference(ref),
        })),
      )
    : undefined;

  const result = await generateImage(
    {
      prompt: finalPrompt,
      aspectRatio,
      n,
      responseFormat: 'base64',
      ...(subjectReference ? {subjectReference} : {}),
    },
    {apiKey: cfg.apiKey, baseUrl: cfg.imageBaseUrl ?? 'https://api.minimaxi.com'},
  );

  const dir = join(cfg.outputDir, STUDIO_DIR);
  mkdirSync(dir, {recursive: true});

  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const prefix = cfg.urlPrefix ?? '/outputs/';

  const images = (result.base64 ?? result.images).map((b64, index) => {
    const bytes = Buffer.from(b64, 'base64');
    const info = readImageInfo(bytes);
    const fileName = `${stamp}-${index + 1}.${info.ext}`;
    const abs = join(dir, fileName);
    writeFileSync(abs, bytes);
    return {
      url: `${prefix}${STUDIO_DIR}/${fileName}`,
      file: abs,
      width: info.width,
      height: info.height,
      bytes: bytes.length,
    };
  });

  return {images, aspectRatio, mode};
}

/* ------------------------------------------------------------------ */
/* AI 指令 → 受控操作                                                   */
/* ------------------------------------------------------------------ */

export async function runAiOps(
  design: PosterDesignLike,
  instruction: string,
  cfg: PosterApiConfig,
): Promise<{
  operations: unknown[];
  explanation?: string;
  suggestions: string[];
  rejected: string[];
}> {
  const text = String(instruction ?? '').trim();
  if (!text) throw new Error('指令不能为空');
  if (!cfg.apiKey) throw new Error('未配置 MiniMax API Key');

  const res = await chat(
    [
      {role: 'system', content: OPS_SYSTEM_PROMPT},
      {role: 'user', content: buildOpsUserPrompt(design, text)},
    ],
    {
      apiKey: cfg.apiKey,
      baseUrl: cfg.llmBaseUrl,
      model: 'MiniMax-M3',
      temperature: 0.2,
      maxTokens: 2048,
    },
  );

  const objects = design?.fabricJson?.objects ?? [];
  const objectIds = new Set(objects.map((o: any) => String(o?.id ?? '')).filter(Boolean));

  const parsed = parseAndValidateOps(res.content, {
    canvas: design?.canvas,
    objectIds,
  });

  return {
    operations: parsed.operations,
    explanation: parsed.explanation,
    suggestions: parsed.suggestions ?? [],
    rejected: parsed.rejected,
  };
}

/* ------------------------------------------------------------------ */
/* 草稿读写                                                            */
/* ------------------------------------------------------------------ */

function draftDir(cfg: PosterApiConfig): string {
  return join(cfg.outputDir, DRAFT_DIR);
}

function safeDraftPath(cfg: PosterApiConfig, id: string): string | null {
  const clean = String(id ?? '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!clean) return null;
  const abs = resolve(draftDir(cfg), `${clean}.json`);
  if (!isInside(resolve(draftDir(cfg)), abs)) return null;
  return abs;
}

export function savePosterDraft(
  design: unknown,
  name: string,
  cfg: PosterApiConfig,
): {id: string; url: string; updatedAt: string} {
  const dir = draftDir(cfg);
  mkdirSync(dir, {recursive: true});
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const id = `draft-${stamp}`;
  const payload = {
    id,
    name: name || '未命名海报',
    updatedAt: new Date().toISOString(),
    design,
  };
  const abs = join(dir, `${id}.json`);
  writeFileSync(abs, JSON.stringify(payload, null, 2));
  return {id, url: `${cfg.urlPrefix ?? '/outputs/'}${DRAFT_DIR}/${id}.json`, updatedAt: payload.updatedAt};
}

export function listPosterDrafts(cfg: PosterApiConfig): Array<{
  id: string;
  name: string;
  updatedAt: string;
  bytes: number;
}> {
  const dir = draftDir(cfg);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const abs = join(dir, f);
      try {
        const raw = JSON.parse(readFileSync(abs, 'utf8'));
        return {
          id: String(raw.id ?? f.replace(/\.json$/, '')),
          name: String(raw.name ?? '未命名海报'),
          updatedAt: String(raw.updatedAt ?? ''),
          bytes: statSync(abs).size,
        };
      } catch {
        return {id: f.replace(/\.json$/, ''), name: '损坏草稿', updatedAt: '', bytes: 0};
      }
    })
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function readPosterDraft(id: string, cfg: PosterApiConfig): unknown | null {
  const abs = safeDraftPath(cfg, id);
  if (!abs || !existsSync(abs)) return null;
  try {
    return JSON.parse(readFileSync(abs, 'utf8'));
  } catch {
    return null;
  }
}

export function deletePosterDraft(id: string, cfg: PosterApiConfig): boolean {
  const abs = safeDraftPath(cfg, id);
  if (!abs || !existsSync(abs)) return false;
  unlinkSync(abs);
  return true;
}

/* ------------------------------------------------------------------ */
/* 路由分发                                                            */
/* ------------------------------------------------------------------ */

export async function handlePosterRoutes(
  req: Request,
  url: URL,
  cfg: PosterApiConfig,
): Promise<Response | null> {
  const {pathname} = url;
  const method = req.method.toUpperCase();

  if (!pathname.startsWith('/api/poster/')) return null;

  try {
    if (pathname === '/api/poster/generate' && method === 'POST') {
      const body = await readBody(req);
      const out = await generatePosterImages(
        {
          prompt: String(body.prompt ?? ''),
          aspectRatio: body.aspectRatio as AspectRatio | undefined,
          n: typeof body.n === 'number' ? body.n : 1,
          refImages: Array.isArray(body.refImages)
            ? (body.refImages as string[]).filter((s) => typeof s === 'string' && s.length > 0)
            : [],
          noText: body.noText === false ? false : true,
        },
        cfg,
      );
      return json({code: 0, data: out});
    }

    if (pathname === '/api/poster/ai-ops' && method === 'POST') {
      const body = await readBody(req);
      const design = (body.design ?? {}) as PosterDesignLike;
      const instruction = String(body.instruction ?? '');
      const out = await runAiOps(design, instruction, cfg);
      return json({code: 0, data: out});
    }

    if (pathname === '/api/poster/save' && method === 'POST') {
      const body = await readBody(req);
      const out = savePosterDraft(body.design, String(body.name ?? ''), cfg);
      return json({code: 0, data: out});
    }

    if (pathname === '/api/poster/drafts' && method === 'GET') {
      return json({code: 0, data: listPosterDrafts(cfg)});
    }

    if (pathname === '/api/poster/draft' && method === 'GET') {
      const id = url.searchParams.get('id') ?? '';
      const draft = readPosterDraft(id, cfg);
      if (!draft) return json({code: 404, msg: 'draft not found'}, 404);
      return json({code: 0, data: draft});
    }

    if (pathname === '/api/poster/draft' && method === 'DELETE') {
      const id = url.searchParams.get('id') ?? '';
      return json({code: 0, data: {deleted: deletePosterDraft(id, cfg)}});
    }
  } catch (e) {
    return json({code: 500, msg: (e as Error).message}, 500);
  }

  return json({code: 404, msg: `poster route not found: ${method} ${pathname}`}, 404);
}
