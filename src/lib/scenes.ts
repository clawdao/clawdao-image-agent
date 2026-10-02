/**
 * scenes.ts — ClawDao 图像工厂场景库
 *
 * 与 categories（cover/top_banner/mid_banner/popup/custom = 素材类型）正交：
 * scenes 定义"业务场景"，决定 prompt 注入的 IP 动作、调性、默认主题文案。
 *
 * 用法：
 *   const scene = getScene('livestream');
 *   const promptPrefix = sceneToPromptPrefix(scene);
 *   const defaults = scene.themeDefaults;
 *
 * 用户在 PromptEditor 中可手动覆盖 scene 联动的所有默认值。
 */

import type { BrandContext } from '../types/index';

// ============ 类型 ============
export type SceneKey = 'livestream' | 'product_launch' | 'holiday' | 'recruiting';

export interface SceneThemeDefaults {
  title: string;
  subtitle?: string;
  tags?: string[];
  gifts?: Array<{ name: string; value: string }>;
}

export interface Scene {
  key: SceneKey;
  displayName: string;
  hint: string;
  /** 联动品牌上下文（colorTone + useLobster） */
  brandContext: BrandContext;
  /** IP 动作（注入到 prompt 的 IP 描述） */
  ipAction: string;
  /** 场景专属提示词前缀（注入到 prompt 顶部） */
  promptPrefix: string;
  /** 默认主题文案（可被用户覆盖） */
  themeDefaults: SceneThemeDefaults;
  /** emoji 视觉标识 */
  icon: string;
}

// ============ 4 个场景 ============
export const SCENES: Record<SceneKey, Scene> = {
  livestream: {
    key: 'livestream',
    displayName: '直播间开播',
    hint: '蓝紫渐变 · 龙虾欢呼 · 内容自动生成',
    icon: '🎙️',
    brandContext: { colorTone: 'blue_purple', useLobster: true },
    ipAction: '橙色卡通龙虾吉祥物站在抽象发光装置旁欢呼、挥手、指向空白标题安全区',
    promptPrefix: `【场景】短视频 / 直播平台的开播封面或广告条
- 目标用户：刷到即点进来的泛流量观众
- 关键诉求：3 秒内传达"在卖什么 + 为什么看 + 进直播间能拿什么"
- 视觉重心：主视觉 IP 动作 + 干净空白标题安全区 + 发光的无字装饰`,
    themeDefaults: {
      title: '把重复工作，交给数字员工',
      subtitle: '一个软件，顶一层屋子 SaaS',
      tags: ['内容自动生成', '流程自动执行', '增长任务自动运转'],
    },
  },

  product_launch: {
    key: 'product_launch',
    displayName: '产品发布',
    hint: '黑金商务 · 龙虾托举发光装置 · 高端质感',
    icon: '🚀',
    brandContext: { colorTone: 'black_gold', useLobster: true },
    ipAction: '橙色卡通龙虾吉祥物双手托举纯色无字发光立方体，背景是聚光舞台',
    promptPrefix: `【场景】新版本 / 新功能 / 新产品的发布预热素材
- 目标用户：现有客户 + 行业关注者
- 关键诉求：传达"有什么新东西 + 解决什么问题 + 限时动作"
- 视觉重心：无字发光立体装置 + 龙虾托举动作 + 黑金质感光晕`,
    themeDefaults: {
      title: '全新 ClawDao 4.0 正式发布',
      subtitle: '自己长出来的企业系统 · 9 月 1 日上线',
      tags: ['全新发布', '限时优惠', '免费试用'],
    },
  },

  holiday: {
    key: 'holiday',
    displayName: '节日营销',
    hint: '暖红喜庆 · 龙虾送礼盒 · 节庆氛围',
    icon: '🎁',
    brandContext: { colorTone: 'black_gold', useLobster: true },
    ipAction: '橙色卡通龙虾吉祥物戴着红色节日帽、双手捧着纯色无字金色礼盒、四周飘洒金色光斑',
    promptPrefix: `【场景】节日 / 节庆 / 大促营销素材（春节、双 11、618、中秋等）
- 目标用户：所有节日活动期的潜在客户
- 关键诉求：节日氛围 + 福利发放 + 限时领取
- 视觉重心：纯色无字金色礼盒 + 无字节日装饰 + 光晕 + 龙虾戴帽`,
    themeDefaults: {
      title: '中秋大礼盒 · 限时送',
      subtitle: '加赠 3 份智能体 · 价值 15940',
      tags: ['限时 3 天', '价值 15940', '进直播间领取'],
      gifts: [
        { name: '公众号选题智能体', value: '2980' },
        { name: '短视频创作智能体', value: '5980' },
        { name: '客服智能体', value: '6980' },
      ],
    },
  },

  recruiting: {
    key: 'recruiting',
    displayName: '招商加盟',
    hint: '黑金商务 · 龙虾握手合作 · 专业可信',
    icon: '🤝',
    brandContext: { colorTone: 'black_gold', useLobster: true },
    ipAction: '橙色卡通龙虾吉祥物伸出右手准备握手、身后是阶梯向上的金色光柱与无字徽章',
    promptPrefix: `【场景】B 端招商 / 渠道招募 / 加盟合作素材
- 目标用户：实体商家、企业老板、渠道商
- 关键诉求：合作模式 + 分润机制 + 联系方式
- 视觉重心：黑金质感 + 龙虾握手 + 无字徽章 + 空白联系卡占位`,
    themeDefaults: {
      title: '城市合伙人全球招募',
      subtitle: '共享万亿 SaaS 市场 · 一城一代',
      tags: ['共享万亿市场', '一城一代', '0 门槛加入'],
    },
  },
};

