import {describe, it, expect} from 'vitest';
import {brandToText, DEFAULT_BRAND} from './brand-context';

describe('brandToText', () => {
  it('includes brand name', () => {
    const text = brandToText();
    expect(text).toContain('ClawDao');
  });

  it('lists three features', () => {
    const text = brandToText();
    for (const f of DEFAULT_BRAND.three_features) {
      expect(text).toContain(f);
    }
  });

  it('lists all audiences', () => {
    const text = brandToText();
    expect(text).toContain('企业老板');
    expect(text).toContain('超级个体');
  });

  it('mentions IP name', () => {
    const text = brandToText();
    expect(text).toContain('龙虾');
  });
});
