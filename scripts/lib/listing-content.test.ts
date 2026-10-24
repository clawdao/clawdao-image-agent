/**
 * listing-content.test.ts — 商品图配置 → 海报 / 详情页文案的单元测试
 */

import { describe, expect, test } from 'bun:test';
import { loadListingConfigById } from './listing-config';
import { buildPosters, extractBlockTexts, renderCopyMarkdown } from './listing-content';

describe('商品图配置加载', () => {
  test('当前交付版 v8 能加载，且结构完整', () => {
    const config = loadListingConfigById('v8').data;
    expect(config.id).toBe('v8');
    expect(config.product.name).toBe('亿检智能体零基础实操训练营');
    expect(config.posters.length).toBe(10);
    expect(config.compliance).toContain('compliance');
  });

  test('不存在的版本给出可读报错', () => {
    expect(() => loadListingConfigById('v999')).toThrow(/找不到商品图配置/);
  });
});

describe('变量引用在配置里生效', () => {
  const config = loadListingConfigById('v8').data;

  test('海报里的引用被替换成实际文案', () => {
    const posters = buildPosters(config);
    const texts = posters.flatMap((poster) => extractBlockTexts(poster.blocks)).join('\n');
    expect(texts).toContain('亿检智能体零基础实操训练营');
    expect(texts).toContain('人工智能培训');
    expect(texts).not.toContain('{{');
  });

  test('content 数组引用被整段替换', () => {
    const posters = buildPosters(config);
    const target = posters.find((poster) => poster.file === 'main-3-audience');
    const cards = target!.blocks.find((block) => block.kind === 'cards');
    expect(cards && cards.kind === 'cards' && Array.isArray(cards.items)).toBe(true);
    expect(JSON.stringify(cards)).toContain('没接触过也能跟上');
  });
});

describe('商品详情页文案渲染', () => {
  const config = loadListingConfigById('v8').data;
  const copy = renderCopyMarkdown(config);

  test('首行是商品名称', () => {
    expect(copy.startsWith('# 亿检智能体零基础实操训练营')).toBe(true);
  });

  test('商品字段齐全', () => {
    expect(copy).toContain('- **商品属性**：虚拟商品 · 数字课程（智能体工具技术实战）');
    expect(copy).toContain('- **交付形式**：10+ 节实操课 + 作业模板 + 直播答疑 + 班级群交流');
  });

  test('模块概览 / 模块详解由 content 派生', () => {
    expect(copy).toContain('### M1｜智能体安装配置与调试');
    expect(copy).toContain('装起来：下载安装、环境自检、参数调通');
    expect(copy).toContain('完成智能体部署与环境配置、参数调试，跑通首个可用智能体实例。');
  });

  test('FAQ 与目标客户表由 content 派生', () => {
    expect(copy).toContain('**Q1：上课需要准备什么？**');
    expect(copy).toContain('| 人群 | 你能带走什么 |');
    expect(copy).toContain('| 零基础学习者 | 从下载安装到跑通第一个智能体，拿到一套可复现的操作步骤 |');
  });

  test('讲师署名由 author 派生', () => {
    expect(copy).toContain('**顺道大叔 · 亿检链创始人 · 开发者**');
    expect(copy).toContain('- 《Node.js 区块链开发》《Web3.0 数字化实战》作者');
  });

  test('渲染结果里没有未解析的引用', () => {
    expect(copy).not.toContain('{{');
  });
});
