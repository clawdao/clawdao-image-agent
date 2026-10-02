#!/usr/bin/env bun
/**
 * src/index.ts — ClawDao 图像工厂 Bun 后端（零 npm 依赖）
 *
 * ClawDao「应用」运行入口（protocol.lifecycle.start = bun run dev → scripts/start-all.ts → 本文件）
 * 提供：
 *   GET  /api/health
 *   POST /api/task/create
 *   GET  /api/task/list
 *   GET  /api/task/:id
 *   POST /api/task/:id/cancel
 *   DELETE /api/task/:id
 *   GET  /outputs/*          生成图静态访问
 *   GET  /*                  若存在 web/dist 则托管前端（单端口部署）
 */

import {existsSync} from 'node:fs';
import {join, extname} from 'node:path';
import {resolve} from 'node:path';
import {resolveApiKey, createTask, get, listAll, cancel, remove, defaultOutputDir, RuntimeConfig} from './app-server/task-manager';

const argPort = process.argv.indexOf('--port');
const PORT = Number(
  argPort >= 0 ? process.argv[argPort + 1] : (process.env.PORT ?? 18795)
);

const WEB_DIST = resolve(process.cwd(), 'web', 'dist');
const OUTPUTS = defaultOutputDir();
const apiKey = resolveApiKey();
if (!apiKey) {
  console.warn('[image-factory] ⚠️ 未找到 MiniMax API Key（env MINIMAX_API_KEY / MINIMAX_CN_API_KEY / ~/.clawdao/auth.json）');
}

const cfg: RuntimeConfig = {
  apiKey,
  imageBaseUrl: process.env.MINIMAX_BASE_URL ?? 'https://api.minimaxi.com',
  llmBaseUrl: process.env.MINIMAX_LLM_BASE_URL ?? 'https://api.minimaxi.com/anthropic',
  outputDir: OUTPUTS,
  urlPrefix: '/outputs/',
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webp': 'image/webp',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*'},
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function staticFile(absPath: string): Response | null {
  if (!existsSync(absPath)) return null;
  const ext = extname(absPath).toLowerCase();
  const body = Bun.file(absPath);
  return new Response(body, {headers: {'Content-Type': MIME[ext] ?? 'application/octet-stream'}});
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const {pathname} = url;
    const method = req.method.toUpperCase();

    // CORS
    if (method === 'OPTIONS') {
      return new Response(null, {headers: {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}});
    }

    // ── API ──
    if (pathname === '/api/health') {
      return json({code: 0, data: {status: 'ok', time: new Date().toISOString(), model: 'image-01', keyConfigured: !!cfg.apiKey}});
    }

    if (pathname === '/api/task/create' && method === 'POST') {
      const body = await readBody(req);
      const category = String(body.category ?? '');
      const theme = (body.theme ?? {}) as {title: string};
      if (!category || !theme?.title) {
        return json({code: 400, msg: 'category 与 theme.title 为必填'}, 400);
      }
      try {
        const id = await createTask({
          category: category as never,
          theme,
          refImages: Array.isArray(body.refImages) ? (body.refImages as string[]) : undefined,
          colorTone: body.colorTone as never,
          useLobster: body.useLobster as boolean | undefined,
          customPrompt: body.customPrompt as string | undefined,
          scene: body.scene as string | undefined,
          // v0.2: A/B 变体批量生成（variantCount 1~5，默认 1）
          variantCount: typeof body.variantCount === 'number' ? (body.variantCount as number) : undefined,
          variantStrategy: body.variantStrategy as 'parallel' | 'diverse' | undefined,
        }, cfg);
        return json({code: 0, data: {taskId: id, status: 'pending'}});
      } catch (e) {
        return json({code: 500, msg: (e as Error).message}, 500);
      }
    }

    if (pathname === '/api/task/list' && method === 'GET') {
      return json({code: 0, data: await listAll()});
    }

    const downloadMatch = pathname.match(/^\/api\/task\/([^/]+)\/download$/);
    if (downloadMatch && method === 'GET') {
      const task = await get(downloadMatch[1]);
      if (!task) return json({code: 404, msg: 'task not found'}, 404);
      const requested = Number(url.searchParams.get('variant') ?? 0);
      const variants = task.result?.variants ?? [];
      const index = Number.isInteger(requested) && requested >= 0 ? requested : 0;
      const imageUrl = variants[index]?.url ?? task.result?.imageUrl;
      if (!imageUrl) return json({code: 404, msg: 'image not ready'}, 404);
      const target = /^https?:\/\//.test(imageUrl) ? imageUrl : new URL(imageUrl, req.url).toString();
      return Response.redirect(target, 302);
    }

    const taskMatch = pathname.match(/^\/api\/task\/([^/]+)$/);
    if (taskMatch) {
      const id = taskMatch[1];
      if (method === 'GET') {
        const t = await get(id);
        return t ? json({code: 0, data: t}) : json({code: 404, msg: 'task not found'}, 404);
      }
      if (method === 'DELETE') {
        return json({code: 0, data: {deleted: await remove(id)}});
      }
    }
    const cancelMatch = pathname.match(/^\/api\/task\/([^/]+)\/cancel$/);
    if (cancelMatch && method === 'POST') {
      return json({code: 0, data: {cancelled: await cancel(cancelMatch[1])}});
    }

    // ── outputs 静态 ──
    if (pathname.startsWith('/outputs/')) {
      const rel = pathname.slice('/outputs/'.length);
      const abs = resolve(OUTPUTS, rel);
      if (!abs.startsWith(OUTPUTS)) return json({code: 403, msg: 'forbidden'}, 403);
      return staticFile(abs) ?? json({code: 404, msg: 'file not found'}, 404);
    }

    // ── 前端静态（web/dist 构建产物，单端口部署）──
    if (existsSync(WEB_DIST)) {
      const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
      const abs = resolve(WEB_DIST, rel);
      if (!abs.startsWith(WEB_DIST)) return json({code: 403}, 403);
      const f = staticFile(abs);
      if (f) return f;
      // SPA fallback
      const idx = join(WEB_DIST, 'index.html');
      if (existsSync(idx)) return staticFile(idx)!;
    }

    return json({code: 404, msg: `not found: ${method} ${pathname}（Web 前端请用 vite dev :5182 或先 build:web）`}, 404);
  },
});

console.log(`[image-factory] 🦞 ClawDao 图像工厂 API 就绪 → http://localhost:${PORT}/api/health`);
console.log(`[image-factory] 输出目录: ${OUTPUTS} | key 已配置: ${!!cfg.apiKey}`);
