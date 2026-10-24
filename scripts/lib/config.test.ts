/**
 * config.test.ts — 配置加载器与变量引用解析的单元测试
 */

import { describe, expect, test } from 'bun:test';
import { resolvePath, resolveRefs, parseConfigText, detectFormat } from './config';

describe('resolvePath', () => {
  const root = {
    vars: { title: '亿检智能体' },
    product: { name: '商品A', delivery: '10+ 节实操课' },
    content: {
      modules: [
        { label: 'M1', title: '智能体安装配置与调试' },
        { label: 'M2', title: '提示词与需求模板' },
      ],
      cards: [{ tag: '零基础', title: '没接触过也能跟上' }],
    },
  };

  test('对象下钻', () => {
    expect(resolvePath(root, 'product.name')).toBe('商品A');
    expect(resolvePath(root, 'vars.title')).toBe('亿检智能体');
  });

  test('数组数字下标', () => {
    expect(resolvePath(root, 'content.modules.0.title')).toBe('智能体安装配置与调试');
  });

  test('数组按 label / tag 命名查找', () => {
    expect(resolvePath(root, 'content.modules.M2.title')).toBe('提示词与需求模板');
    expect(resolvePath(root, 'content.cards.零基础.title')).toBe('没接触过也能跟上');
  });

  test('路径不存在返回 undefined', () => {
    expect(resolvePath(root, 'product.nope')).toBeUndefined();
    expect(resolvePath(root, 'content.modules.M9.title')).toBeUndefined();
  });
});

describe('resolveRefs', () => {
  const root = {
    product: { name: '商品A' },
    content: { audience: [{ tag: '零基础' }] },
  };

  test('整串引用替换成原值（对象 / 数组）', () => {
    const result = resolveRefs<{ x: unknown }>({ x: '{{content.audience}}' }, root);
    expect(result.x).toEqual([{ tag: '零基础' }]);
  });

  test('字符串内嵌引用做插值', () => {
    expect(resolveRefs({ x: '商品名是 {{product.name}}！' }, root)).toEqual({ x: '商品名是 商品A！' });
  });

  test('引用无法解析时抛错', () => {
    expect(() => resolveRefs({ x: '{{product.missing}}' }, root)).toThrow(/无法解析/);
  });

  test('嵌套结构整体解析', () => {
    const input = { blocks: [{ kind: 'footer', text: '{{product.name}}' }] };
    expect(resolveRefs(input, root)).toEqual({
      blocks: [{ kind: 'footer', text: '商品A' }],
    });
  });
});

describe('配置格式识别', () => {
  test('按扩展名识别 json / yaml', () => {
    expect(detectFormat('a.json')).toBe('json');
    expect(detectFormat('a.yaml')).toBe('yaml');
    expect(detectFormat('a.yml')).toBe('yaml');
    expect(() => detectFormat('a.txt')).toThrow();
  });

  test('JSON 与 YAML 都能解析成同样的对象', () => {
    const json = parseConfigText('{"a":1,"b":["x"]}', 'json', 'a.json');
    const yaml = parseConfigText('a: 1\nb:\n  - x\n', 'yaml', 'a.yaml');
    expect(json).toEqual(yaml);
  });
});
