#!/usr/bin/env bun
/**
 * scripts/start-all.ts — ClawDao 应用多进程启动器
 *
 * 读取 .clawdao/project.json，按 ports 启动：
 *   - 后端 Bun 服务（src/index.ts @ ports.dev，带 --env-file=.env 加载真实 API Key）
 *   - 前端 Vite dev server（web/ @ ports.web，/api 代理到 dev 端口）
 *
 * ClawDao「应用」页通过 runProject() 调用：bun run scripts/start-all.ts
 * 生命周期：起后端 → 起前端 → 输出访问地址 → SIGTERM/SIGINT 优雅退出
 */

import {spawn} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const cwd = process.cwd();
const cfgPath = resolve(cwd, '.clawdao/project.json');
const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) : {};
const ports = cfg.ports ?? {};
const webPort = ports.web ?? 5182;
const devPort = ports.dev ?? 18795;

const appName = cfg.description ? 'ClawDao 图像工厂' : 'clawdao app';
console.log(`[start-all] ${appName} 启动 — web:${webPort} api:${devPort}`);

const children: ReturnType<typeof spawn>[] = [];

function run(name: string, cmd: string, args: string[], env: Record<string, string> = {}, childCwd: string = cwd) {
  console.log(`[start-all] 启动 ${name}: ${cmd} ${args.join(' ')}`);
  const child = spawn(cmd, args, {
    cwd: childCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {...process.env, ...env},
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  child.on('exit', (code) => {
    console.log(`[start-all] ${name} 退出 code=${code}`);
    shutdown();
  });
  children.push(child);
  return child;
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[start-all] 正在关闭全部子进程…');
  for (const c of children) c.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500).unref?.();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// 1) 后端 Bun 服务 —— 用 --env-file 让 Bun 加载 .env（包含真实 API Key）
const envFile = existsSync(resolve(cwd, '.env')) ? '.env' : '';
const apiArgs = envFile
  ? ['run', `--env-file=${envFile}`, 'src/index.ts', '--port', String(devPort)]
  : ['run', 'src/index.ts', '--port', String(devPort)];
run('api', process.execPath, apiArgs, {PORT: String(devPort)});

// 2) 前端 Vite（web/ 目录需存在）—— 必须显式指定 cwd，否则 alias/入口都错位
const webDir = resolve(cwd, 'web');
if (existsSync(resolve(webDir, 'package.json'))) {
  run(
    'web',
    process.execPath,
    ['x', 'vite', '--host', '--port', String(webPort), '--strictPort'],
    {VITE_API_TARGET: `http://localhost:${devPort}`},
    webDir, // ← 修复 #1：vite 必须在 web/ 子目录运行
  );
} else {
  console.warn('[start-all] 未找到 web/ 目录，仅启动 API');
}

// 打印访问地址（runProject 通过 stdout 解析）
setTimeout(() => {
  console.log(`[start-all] 就绪 → Web: http://localhost:${webPort}  API: http://localhost:${devPort}/api/health`);
}, 2500);
