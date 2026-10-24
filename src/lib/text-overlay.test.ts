import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { applyTextOverlay, buildTextOverlaySvg } from './text-overlay';

describe('text-overlay', () => {
  it('renders exact Chinese copy into the SVG instead of asking the image model', () => {
    const svg = buildTextOverlaySvg(
      'custom',
      {
        title: '全新 ClawDao 4.0 正式发布',
        subtitle: '自己长出来的企业系统 · 9 月 1 日上线',
        tags: ['全新发布', '限时优惠', '可检测', '可决策', '可执行', '可追溯', '可信任'],
      },
      1280,
      720,
      'black_gold',
    );
    expect(svg).toContain('全新 ClawDao 4.0');
    expect(svg).toContain('正式发布');
    expect(svg).toContain('自己长出来的企业系统 · 9 月 1 日上线');
    expect(svg).toContain('全新发布');
    expect(svg).toContain('可信任');
    expect(svg).toContain('YouSheBiaoTiHei');
  });

  it('renders popup gift cards with exact names and values', () => {
    const svg = buildTextOverlaySvg(
      'popup',
      {
        title: '中秋大礼盒 · 限时送',
        gifts: [
          {name: '公众号选题智能体', value: '2980'},
          {name: '短视频创作智能体', value: '5980'},
        ],
      },
      1024,
      1024,
      'black_gold',
    );
    expect(svg).toContain('中秋大礼盒 · 限时送');
    expect(svg).toContain('公众号选题智能体');
    expect(svg).toContain('¥2980');
    expect(svg).toContain('短视频创作智能体');
  });

  it('keeps the top-banner subtitle below the title glyph area', () => {
    const svg = buildTextOverlaySvg(
      'top_banner',
      {
        title: '国庆节快乐',
        subtitle: '亿检链 · 自己长出来的企业系统',
        tags: ['可检测', '可决策'],
      },
      1344,
      576,
      'black_gold',
    );
    const title = svg.match(/<text\b([^>]*)><tspan[^>]*>国庆节快乐<\/tspan>/);
    const subtitle = svg.match(/<text\b([^>]*)>亿检链 · 自己长出来的企业系统<\/text>/);
    expect(title).not.toBeNull();
    expect(subtitle).not.toBeNull();

    const attr = (attrs: string, name: string) => Number(attrs.match(new RegExp(`${name}="([0-9.]+)"`))?.[1]);
    const titleY = attr(title![1], 'y');
    const titleSize = attr(title![1], 'font-size');
    const subtitleY = attr(subtitle![1], 'y');
    const subtitleSize = attr(subtitle![1], 'font-size');
    const visualGap = subtitleY - subtitleSize * 0.82 - (titleY + titleSize * 0.2);

    expect(visualGap).toBeGreaterThan(8);
  });

  it('composites text onto the image while preserving pixel dimensions', async () => {
    const input = await sharp({
      create: {
        width: 640,
        height: 360,
        channels: 3,
        background: '#101820',
      },
    }).jpeg().toBuffer();
    const result = await applyTextOverlay(input, {
      category: 'custom',
      theme: {title: '真实中文字体', subtitle: '不再出现乱码'},
      colorTone: 'black_gold',
    });
    expect(result.width).toBe(640);
    expect(result.height).toBe(360);
    expect(result.buffer.length).toBeGreaterThan(1000);
    expect(result.buffer.equals(input)).toBe(false);
  });

  it('keeps "ClawDao" intact instead of splitting it into Cla/wDao', () => {
    const svg = buildTextOverlaySvg(
      'top_banner',
      { title: '你出想法，ClawDao帮你实现' },
      1920,
      320,
      'black_gold',
    );
    // 整个标题作为一个 tspan 渲染，英文单词不被拆开
    expect(svg).toContain('你出想法，ClawDao帮你实现');
    expect(svg).not.toMatch(/>Cla</);
    expect(svg).not.toMatch(/>wDao</);
    expect(svg).not.toMatch(/>Claw</);
  });

  it('renders the title as layered metallic art (gradient + shine + extrude + glow)', () => {
    const svg = buildTextOverlaySvg(
      'top_banner',
      { title: '你出想法，ClawDao帮你实现' },
      1920,
      320,
      'black_gold',
    );
    expect(svg).toContain('titleGradient'); // 多段金属渐变
    expect(svg).toContain('titleShine');    // 顶部高光层
    expect(svg).toContain('titleGlow');     // 外发光滤镜
    expect(svg).toContain('<clipPath');     // 高光裁切
    // 立体挤出层：同一标题被多次绘制
    const titleRenders = svg.match(/你出想法，ClawDao帮你实现/g) ?? [];
    expect(titleRenders.length).toBeGreaterThanOrEqual(3);
  });

  it('center layout renders light band + subtitle + bottom deco lines', () => {
    const svg = buildTextOverlaySvg(
      'top_banner',
      { title: '你出想法 我给结果', subtitle: '企业老板 | 实体商家' },
      1920,
      320,
      'black_gold',
      'center',
    );
    expect(svg).toContain('url(#lightBand)');  // 标题下水平光带
    expect(svg).toContain('url(#bandCore)');   // 光带中央白亮核心
    expect(svg).toContain('url(#topWarmGlow)');// 顶部暖金光晕
    expect(svg).toContain('url(#cornerShade)');// 右上角压暗
    expect(svg).toContain('企业老板 | 实体商家');
    expect(svg).toContain('letter-spacing');   // 副标题字间距
    // 底部三段装饰线
    expect((svg.match(/<rect /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it('center layout without subtitle omits the subtitle text', () => {
    const svg = buildTextOverlaySvg(
      'top_banner',
      { title: '你出想法 我给结果' },
      1920,
      320,
      'black_gold',
      'center',
    );
    expect(svg).not.toContain('letter-spacing');
    expect(svg).toContain('你出想法 我给结果');
  });
});