// ============ 节庆主题识别 ============
export interface SceneTextContext {
  title?: string;
  subtitle?: string;
  tags?: string[];
}

/**
 * 从用户文案识别具体节日，生成高于参考图 DNA 和通用场景的视觉覆盖指令。
 * 只输入语义，不把标题原文交给图像模型，避免模型直接绘制汉字。
 */
export function resolveOccasionContext(theme: SceneTextContext): string {
  const corpus = [theme.title, theme.subtitle, ...(theme.tags ?? [])]
    .filter(Boolean)
    .join(' ');

  if (/国庆|祖国|华诞/.test(corpus)) {
    return `【节庆主题覆盖（最高优先级，覆盖参考图和通用节日提示）】
- 主题：中华人民共和国国庆庆典，庄重、热烈、高端商务
- 主色：中国红、深红、鎏金、暖金，禁止蓝色或紫色成为主色
- 元素：金色五角星、绽放烟花、红色绸带、金色庆典光柱、聚光舞台
- 氛围：举国欢庆、红金辉映、宏大但不杂乱
- 禁忌：不要月亮、月饼、礼盒、二维码、城市夜景或冷蓝科技风
- 标题安全区保持干净暗红或深色背景，所有文字均由本地排版层叠加`;
  }

  if (/中秋|月饼|团圆/.test(corpus)) {
    return `【节庆主题覆盖（最高优先级，覆盖参考图和通用节日提示）】
- 主题：中秋团圆、东方雅致、商务温情
- 主色：深蓝、暖金、柔白；元素：圆月、桂花、玉兔剪影、金色光晕
- 禁忌：不要春节灯笼、国庆烟花、二维码或冷硬工业风
- 标题安全区保持干净夜空或深蓝渐变背景，所有文字均由本地排版层叠加`;
  }

  if (/春节|新春|新年|元旦|除夕/.test(corpus)) {
    return `【节庆主题覆盖（最高优先级，覆盖参考图和通用节日提示）】
- 主题：新春纳福、红金喜庆、现代商务
- 主色：中国红、朱砂红、鎏金；元素：灯笼、烟花、祥云、金色光斑
- 禁忌：不要月亮、月饼、二维码或冷蓝主色
- 标题安全区保持干净红色渐变背景，所有文字均由本地排版层叠加`;
  }

  return '';
}

// ============ 工具 ============
const SCENE_KEYS = Object.keys(SCENES) as SceneKey[];

export function isSceneKey(s: unknown): s is SceneKey {
  return typeof s === 'string' && (SCENE_KEYS as string[]).includes(s);
}

export function getScene(key: SceneKey | string | undefined): Scene {
  if (key && isSceneKey(key)) return SCENES[key];
  return SCENES.livestream; // 默认直播场景
}

export function listScenes(): Scene[] {
  return SCENE_KEYS.map((k) => SCENES[k]);
}

/**
 * 把场景元数据转成 prompt 注入块（用于 prompt 模板的 {{scene_prompt}} 变量）
 */
export function sceneToPromptPrefix(scene: Scene): string {
  return `${scene.promptPrefix}

【场景专属 IP 行为】
${scene.ipAction}

【场景默认调性】
- 色调：${scene.brandContext.colorTone === 'blue_purple' ? '蓝紫渐变' : '黑金商务'}
- 包含 IP：${scene.brandContext.useLobster !== false ? '是' : '否'}
`;
}

/**
 * 把场景默认主题合并到用户当前主题（用户值优先）
 */
export function mergeSceneDefaults(
  scene: Scene,
  userTheme: { title?: string; subtitle?: string; tags?: string[]; gifts?: Array<{name: string; value: string}> }
): { title: string; subtitle?: string; tags?: string[]; gifts?: Array<{name: string; value: string}> } {
  const d = scene.themeDefaults;
  return {
    title: userTheme.title || d.title,
    subtitle: userTheme.subtitle ?? d.subtitle,
    tags: userTheme.tags && userTheme.tags.length > 0 ? userTheme.tags : d.tags,
    gifts: userTheme.gifts && userTheme.gifts.length > 0 ? userTheme.gifts : d.gifts,
  };
}
