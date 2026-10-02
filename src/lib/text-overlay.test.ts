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
});
