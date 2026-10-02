/**
 * image-generator.variant.test.ts — v0.2 A/B 变体相关测试
 */
import { describe, it, expect, vi } from 'vitest';
import { generateImage, smartGenerate } from './image-generator';

describe('v0.2 variant generation (image-generator)', () => {
  it('forwards n to image_generation payload', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { image_base64: ['AAAA', 'BBBB', 'CCCC'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );
    const result = await generateImage(
      { prompt: 'p', n: 3 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    expect(result.images).toHaveLength(3);
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.n).toBe(3);
  });

  it('clamps n above MAX_N=5 to 5', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['x', 'y', 'z', 'a', 'b'] } }),
        { status: 200 }
      )
    );
    await generateImage(
      { prompt: 'p', n: 99 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.n).toBe(5);
  });

  it('clamps n below 1 to 1', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['x'] } }),
        { status: 200 }
      )
    );
    await generateImage(
      { prompt: 'p', n: 0 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.n).toBe(1);
  });

  it('smartGenerate passes variantCount to n', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['a', 'b'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      variantCount: 2,
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.n).toBe(2);
  });

  it('smartGenerate defaults variantCount to 1', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['a'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.n).toBe(1);
  });

  it('throws on empty image_base64 array', async () => {
    const fetchMock = vi.fn(async () =>
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
