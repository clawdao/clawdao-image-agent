import {describe, it, expect} from 'vitest';
import {
  ALLOWED_OPS,
  MAX_OPERATIONS,
  buildOpsUserPrompt,
  parseAndValidateOps,
  summarizeDesign,
  validateOperations,
} from './poster-ops';

const CTX = {
  canvas: {width: 1080, height: 1440},
  objectIds: new Set(['title', 'subtitle', 'brand']),
};

const design = {
  canvas: {width: 1080, height: 1440},
  fabricJson: {
    objects: [
      {id: 'title', type: 'Textbox', text: '主标题', left: 80, top: 200, fontSize: 96},
      {id: 'subtitle', type: 'Textbox', text: '副标题', left: 80, top: 340},
      {id: 'brand', type: 'Textbox', text: '亿检链', left: 880, top: 40},
    ],
  },
};

describe('poster-ops / 画布摘要', () => {
  it('包含画布尺寸、对象数与对象 id', () => {
    const s = summarizeDesign(design);
    expect(s).toContain('1080 × 1440');
    expect(s).toContain('对象总数：3');
    expect(s).toContain('id=title');
    expect(s).toContain('字号=96');
  });

  it('空画布返回兜底文案', () => {
    expect(summarizeDesign({})).toBe('（空画布）');
  });

  it('长文本被截断', () => {
    const s = summarizeDesign({
      canvas: {width: 10, height: 10},
      fabricJson: {objects: [{id: 'x', text: '啊'.repeat(80)}]},
    });
    expect(s).toContain('…');
  });

  it('提示词同时带上画布摘要与指令', () => {
    const p = buildOpsUserPrompt(design, '把标题改短');
    expect(p).toContain('id=title');
    expect(p).toContain('把标题改短');
  });
});

describe('poster-ops / 操作白名单', () => {
  it('白名单固定 9 个操作', () => {
    expect(ALLOWED_OPS).toHaveLength(9);
  });

  it('上限为 3', () => {
    expect(MAX_OPERATIONS).toBe(3);
  });

  it('未知操作被拒绝', () => {
    const r = validateOperations({operations: [{op: 'deleteAll'}]}, CTX);
    expect(r.ok).toBe(false);
    expect(r.rejected.join()).toContain('未知操作');
  });

  it('超过上限被截断', () => {
    const r = validateOperations(
      {
        operations: [
          {op: 'move', id: 'title', left: 10, top: 10},
          {op: 'move', id: 'title', left: 20, top: 20},
          {op: 'move', id: 'title', left: 30, top: 30},
          {op: 'move', id: 'title', left: 40, top: 40},
        ],
      },
      CTX,
    );
    expect(r.operations).toHaveLength(3);
    expect(r.rejected.join()).toContain('上限');
  });
});

