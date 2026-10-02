import { describe, it, expect } from 'vitest';
import { renderTemplate, loadPrompt } from './prompt_builder';

describe('renderTemplate', () => {
  it('replaces simple variables', () => {
    expect(renderTemplate('Hello, {{name}}!', { name: 'imfly' })).toBe(
      'Hello, imfly!'
    );
  });

  it('keeps placeholder when value missing', () => {
    expect(renderTemplate('Hi, {{name}}!', {})).toBe('Hi, {{name}}!');
  });

  it('escapes regex meta-characters in values', () => {
    // 注意：JS String.prototype.replace 字符串模式下 $$ → $，所以 '$$$$' 转义后剩 $$。
    expect(renderTemplate('a {{var}} b', { var: '$1' })).toBe('a $$1 b');
  });

  it('handles arrays as comma-separated', () => {
    expect(renderTemplate('[{{tags}}]', { tags: ['a', 'b'] })).toBe('[a、b]');
  });

  it('supports nested objects via dot notation', () => {
    expect(renderTemplate('{{a.b}}', { a: { b: 'v' } })).toBe('{{a.b}}');
  });
});

describe('loadPrompt', () => {
  it('popup template delegates cards and fine print to the local text layer', () => {
    const result = loadPrompt('popup', {
      title: '中秋大礼盒 · 限时送',
      gifts: [{name: '公众号选题智能体', value: '2980'}],
    });
    expect(result.body).toContain('本地排版层');
    expect(result.body).toContain('不生成卡片、面板');
    expect(result.body).not.toContain('中秋大礼盒');
    expect(result.body).not.toContain('公众号选题智能体');
  });

  it('loads a real prompt template', () => {
    const result = loadPrompt('cover', {
      title: '把重复工作，交给数字员工',
      subtitle: '一个软件，顶一层屋子 SaaS',
    });
    expect(result.frontmatter).toHaveProperty('ratio', '9:16');
    expect(result.body).toContain('本地排版层');
    expect(result.body).not.toContain('把重复工作，交给数字员工');
  });
});
