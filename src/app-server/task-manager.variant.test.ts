/**
 * task-manager.variant.test.ts — v0.2 A/B 变体单测
 *
 * 通过 RuntimeConfig.generate 依赖注入替换 smartGenerate，按 variantCount 返回 N 张假图。
 * 不用 mock.module：它是进程级全局替换，会污染同进程其它测试文件。
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.USE_MEMORY_STORE = '1';
const tmpOut = mkdtempSync(join(tmpdir(), 'clawdao-test-'));

/** 真实最小 JPEG base64（2x2），让写盘路径写出的是真图而非空壳 */
const JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z';

/** fake 图像生成器：按 variantCount 返回 N 张假图（依赖注入，不走 mock.module） */
let smartGenerateImpl: (opts: any) => Promise<any> = async (opts: any) => {
  const n = opts.variantCount ?? 1;
  return {
    images: Array.from({length: n}, () => JPEG_BASE64),
    base64: Array.from({length: n}, () => JPEG_BASE64),
    format: 'base64' as const,
  };
};

/** 注入给 task-manager 的 generate 实现 */
const fakeGenerate = ((opts: any) => smartGenerateImpl(opts)) as any;

let createTask: typeof import('./task-manager').createTask;
let get: typeof import('./task-manager').get;
let resetStorage: typeof import('../lib/storage').resetStorage;

beforeAll(async () => {
  const storage = await import('../lib/storage');
  resetStorage = storage.resetStorage;
  resetStorage();
  const tm = await import('./task-manager');
  createTask = tm.createTask;
  get = tm.get;
});

afterAll(() => {
  resetStorage();
  rmSync(tmpOut, {recursive: true, force: true});
});

describe('v0.2 A/B 变体批量生成（task-manager）', () => {
  it('variantCount 缺省 → 1 张（向后兼容）', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'A'}} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.status).toBe('completed');
    expect(t?.result?.variants).toHaveLength(1);
    expect(t?.result?.imageUrl).toBe(t?.result?.variants?.[0].url);
  });

  it('variantCount=3 → 3 张 + 一次 HTTP 语义', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'B'}, variantCount: 3} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.status).toBe('completed');
    expect(t?.result?.variants).toHaveLength(3);
    expect(t?.result?.imageUrl).toBe(t?.result?.variants?.[0].url);
    const written = readdirSync(tmpOut).filter(f => f.startsWith('cover_'));
    expect(written.length).toBeGreaterThanOrEqual(3);
    // 回归：每张写出的图都必须是真实图像字节（曾经出现 0~3 字节空壳）
    const { statSync } = await import('node:fs');
    for (const name of written) {
      expect(statSync(join(tmpOut, name)).size).toBeGreaterThan(64);
    }
  });

  it('variantCount=99 夹紧到 5', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'C'}, variantCount: 99} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.result?.variants).toHaveLength(5);
  });

  it('variantCount=0 夹紧到 1', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'D'}, variantCount: 0} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.result?.variants).toHaveLength(1);
  });

  it('task.variantConfig 持久化到存储', async () => {
    const id = await createTask(
      {category: 'top_banner', theme: {title: 'E'}, variantCount: 4} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.variantConfig?.count).toBe(4);
    expect(t?.variantConfig?.strategy).toBe('parallel');
  });

  it('smartGenerate 抛错时 status=failed、error 含原因', async () => {
    // 先把所有 smartGenerate 调成抛错（覆盖整个任务生命周期）
    const original = smartGenerateImpl;
    smartGenerateImpl = async () => {
      throw new Error('synthetic api failure');
    };
    try {
      const id = await createTask(
        {category: 'cover', theme: {title: 'F'}} as any,
        {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false, generate: fakeGenerate} as any
      );
      await waitForComplete(id);
      const t = await get(id);
      expect(t?.status).toBe('failed');
      expect(t?.error).toContain('synthetic api failure');
    } finally {
      smartGenerateImpl = original;
    }
  });
});

async function waitForComplete(id: string) {
  for (let i = 0; i < 50; i++) {
    const t = await get(id);
    if (t?.status === 'completed' || t?.status === 'failed') return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`task ${id} did not complete in 5s`);
}
