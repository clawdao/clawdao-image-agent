/**
 * task-manager.variant.test.ts — v0.2 A/B 变体单测
 *
 * 通过 vi.mock 拦截 smartGenerate，按 variantCount 返回 N 张 fake base64。
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.USE_MEMORY_STORE = '1';
const tmpOut = mkdtempSync(join(tmpdir(), 'clawdao-test-'));

// vi.mock 必须在 import 被解析之前生效
vi.mock('../lib/image-generator', () => {
  return {
    smartGenerate: vi.fn(async (opts: any) => {
      const n = opts.variantCount ?? 1;
      return {
        images: Array.from({length: n}, (_, i) => `IMG_${i}`),
        base64: Array.from({length: n}, (_, i) => Buffer.from(`IMG_${i}`).toString('base64')),
        format: 'base64' as const,
      };
    }),
  };
});

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
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
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
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.status).toBe('completed');
    expect(t?.result?.variants).toHaveLength(3);
    expect(t?.result?.imageUrl).toBe(t?.result?.variants?.[0].url);
    const written = readdirSync(tmpOut).filter(f => f.startsWith('cover_'));
    expect(written.length).toBeGreaterThanOrEqual(3);
  });

  it('variantCount=99 夹紧到 5', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'C'}, variantCount: 99} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.result?.variants).toHaveLength(5);
  });

  it('variantCount=0 夹紧到 1', async () => {
    const id = await createTask(
      {category: 'cover', theme: {title: 'D'}, variantCount: 0} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.result?.variants).toHaveLength(1);
  });

  it('task.variantConfig 持久化到存储', async () => {
    const id = await createTask(
      {category: 'top_banner', theme: {title: 'E'}, variantCount: 4} as any,
      {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
    );
    await waitForComplete(id);
    const t = await get(id);
    expect(t?.variantConfig?.count).toBe(4);
    expect(t?.variantConfig?.strategy).toBe('parallel');
  });

  it('smartGenerate 抛错时 status=failed、error 含原因', async () => {
    // 先把所有 smartGenerate 调成抛错（覆盖整个任务生命周期）
    const ig = await import('../lib/image-generator');
    const origMock = (ig.smartGenerate as any).getMockImplementation();
    (ig.smartGenerate as any).mockImplementation(async () => {
      throw new Error('synthetic api failure');
    });
    try {
      const id = await createTask(
        {category: 'cover', theme: {title: 'F'}} as any,
        {apiKey: 'k', outputDir: tmpOut, urlPrefix: '/outputs/', textOverlay: false} as any
      );
      await waitForComplete(id);
      const t = await get(id);
      expect(t?.status).toBe('failed');
      expect(t?.error).toContain('synthetic api failure');
    } finally {
      (ig.smartGenerate as any).mockImplementation(origMock);
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
