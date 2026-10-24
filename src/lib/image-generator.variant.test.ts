/**
 * image-generator.variant.test.ts — v0.2 A/B 变体相关测试
 */
import { describe, it, expect } from 'bun:test';
import { generateImage, smartGenerate } from './image-generator';

/** 真实的最小 JPEG base64（2x2 蓝色），用于让内容校验真正生效。 */
const JPEG_BASE64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAj/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCewFIh3//Z';

/** 轻量 fetch 桩：记录调用参数，替代 vitest 的 vi.fn()。 */
function makeFetchMock(handler: () => Response | Promise<Response>) {
  const calls: Array<[string, any]> = [];
  const fn = (async (url: any, init?: any) => {
    calls.push([String(url), init]);
    return handler();
  }) as any;
  fn.calls = calls;
  return fn;
}

describe('v0.2 variant generation (image-generator)', () => {
  it('forwards n to image_generation payload', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({
          data: { image_base64: [JPEG_BASE64, JPEG_BASE64, JPEG_BASE64] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await generateImage(
      { prompt: 'p', n: 3 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    expect(result.images).toHaveLength(3);
    const body = JSON.parse(fetchMock.calls[0][1].body);
    expect(body.n).toBe(3);
  });

  it('clamps n above MAX_N=5 to 5', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: [JPEG_BASE64, JPEG_BASE64, JPEG_BASE64, JPEG_BASE64, JPEG_BASE64] } }),
        { status: 200 }
      )
    );
    await generateImage(
      { prompt: 'p', n: 99 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    const body = JSON.parse(fetchMock.calls[0][1].body);
    expect(body.n).toBe(5);
  });

  it('clamps n below 1 to 1', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: [JPEG_BASE64] } }),
        { status: 200 }
      )
    );
    await generateImage(
      { prompt: 'p', n: 0 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    const body = JSON.parse(fetchMock.calls[0][1].body);
    expect(body.n).toBe(1);
  });

  it('smartGenerate passes variantCount to n', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: [JPEG_BASE64, JPEG_BASE64] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      variantCount: 2,
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse(fetchMock.calls[0][1].body);
    expect(body.n).toBe(2);
  });

  it('smartGenerate defaults variantCount to 1', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: [JPEG_BASE64] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse(fetchMock.calls[0][1].body);
    expect(body.n).toBe(1);
  });

  it('throws on empty image_base64 array', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: [] } }),
        { status: 200 }
      )
    );
    await expect(
      generateImage(
        { prompt: 'p', retries: 0 },
        { apiKey: 'k', fetchImpl: fetchMock as any }
      )
    ).rejects.toThrow(/空图像/);
  });
});

describe('回归：坏图不再被静默写入 outputs/', () => {
  it('拿到 URL 而非 base64 时直接抛错（而不是写出 0~3 字节空壳）', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(
        JSON.stringify({ data: { image_url: ['https://example.com/a.jpeg'] } }),
        { status: 200 }
      )
    );
    await expect(
      generateImage(
        { prompt: 'p', retries: 0 },
        { apiKey: 'k', fetchImpl: fetchMock as any }
      )
    ).rejects.toThrow(/不是有效 base64/);
  });

  it('短占位符（如 "8"）同样被拒绝', async () => {
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ data: { image_base64: ['8'] } }), { status: 200 })
    );
    await expect(
      generateImage(
        { prompt: 'p', retries: 0 },
        { apiKey: 'k', fetchImpl: fetchMock as any }
      )
    ).rejects.toThrow(/不是有效 base64/);
  });

  it('generateImage 不再自行落盘（写盘是 task-manager 的职责）', async () => {
    const { readdirSync } = await import('node:fs');
    const outDir = './outputs';
    const before = readdirSync(outDir).filter((n) => n.startsWith('cover_')).length;
    const fetchMock = makeFetchMock(async () =>
      new Response(JSON.stringify({ data: { image_base64: [JPEG_BASE64] } }), { status: 200 })
    );
    await generateImage(
      { prompt: 'p', retries: 0 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    const after = readdirSync(outDir).filter((n) => n.startsWith('cover_')).length;
    expect(after).toBe(before);
  });
});
