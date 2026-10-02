import { describe, it, expect, vi } from 'vitest';
import { generateImage, smartGenerate } from './image-generator';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLzxQAAAABJRU5ErkJggg==';

describe('generateImage', () => {
  it('sends correct payload to MiniMax image_generation', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: { image_base64: ['AAAA'] },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      )
    );

    const result = await generateImage(
      {
        prompt: 'test prompt',
        aspectRatio: '9:16',
        n: 1,
      },
      {
        apiKey: 'test-key',
        fetchImpl: fetchMock as any,
      }
    );

    expect(result.images).toEqual(['AAAA']);
    expect(result.format).toBe('base64');

    const [url, init] = (fetchMock as any).mock.calls[0];
    expect(url).toBe('https://api.minimaxi.com/v1/image_generation');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('image-01');
    expect(body.aspect_ratio).toBe('9:16');
    expect(body.prompt).toBe('test prompt');
  });

  it('retries 3 times on failure then throws', async () => {
    const fetchMock = vi.fn(async () => {
      return new Response('fail', { status: 500 });
    });
    await expect(
      generateImage(
        { prompt: 'x', retries: 2 },  // retries 在 options 不在 config
        { apiKey: 'k', fetchImpl: fetchMock as any }
      )
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('retries succeed on second try', async () => {
    let count = 0;
    const fetchMock = vi.fn(async () => {
      count++;
      if (count < 2) return new Response('fail', { status: 500 });
      return new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      );
    });
    const result = await generateImage(
      { prompt: 'x', retries: 3 },
      { apiKey: 'k', fetchImpl: fetchMock as any }
    );
    expect(result.images).toEqual(['OK']);
  });

  it('does not retry fatal image URL business errors', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: null,
          base_resp: {
            status_code: 1000,
            status_msg: 'disallowed image url: localhost or private address not allowed',
          },
        }),
        { status: 200 }
      )
    );

    await expect(
      generateImage(
        { prompt: 'x', retries: 3 },
        { apiKey: 'k', fetchImpl: fetchMock as any }
      )
    ).rejects.toThrow(/disallowed image url/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('smartGenerate', () => {
  it('uses template by category', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate(
      {
        category: 'cover',
        theme: { title: 'TITLE' },
        config: { apiKey: 'k', fetchImpl: fetchMock as any },
      }
    );
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.prompt).not.toContain('TITLE');
    expect(body.prompt).toContain('文字安全区');
  });

  it('detects PNG legacy base64 and uses the correct Data URL MIME type', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      refImages: [PNG_BASE64],
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.subject_reference[0].image_file).toBe(`data:image/png;base64,${PNG_BASE64}`);
  });

  it('preserves a public HTTPS reference URL', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    const url = 'https://cdn.example.com/reference.png';
    await smartGenerate({
      category: 'cover',
      theme: { title: 'T' },
      refImages: [url],
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.subject_reference[0].image_file).toBe(url);
  });

  it('rejects localhost reference URLs before calling MiniMax', async () => {
    const fetchMock = vi.fn();
    await expect(
      smartGenerate({
        category: 'cover',
        theme: { title: 'T' },
        refImages: ['http://localhost:3000/reference.png'],
        config: { apiKey: 'k', fetchImpl: fetchMock as any },
      })
    ).rejects.toThrow(/localhost|私网/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps generated prompts below the MiniMax 1500 character limit', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'cover',
      theme: {
        title: '中秋大礼盒 · 限时送',
        subtitle: '加赠 3 份智能体 · 价值 15940',
        tags: ['限时 3 天', '价值 15940', '进直播间领取'],
      },
      dna: {
        palette: ['#667eea', '#764ba2', '#ffd700'],
        composition: '中心对称构图，上方标题，中间主视觉，底部留白',
        lighting: '暖金色柔光从右上方照射，高光集中在主体',
        textures: ['金属', '磨砂', '玻璃'],
        typography: '金色书法标题搭配白色无衬线副标题',
        mood: '高端节庆',
        design_patterns: ['光晕', '星点', '金色描边'],
        ip_visibility: { lobster_mascot: true, logo: false },
        key_elements: ['礼盒', '龙虾吉祥物', '限时标签'],
      },
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.prompt.length).toBeLessThan(1500);
    expect(body.prompt).not.toContain('中秋大礼盒');
    expect(body.prompt).toContain('所有文案均由后期本地排版层精确叠加');
  });

  it('truncates an overlong custom prompt before calling MiniMax', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'custom',
      theme: { title: 'T' },
      customPrompt: '超长提示词'.repeat(500),
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.prompt.length).toBeLessThan(1500);
    expect(body.prompt).toContain('自动压缩');
  });

  it('overrides holiday DNA with a National Day red-gold background', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'custom',
      theme: {
        title: '国庆节快乐',
        subtitle: '亿检链 · 2026年10月1日',
        tags: ['国庆', '商务'],
      },
      scene: 'holiday',
      dna: {
        palette: ['#1E90FF', '#FFFFFF'],
        composition: '白底卡片和二维码',
        lighting: '冷蓝科技光',
        textures: ['磨砂'],
        typography: '现代黑体',
        mood: '科技商务',
        design_patterns: ['二维码'],
        ip_visibility: { lobster_mascot: false, logo: false },
        key_elements: ['蓝色背景', '二维码', '中秋月亮'],
      },
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.prompt).toContain('节庆主题覆盖（最高优先级');
    expect(body.prompt).toContain('中国红');
    expect(body.prompt).toContain('绽放烟花');
    expect(body.prompt).not.toContain('#1E90FF');
    expect(body.prompt).not.toContain('蓝色背景');
    expect(body.prompt).not.toContain('中秋月亮');
    expect(body.prompt.length).toBeLessThan(1500);
  });

  it('injects a text-free product-launch scene without asking for labels', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'custom',
      theme: { title: 'T' },
      scene: 'product_launch',
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.prompt).toContain('纯色无字发光立方体');
    expect(body.prompt).not.toContain('NEW');
    expect(body.prompt).not.toContain('产品名');
    expect(body.prompt).toContain('屏幕关闭或显示纯色');
  });

  it('uses the custom preset aspect ratio instead of the cover template ratio', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ data: { image_base64: ['OK'] } }),
        { status: 200 }
      )
    );
    await smartGenerate({
      category: 'custom',
      theme: { title: 'T' },
      config: { apiKey: 'k', fetchImpl: fetchMock as any },
    });
    const body = JSON.parse((fetchMock as any).mock.calls[0][1].body);
    expect(body.aspect_ratio).toBe('16:9');
  });
});
