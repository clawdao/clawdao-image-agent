import {describe, it, expect} from 'vitest';
import {
  SCENES,
  getScene,
  isSceneKey,
  listScenes,
  sceneToPromptPrefix,
  mergeSceneDefaults,
  resolveOccasionContext,
  type SceneKey,
} from './scenes';

describe('SCENES 数据完整性', () => {
  it('4 个场景全部存在', () => {
    expect(Object.keys(SCENES)).toEqual(['livestream', 'product_launch', 'holiday', 'recruiting']);
  });

  it('每个场景都有必要字段', () => {
    for (const k of Object.keys(SCENES) as SceneKey[]) {
      const s = SCENES[k];
      expect(s.key).toBe(k);
      expect(s.displayName.length).toBeGreaterThan(0);
      expect(s.brandContext.colorTone).toMatch(/^(blue_purple|black_gold)$/);
      expect(s.brandContext.useLobster).toBe(true);
      expect(s.ipAction.length).toBeGreaterThan(0);
      expect(s.promptPrefix.length).toBeGreaterThan(0);
      expect(s.themeDefaults.title.length).toBeGreaterThan(0);
    }
  });

  it('节日场景包含 gifts 默认值', () => {
    expect(SCENES.holiday.themeDefaults.gifts?.length).toBe(3);
    expect(SCENES.holiday.themeDefaults.tags).toContain('限时 3 天');
  });

  it('场景视觉指令不要求模型绘制文字、标签或二维码', () => {
    for (const scene of Object.values(SCENES)) {
      const visualInstruction = `${scene.ipAction}\n${scene.promptPrefix}`;
      expect(visualInstruction).not.toMatch(/主标题|产品名|限时字样|合作标语|指向文字|二维码占位|NEW/);
    }
  });
});

describe('getScene', () => {
  it('返回已知场景', () => {
    expect(getScene('livestream').key).toBe('livestream');
    expect(getScene('holiday').key).toBe('holiday');
  });

  it('未知 key 返回 livestream 默认', () => {
    expect(getScene('unknown').key).toBe('livestream');
    expect(getScene(undefined).key).toBe('livestream');
    expect(getScene('').key).toBe('livestream');
  });
});

describe('isSceneKey', () => {
  it('识别合法 key', () => {
    expect(isSceneKey('livestream')).toBe(true);
    expect(isSceneKey('holiday')).toBe(true);
  });
  it('拒绝非法 key', () => {
    expect(isSceneKey('invalid')).toBe(false);
    expect(isSceneKey(123)).toBe(false);
    expect(isSceneKey(null)).toBe(false);
    expect(isSceneKey(undefined)).toBe(false);
  });
});

describe('listScenes', () => {
  it('返回 4 个场景', () => {
    const list = listScenes();
    expect(list.length).toBe(4);
    expect(list[0].key).toBe('livestream');
  });
});

describe('sceneToPromptPrefix', () => {
  it('包含场景描述、IP 行为、调性', () => {
    const text = sceneToPromptPrefix(SCENES.holiday);
    expect(text).toContain('【场景】');
    expect(text).toContain('金色礼盒');
    expect(text).toContain('龙虾');
    expect(text).toMatch(/黑金商务|蓝紫渐变/);
  });
});

describe('resolveOccasionContext', () => {
  it('国庆文案生成红金庆典覆盖指令', () => {
    const text = resolveOccasionContext({
      title: '国庆节快乐',
      subtitle: '亿检链 · 2026年10月1日',
      tags: ['祝福', '商务'],
    });
    expect(text).toContain('最高优先级');
    expect(text).toContain('中国红');
    expect(text).toContain('金色五角星');
    expect(text).toContain('绽放烟花');
    expect(text).toContain('禁止蓝色或紫色');
  });

  it('中秋与春节使用各自的视觉语境', () => {
    expect(resolveOccasionContext({title: '月满中秋'})).toContain('圆月');
    expect(resolveOccasionContext({title: '新春快乐'})).toContain('灯笼');
  });

  it('普通文案不注入节庆覆盖', () => {
    expect(resolveOccasionContext({title: '产品正式发布'})).toBe('');
  });
});

describe('mergeSceneDefaults', () => {
  it('用户填了 → 用用户的', () => {
    const merged = mergeSceneDefaults(SCENES.holiday, {title: '我的标题'});
    expect(merged.title).toBe('我的标题');
    expect(merged.subtitle).toBe(SCENES.holiday.themeDefaults.subtitle);
    expect(merged.tags).toEqual(SCENES.holiday.themeDefaults.tags);
  });

  it('用户没填 → 用场景默认', () => {
    const merged = mergeSceneDefaults(SCENES.livestream, {});
    expect(merged.title).toBe(SCENES.livestream.themeDefaults.title);
  });

  it('用户 tags 为空数组 → 用场景默认', () => {
    const merged = mergeSceneDefaults(SCENES.holiday, {tags: []});
    expect(merged.tags).toEqual(SCENES.holiday.themeDefaults.tags);
  });

  it('用户 gifts 为空 → 用场景默认', () => {
    const merged = mergeSceneDefaults(SCENES.holiday, {gifts: []});
    expect(merged.gifts).toEqual(SCENES.holiday.themeDefaults.gifts);
  });
});
