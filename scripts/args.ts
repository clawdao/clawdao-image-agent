/**
 * args.ts — scripts/ 目录共用的极简命令行参数解析
 *
 * 位置参数与 --flag 混用时最容易出歧义（例如"副标题"和"变体数"都占第 2 位），
 * 所以这里统一支持：
 *   位置参数：按约定顺序取
 *   --key value / --key=value：具名选项
 */

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string> = {};

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const body = arg.slice(2);
    const eq = body.indexOf('=');
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[body] = next;
      index += 1;
    } else {
      flags[body] = 'true';
    }
  }

  return { positional, flags };
}

/** 从 flags / 位置参数里取一个正整数（1~max），取不到用 fallback */
export function pickCount(
  flags: Record<string, string>,
  positional: string[],
  key: string,
  max: number,
  fallback: number,
): number {
  const raw = flags[key] ?? positional.find((value) => /^\d+$/.test(value));
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(parsed)));
}
