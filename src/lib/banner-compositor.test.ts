import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { composeBanner, resolveBrandAsset } from './banner-compositor';

/** 造一张暗色底图，模拟 image-01 返回的 21:9 原始图 */
async function makeBackground(width = 1344, height = 576): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#2a2a30' },
  })
    .png()
    .toBuffer();
}

/** 造一个带 alpha 的橙色圆形，当作 IP 抠图稿 */
async function makeIpAsset(path: string): Promise<string> {
  const size = 200;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="100" cy="100" r="80" fill="#F26522"/>
  </svg>`;
  writeFileSync(path, Buffer.from(svg));
  return path;
}

describe('banner-compositor', () => {
  it('裁切到目标尺寸（AI 原图 21:9 → 广告条 6:1）', async () => {
    const bg = await makeBackground();
    const result = await composeBanner(bg, { width: 1920, height: 320 });
    expect(result.width).toBe(1920);
    expect(result.height).toBe(320);
    expect(result.ipApplied).toBe(false);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(320);
  });

  it('把 IP 资产贴到右侧并保持主体完整', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawdao-ip-'));
    const ipPath = await makeIpAsset(join(dir, 'lobster-cutout.png'));
    const bg = await makeBackground();

    const result = await composeBanner(bg, {
      width: 1920,
      height: 320,
      ipAssetPath: ipPath,
      colorTone: 'black_gold',
    });
    expect(result.ipApplied).toBe(true);

    // 右侧区域应出现 IP 的橙色像素
    const { data, info } = await sharp(result.buffer)
      .extract({ left: Math.round(1920 * 0.7), top: 0, width: Math.round(1920 * 0.3), height: 320 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let orange = 0;
    for (let i = 0; i < info.width * info.height; i++) {
      const r = data[i * info.channels];
      const g = data[i * info.channels + 1];
      const b = data[i * info.channels + 2];
      if (r > 180 && g < 150 && b < 110) orange++;
    }
    expect(orange).toBeGreaterThan(500);
  });

  it('IP 资产缺失时降级为纯背景，不抛错', async () => {
    const bg = await makeBackground();
    const result = await composeBanner(bg, {
      width: 1920,
      height: 320,
      ipAssetPath: '/nonexistent/lobster-cutout.png',
    });
    expect(result.ipApplied).toBe(false);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('竖屏尺寸下 IP 不会超出画布（cover 1080×1920 回归）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clawdao-ip-'));
    const ipPath = await makeIpAsset(join(dir, 'lobster-cutout.png'));
    const bg = await makeBackground(1024, 1536);

    const result = await composeBanner(bg, {
      width: 1080,
      height: 1920,
      ipAssetPath: ipPath,
      colorTone: 'blue_purple',
    });
    expect(result.ipApplied).toBe(true);
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(1080);
    expect(meta.height).toBe(1920);
  });

  it('resolveBrandAsset 对缺失文件返回 null', () => {
    expect(resolveBrandAsset('/nonexistent-dir', 'lobster-cutout.png')).toBeNull();
  });
});