describe('poster-ops / 安全闸门', () => {
  it('引用不存在的对象 id 会被拦下', () => {
    const r = validateOperations({operations: [{op: 'move', id: 'ghost', left: 10, top: 10}]}, CTX);
    expect(r.ok).toBe(false);
    expect(r.rejected.join()).toContain('ghost');
  });

  it('坐标越界会被拦下', () => {
    const r = validateOperations({operations: [{op: 'move', id: 'title', left: 99999, top: 10}]}, CTX);
    expect(r.ok).toBe(false);
    expect(r.rejected.join()).toContain('超出画布范围');
  });

  it('非数字坐标会被拦下', () => {
    const r = validateOperations({operations: [{op: 'move', id: 'title', left: 'x', top: 10}]}, CTX);
    expect(r.ok).toBe(false);
    expect(r.rejected.join()).toContain('不是数字');
  });

  it('外链图片来源会被拦下', () => {
    const r = validateOperations(
      {operations: [{op: 'addImage', src: 'https://evil.example.com/a.png', left: 0, top: 0}]},
      CTX,
    );
    expect(r.ok).toBe(false);
    expect(r.rejected.join()).toContain('来源不被允许');
  });

  it('站内 /outputs/ 图片允许', () => {
    const r = validateOperations(
      {operations: [{op: 'addImage', src: '/outputs/poster/studio/a.jpg', left: 0, top: 0}]},
      CTX,
    );
    expect(r.ok).toBe(true);
    expect(r.operations[0].op).toBe('addImage');
  });

  it('非法颜色被丢弃', () => {
    const r = validateOperations(
      {operations: [{op: 'updateText', id: 'title', fill: 'red; background:url(x)'}]},
      CTX,
    );
    expect(r.ok).toBe(true);
    expect((r.operations[0] as any).fill).toBeUndefined();
  });

  it('合法颜色被保留', () => {
    const r = validateOperations(
      {operations: [{op: 'updateText', id: 'title', fill: '#0A2455'}]},
      CTX,
    );
    expect((r.operations[0] as any).fill).toBe('#0A2455');
  });

  it('setBackground 纯色需要合法 hex', () => {
    const bad = validateOperations(
      {operations: [{op: 'setBackground', background: {type: 'solid', color: 'rgb(1,2,3)'}}]},
      CTX,
    );
    expect(bad.ok).toBe(false);

    const good = validateOperations(
      {operations: [{op: 'setBackground', background: {type: 'solid', color: '#112233'}}]},
      CTX,
    );
    expect(good.ok).toBe(true);
  });

  it('setBackground 渐变至少两个颜色', () => {
    const bad = validateOperations(
      {operations: [{op: 'setBackground', background: {type: 'gradient', gradient: {type: 'linear', colors: ['#fff']}}}]},
      CTX,
    );
    expect(bad.ok).toBe(false);

    const good = validateOperations(
      {operations: [{op: 'setBackground', background: {type: 'gradient', gradient: {type: 'linear', colors: ['#fff', '#000']}}}]},
      CTX,
    );
    expect(good.ok).toBe(true);
  });

  it('setBackground 图片走图片来源闸门', () => {
    const r = validateOperations(
      {operations: [{op: 'setBackground', background: {type: 'image', src: 'https://evil.example.com/a.png'}}]},
      CTX,
    );
    expect(r.ok).toBe(false);
  });

  it('resize 缩放被夹在安全区间', () => {
    const r = validateOperations(
      {operations: [{op: 'resize', id: 'title', scaleX: 999, scaleY: 0}]},
      CTX,
    );
    expect((r.operations[0] as any).scaleX).toBe(10);
    expect((r.operations[0] as any).scaleY).toBe(0.05);
  });

  it('resize 没有任何尺寸参数时被拦下', () => {
    const r = validateOperations({operations: [{op: 'resize', id: 'title'}]}, CTX);
    expect(r.ok).toBe(false);
  });
});

describe('poster-ops / 解析', () => {
  it('解析 ```json 代码块', () => {
    const parsed = parseAndValidateOps(
      '```json\n{"operations":[{"op":"updateText","id":"title","text":"新标题"}],"explanation":"改标题"}\n```',
      CTX,
    );
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.explanation).toBe('改标题');
  });

  it('解析裸 JSON', () => {
    const parsed = parseAndValidateOps(
      '{"operations":[{"op":"move","id":"title","left":80,"top":340}]}',
      CTX,
    );
    expect(parsed.operations).toHaveLength(1);
  });

  it('非法 JSON 抛错', () => {
    expect(() => parseAndValidateOps('完全不是 JSON', CTX)).toThrow();
  });

  it('空操作数组被标记为无操作', () => {
    const r = validateOperations({operations: []}, CTX);
    expect(r.ok).toBe(true);
    expect(r.operations).toHaveLength(0);
    expect(r.error).toBeTruthy();
  });

  it('suggestions 只保留字符串且最多 5 条', () => {
    const parsed = parseAndValidateOps(
      JSON.stringify({
        operations: [{op: 'move', id: 'title', left: 10, top: 10}],
        suggestions: ['a', 1, 'b', 'c', 'd', 'e', 'f'],
      }),
      CTX,
    );
    expect(parsed.suggestions).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});
