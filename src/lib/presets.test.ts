import {describe, it, expect} from 'vitest';
import {getPreset, PRESETS} from './presets';

describe('presets', () => {
  it('cover is 9:16', () => {
    expect(getPreset('cover').ratio).toBe('9:16');
  });

  it('top_banner is 21:9', () => {
    expect(getPreset('top_banner').ratio).toBe('21:9');
  });

  it('mid_banner is 21:9（image-01 不支持 16:5）', () => {
    expect(getPreset('mid_banner').ratio).toBe('21:9');
  });

  it('popup is 1:1', () => {
    expect(getPreset('popup').ratio).toBe('1:1');
  });

  it('custom falls back', () => {
    expect(getPreset('custom').ratio).toBe('16:9');
  });

  it('all presets have size', () => {
    for (const p of Object.values(PRESETS)) {
      expect(p.size.w).toBeGreaterThan(0);
      expect(p.size.h).toBeGreaterThan(0);
    }
  });
});
