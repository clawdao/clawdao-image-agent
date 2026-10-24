/**
 * poster-renderer.ts — 结构化海报排版层（商品详情图 / 长图 / 方图）
 *
 * 为什么不用 text-overlay.ts：
 *   text-overlay 只覆盖 cover / banner / popup 四种固定版式，
 *   而商品详情图需要"卡片网格 / 时间轴 / 问答列表"这类结构化排版。
 *   这里补齐一套块级排版：内容与视觉分离，文字全部本地渲染
 *   （image-01 直接画中文会出形近乱码，商品页文字必须逐字准确）。
 *
 * 设计约束：
 *   1. 输出的 SVG 背景是透明的 —— 由调用方把它 composite 到 AI 生成的底图上，
 *      这样"AI 出质感 / 本地出字"的两段式流水线保持一致。
 *   2. 高度由内容算出（renderPoster 返回 height），长图可以任意加长。
 */

import { qrMatrix, qrSvg } from './qr-svg';

export type PosterTone =
  | 'black_gold'
  | 'blue_purple'
  | 'deep_blue'
  | 'warm_amber'
  | 'classic_blue'
  | 'pure_white'
  | 'pure_blue'
  /** 清新绿（V7 主视觉）：奶油底 + 有机浅绿块 + 亮黄点缀 */
  | 'fresh_green'
  /** 清新绿 · 纯白底（浅底纯色图） */
  | 'pure_fresh'
  /** 清新绿 · 纯深绿底（深底纯色图） */
  | 'pure_green'
  /** 暖色琥珀 · 纯米白底（浅底纯色图） */
  | 'pure_cream'
  /** 暖色琥珀 · 纯深琥珀底（深底纯色图） */
  | 'pure_warm'
  /** 浅色科技风（直播间封面）：近白底 + 蓝/青/紫极光 + 近黑标题 */
  | 'tech_light'
  /** 纯色亮蓝（蓝色信息型海报）：通栏蓝底 + 白字 + 白色面板块 */
  | 'solid_blue';

export interface PosterCard {
  tag?: string;
  title: string;
  lines?: string[];
}

/** 作者名片：头像 + 姓名 + 头衔 + 资历要点 */
export interface PosterProfile {
  /** 头像（data URI 或本地文件路径，由调用方解析） */
  avatar?: string;
  name: string;
  role?: string;
  bullets?: string[];
}

export interface PosterTimelineItem {
  time: string;
  title: string;
  lines?: string[];
}

export interface PosterRow {
  label: string;
  title: string;
  lines?: string[];
}

/**
 * 右下角品牌角标。
 *
 * 参考图（视频号直播封面）在右下角有一枚小标识；本项目用自家品牌角标占位，
 * 位置/尺寸/颜色均可配置，钉在成品画布上（不随内容缩放）。
 */
export interface PosterCornerMark {
  /** 角标图片（data URI / 本地路径） */
  logo?: string;
  /** 角标文字（可选） */
  text?: string;
  /** 位置，默认 bottom-right */
  position?: 'bottom-right' | 'bottom-left';
  /** 图标高度（成品像素），默认 W*0.03 */
  logoHeight?: number;
  /** 图标宽度（成品像素），默认等于 logoHeight */
  logoWidth?: number;
  /** 文字字号系数（相对 W），默认 0.02 */
  textScale?: number;
  /** 距右/左边距（成品像素），默认 W*0.016 */
  offsetX?: number;
  /** 距下边距（成品像素），默认 W*0.012 */
  offsetY?: number;
  /** 文字颜色，默认取调色板 brandText */
  color?: string;
}

/**
 * 品牌位：右上角「Logo + 品牌名」。
 *
 * 为什么放在 options 而不是 blocks：
 *   品牌位必须钉在成品画布的右上角，不能跟着内容一起等比缩放
 *   （方图会把长图内容压缩到 1080，品牌跟着缩会变得很小）。
 */
export interface PosterBrand {
  /** Logo 图片（data URI 或本地文件路径，由调用方解析） */
  logo?: string;
  /** 品牌文字 */
  text: string;
  /** Logo 显示高度（px），默认 = 成品宽 * 0.05 */
  logoHeight?: number;
  /** Logo 显示宽度（px），默认 = logoHeight * 1.27 */
  logoWidth?: number;
  /**
   * 品牌位位置，默认 top-right（历史行为不变）。
   * - top-left：左上角（浅色封面常用）
   * - bottom-center：底部居中（竖版长图收尾）
   */
  position?: 'top-right' | 'top-left' | 'bottom-center';
  /**
   * 品牌位样式，默认 chip（白底圆角卡片托住 Logo + 文字）。
   * - plain：不加底板，Logo + 文字直接排（浅色底 / 极简封面）
   */
  style?: 'chip' | 'plain';
  /** 水平偏移（px），覆写默认边距 */
  offsetX?: number;
  /** 垂直偏移（px），覆写默认上边距 */
  offsetY?: number;
  /** 品牌文字字号系数（相对 W），默认 0.028 */
  textScale?: number;
}

/** 标题版式的数值卡 */
export interface PosterStat {
  value: string;
  label: string;
}

/** 标题版式（大气封面用） */
export interface PosterTitleSpec {
  /** 英文小标（品牌化点缀） */
  enLabel?: string;
  /** 顶部小标签 */
  eyebrow?: string;
  /** 主标题（可用 \n 显式分行） */
  title: string;
  /** 副标题 */
  subtitle?: string;
  /** 数值卡（如 3 天 / 2 个智能体） */
  stats?: PosterStat[];
  /** 胶囊徽章 */
  badges?: string[];
}

/** 居中标题（浅色封面 / 信息型海报顶部） */
export interface PosterCenterTitle {
  kind: 'centerTitle';
  /** 顶部小标（如品牌 / 栏目名） */
  kicker?: string;
  /** 主标题（可用 \n 显式分行）；只想要注解行时可省略 */
  title?: string;
  /** 副标题 */
  subtitle?: string;
  /** 底部注解 */
  note?: string;
  /** 对齐方式，默认 center */
  align?: 'center' | 'left';
  /** 标题字号系数（相对 W），不填自适应 */
  titleScale?: number;
  /** 标题字体：display = 标题体（艺术字），sans = 无衬线黑体（现代科技风） */
  font?: 'display' | 'sans';
  /** 小标字号系数（相对 W），默认 0.026 */
  kickerScale?: number;
  /** 小标与主标题之间的间距（成品像素），默认 W*0.022 */
  kickerGap?: number;
  /** 注解字号系数（相对 W），默认 0.021 */
  noteScale?: number;
  /** 注解与上方标题之间的间距（成品像素），默认 W*0.018 */
  noteGap?: number;
  /** 副标题字号系数（相对 W），默认 0.03 */
  subtitleScale?: number;
  /** 标题与副标题之间的额外间距（成品像素），默认 W*0.022 */
  subtitleGap?: number;
  /** 副标题与上一块之间的额外间距（成品像素），默认 0 */
  gapBefore?: number;
}
/** 图标 + 标题 + 说明（横向功能卡片组，浅色封面用） */
export interface PosterFeatureItem {
  /** 图标图片路径（data URI / 本地路径）；不填则画序号圆牌 */
  icon?: string;
  /**
   * 线性图标形状（内置描边矢量图，不依赖字体/图片）。
   * 复刻参考图的「细黑线稿小图标」时用（envelope/flow/loop/bolt/check）。
   */
  iconShape?: 'envelope' | 'flow' | 'loop' | 'bolt' | 'check';
  /** 线性图标颜色（默认近黑） */
  iconColor?: string;
  title: string;
  desc?: string;
  /** 卡片底色覆盖（不填用调色板默认） */
  tint?: string;
  /** 卡片底色渐变（[上, 下]），优先于 tint */
  gradient?: [string, string];
  /** 渐变类型：linear（默认，纵向）/ radial（中心白、边缘带色） */
  gradientType?: 'linear' | 'radial';
  /** 卡片描边色（配合 radial 渐变做「玻璃卡」边框） */
  stroke?: string;
  /** 卡片阴影（外发光模糊半径，0 = 无阴影） */
  shadow?: number;
}

/** 卖点网格（信息型海报的白卡内 2×2） */
export interface PosterGridItem {
  title: string;
  desc?: string;
}

/** 块间距覆写（1:1 复刻版式时按参考图像素对齐） */
export interface PosterBlockGap {
  /** 与上一块之间的间距（成品像素），覆盖默认间距 */
  gapBefore?: number;
  /** 与下一块之间的间距（成品像素），覆盖默认间距 */
  gapAfter?: number;
}

export type PosterBlock = (
  | { kind: 'hero'; kicker?: string; title: string; subtitle?: string; badges?: string[] }
  | { kind: 'title'; spec: PosterTitleSpec }
  | { kind: 'section'; label: string; title: string; desc?: string }
  | { kind: 'cards'; columns?: number; items: PosterCard[] }
  | { kind: 'timeline'; items: PosterTimelineItem[] }
  | { kind: 'rows'; title?: string; items: PosterRow[]; align?: 'left' | 'center' }
  | { kind: 'profile'; profile: PosterProfile }
  | { kind: 'note'; text: string }
  | { kind: 'footer'; text: string; sub?: string; divider?: boolean; size?: number; align?: 'center' | 'left'; color?: string; subSize?: number; subGap?: number; trailing?: number }
  /** 居中标题 */
  | PosterCenterTitle
  /** 横向功能卡片组 */
  | {
      kind: 'features';
      columns?: number;
      items: PosterFeatureItem[];
      /** 整组宽度系数（相对 W），默认铺满内容区；小于 1 时水平居中 */
      widthRatio?: number;
      /** 卡片间距（成品像素），默认 W*0.022 */
      gap?: number;
      /** 卡片固定高度（成品像素），不填按内容自适应 */
      height?: number;
      /** 卡片圆角（成品像素），默认 W*0.018 */
      radius?: number;
      /** 卡片内边距（成品像素），默认 W*0.026 */
      padding?: number;
      /** 标题字号系数（相对 W），默认 0.028 */
      titleScale?: number;
      /** 说明字号系数（相对 W），默认 0.021 */
      descScale?: number;
      /** 圆牌图标尺寸系数（相对 W），默认 0.07；0 = 不画图标 */
      iconScale?: number;
      /** 图标与标题之间的间距（成品像素），默认 W*0.016 */
      iconGap?: number;
      /** 标题行高系数（相对标题字号），默认 1.3 */
      titleLineHeight?: number;
      /** 标题与说明之间的额外间距（成品像素），默认 W*0.012 */
      titleGap?: number;
    }
  /** 卖点网格（无卡片底） */
  | {
      kind: 'grid';
      columns?: number;
      items: PosterGridItem[];
      align?: 'center' | 'left';
      titleScale?: number;
      /** 说明字号系数（相对 W），默认 0.025 */
      descScale?: number;
      /** 说明行高系数（相对说明字号），默认 1.6 */
      descLineHeight?: number;
      /** 行间距（成品像素），默认 W*0.03 */
      rowGap?: number;
      /** 标题与说明之间的额外间距（成品像素），默认 W*0.016 */
      titleGap?: number;
      /** 标题颜色覆盖（默认用调色板 gold） */
      titleColor?: string;
      /** 说明颜色覆盖（默认用调色板 textDim） */
      descColor?: string;
      /** 说明最大行数，默认 3 */
      descMaxLines?: number;
    }
  /** 圆角面板（内嵌子块） */
  | {
      kind: 'panel';
      blocks: PosterBlock[];
      fill?: string;
      stroke?: string;
      radius?: number;
      padding?: number;
      tone?: 'card' | 'inherit';
      minHeight?: number;
      /** 面板宽度系数（相对内容区宽），小于 1 时水平居中 */
      widthRatio?: number;
      /** 子块之间的间距（成品像素），默认 W*0.028 */
      gap?: number;
      /** 面板投影模糊半径（成品像素），0 = 无投影 */
      shadow?: number;
    }
  /** 二维码卡 */
  | {
      kind: 'qr';
      /** 二维码图片路径（与 content 二选一） */
      src?: string;
      /** 二维码内容（本地编码成矢量码，推荐；不填则用 src） */
      content?: string;
      title?: string;
      caption?: string;
      size?: number;
      card?: boolean;
      overlap?: number;
      /** 托底框形状：square = 近正方形白框（模板那种「二维码压住卡片」的观感） */
      frame?: 'auto' | 'square';
      /** 托底框宽度（成品像素）；不填按二维码边长 + 内边距推算 */
      frameWidth?: number;
      /** 托底框圆角（成品像素），默认 W*0.018 */
      frameRadius?: number;
      /** 托底框填充色，默认纯白 */
      frameFill?: string;
      /** 托底框描边色，默认浅灰 */
      frameStroke?: string;
      /** 二维码与托底框之间的留白（成品像素），默认 W*0.03 */
      framePad?: number;
      /** 说明文字字号系数（相对 W），默认 0.024 */
      captionScale?: number;
      /** 说明与二维码框之间的间距（成品像素），默认 W*0.018 */
      captionGap?: number;
      /** 说明文字颜色覆盖 */
      captionColor?: string;
      /** 标题字号系数（相对 W），默认 0.03 */
      titleScale?: number;
    }
  /** 主视觉图 */
  | {
      kind: 'visual';
      src?: string;
      aiPrompt?: string;
      height?: number;
      heightRatio?: number;
      /** 图片区宽度系数（相对 W），默认内容区宽；小于 1 时居中 */
      widthRatio?: number;
      caption?: string;
      fit?: 'contain' | 'cover';
      trim?: boolean;
      aiAspect?: '1:1' | '16:9' | '9:16' | '21:9' | '5:4';
      /** 四周 alpha 羽化比例（0~0.2），让 AI 图无缝融进背景 */
      feather?: number;
    }
  /** 空白间隔 */
  | {
      kind: 'spacer';
      height?: number;
      ratio?: number;
      /** 固定高度（成品像素），优先于 ratio */
      heightPx?: number;
      /** 固定占位高度系数（相对成品高度），用于 1:1 复刻版式 */
      heightRatio?: number;
      fill?: boolean;
    }
) & PosterBlockGap;

export interface PosterOptions {
  width: number;
  tone?: PosterTone;
  /** 顶部暖金光晕的横向位置（0~1），默认 0.68 */
  glowX?: number;
  /**
   * 目标成品尺寸。给定时整块内容等比缩放并居中到该尺寸内，
   * 用于强制输出 1:1 方图；不给时高度由内容自然决定（长图任意长）。
   *
   * anchor 控制内容在成品画布里的垂直落位：
   * - center（默认）：上下居中
   * - top：顶对齐（封面图常用，下方留给主视觉）
   * - bottom：底对齐
   */
  fit?: { width: number; height: number; anchor?: 'center' | 'top' | 'bottom' };
  /**
   * 背景模式：
   * - gradient（默认）：本地程序化品牌背景（渐变 + 网格 + 粒子 + 光束），零文字风险
   * - none：只输出半透明压暗层，底图由调用方 composite AI 生成图
   * - solid：纯色底（无渐变 / 无网格 / 无粒子 / 无光束），用于视频号小店
   *   「纯色底图」场景——礼物、推荐等需要主体更聚焦时使用
   * - organic：有机背景（奶油底 + 边缘有机色块），清新绿方案专用
   * - aurora：极光背景（近白底 + 蓝/青/紫柔光 + 底部地台），浅色科技封面用
   */
  background?: 'gradient' | 'none' | 'solid' | 'organic' | 'aurora';
  /** 右上角品牌位（Logo + 品牌名） */
  brand?: PosterBrand;
  /** 右下角品牌角标（Logo + 文字），钉在成品画布上 */
  cornerMark?: PosterCornerMark;
  /**
   * 画布内边距（布局单位 px，宽度 = options.width 时就是成品像素）。
   * 不填则用默认值（上下 W * 0.085 / W * 0.06）。
   */
  padding?: { top?: number; bottom?: number };
}

export interface PosterResult {
  svg: string;
  width: number;
  height: number;
}

export interface PosterPalette {
  /** 主强调色（线、点、装饰） */
  gold: string;
  goldSoft: string;
  goldFaint: string;
  titleStops: string[];
  /** 标题渐变方向：纵向 = 金属字，横向 = 品牌四色 */
  titleGradient: { x1: number; y1: number; x2: number; y2: number };
  text: string;
  textDim: string;
  textFaint: string;
  cardFill: string;
  cardStroke: string;
  chipFill: string;
  chipText: string;
  rail: string;
  divider: string;
  /** 背景压暗层颜色 */
  scrim: string;
  /** 压暗层三段不透明度 */
  scrimOpacity: [number, number, number];
  /** 顶部光晕颜色 */
  glow: string;
  /** 次级 / 三级光晕颜色 */
  glow2: string;
  glow3: string;
  /** 大标题描边色（用于深色底上的金属/霓虹描边） */
  titleStroke: string;
  /** 大标题描边宽度系数（0 = 不描边，浅色底用） */
  titleStrokeWidth: number;
  /** 大标题是否加发光阴影（浅色底用 false，否则字会发灰） */
  titleShadow: boolean;
  /** 卡片顶部强调条的渐变色 */
  accentStops: string[];
  /** 卡片填充不透明度（浅底用 1，深底用 0.86 透出光晕） */
  cardOpacity: number;
  /** 卡片顶部的强调条是否使用渐变 */
  accentGradient: boolean;
  /** 程序化背景参数 */
  bg: {
    top: string;
    mid: string;
    bottom: string;
    grid: string;
    gridOpacity: number;
    particle: string;
    beam: string;
    vignette: string;
    vignetteOpacity: number;
  };
  /** 三层径向光晕的不透明度 */
  glowOpacity: [number, number, number];
  /** 品牌位文字色（不填则用 text） */
  brandText?: string;
  /** 标题字体：display = 标题体（艺术字），sans = 无衬线黑体（现代科技风） */
  titleFont?: 'display' | 'sans';
  /** 有机背景配色（只有 background='organic' 的调色板需要） */
  organic?: {
    /** 底色（渐变起点） */
    base: string;
    /** 底色（渐变终点） */
    base2: string;
    /** 大块浅绿 */
    shapeA: string;
    /** 更淡的绿 / 辅助块 */
    shapeB: string;
    /** 亮黄强调块 */
    accent: string;
    /** 装饰圆点 */
    dot: string;
  };
  /** 极光背景配色（只有 background='aurora' 的调色板需要） */
  aurora?: {
    /** 画布底色 */
    base: string;
    /** 底部地台渐变色标（支持多档，如 青 → 深蓝 → 紫） */
    ground: string[];
    /** 三团极光的颜色与不透明度 */
    glows: Array<{ color: string; opacity: number }>;
    /** 地台顶端位置（相对画布高度），默认 0.78 */
    groundTop?: number;
    /** 地台高度（相对画布高度），默认 0.22 */
    groundHeight?: number;
    /** 地台底部压暗强度（0~1），默认 0.5 */
    groundShade?: number;
    /** 地台顶部的浅色叠层（多档色标，与 ground 同序）：模拟「地面远端发亮」 */
    groundTopTint?: string[];
    /** 地台顶部浅色叠层的不透明度（默认 0） */
    groundTopTintOpacity?: number;
    /** 地台顶部浅色叠层的衰减比例（相对地台高度，默认 0.45） */
    groundTopTintFade?: number;
    /** 极光光晕位置（相对画布） */
    blobs?: Array<{ cx: number; cy: number; rx: number; ry: number }>;
  };
  /**
   * 面板块内的反色调色板（白底深字）。
   *
   * 为什么需要：一张海报里可能同时存在「深色画布 + 浅色内容」和
   * 「浅色面板 + 深色内容」两种语境，一套 text / gold 颜色管不了。
   * panel 块会用这里的颜色渲染子块（蓝底海报里的白色信息卡就是这种）。
   */
  card?: {
    text: string;
    textDim: string;
    textFaint: string;
    gold: string;
    goldSoft: string;
    goldFaint: string;
    cardFill: string;
    cardStroke: string;
    chipFill: string;
    chipText: string;
    rail: string;
    divider: string;
    titleStops: string[];
    titleStroke: string;
    titleStrokeWidth: number;
    titleShadow: boolean;
    accentStops: string[];
    accentGradient: boolean;
    cardOpacity: number;
  };
}

/**
 * 全局调色板（唯一颜色真源）。
 *
 * 导出给 HTML 管线复用：`scripts/lib/poster-html-blocks.ts` 直接读这里，
 * 避免在 CSS / TS 里各抄一份颜色导致两边漂移。渲染逻辑本身不依赖导出。
 */
export const PALETTES: Record<PosterTone, PosterPalette> = {
  black_gold: {
    gold: '#F0BC4A',
    brandText: '#2A1E08',
    goldSoft: '#FFE7A8',
    goldFaint: '#8A6A22',
    titleStops: ['#FFFBE8', '#FFE49A', '#EFB024', '#8A5704', '#D79A18', '#FFD96B', '#FFF4CC'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#F5F5F7',
    textDim: '#C9C9D0',
    textFaint: '#8E8E99',
    cardFill: '#121218',
    cardStroke: '#3A2E12',
    chipFill: '#1C1710',
    chipText: '#FFD277',
    rail: '#6B4E14',
    divider: '#2A2A33',
    scrim: '#05060A',
    scrimOpacity: [0.8, 0.68, 0.86],
    glow: '#F0BC4A',
    glow2: '#C98C10',
    glow3: '#7A4A03',
    titleStroke: '#1A1204',
    titleStrokeWidth: 0.032,
    titleShadow: true,
    accentStops: ['#F0BC4A', '#FFE7A8', '#C98C10'],
    cardOpacity: 0.86,
    accentGradient: false,
    bg: {
      top: '#0C0A06',
      mid: '#080705',
      bottom: '#040302',
      grid: '#FFFFFF',
      gridOpacity: 0.03,
      particle: '#F0BC4A',
      beam: '#F0BC4A',
      vignette: '#000000',
      vignetteOpacity: 0.52,
    },
    glowOpacity: [0.34, 0.2, 0.13],
  },
  blue_purple: {
    gold: '#8FA6FF',
    brandText: '#1A1040',
    goldSoft: '#DDE6FF',
    goldFaint: '#3A3670',
    titleStops: ['#FFFFFF', '#EAF1FF', '#C3D6FF', '#4B3FA8', '#A78BFA', '#DDE6FF', '#FFFFFF'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#F3F5FF',
    textDim: '#C6CCEC',
    textFaint: '#8A90B8',
    cardFill: '#11131F',
    cardStroke: '#2C2F52',
    chipFill: '#171A2C',
    chipText: '#B9C6FF',
    rail: '#3B3E6B',
    divider: '#242640',
    scrim: '#05060A',
    scrimOpacity: [0.8, 0.68, 0.86],
    glow: '#8FA6FF',
    glow2: '#5B4BB8',
    glow3: '#2A2350',
    titleStroke: '#0B0A1E',
    titleStrokeWidth: 0.032,
    titleShadow: true,
    accentStops: ['#8FA6FF', '#A78BFA', '#5B4BB8'],
    cardOpacity: 0.86,
    accentGradient: false,
    bg: {
      top: '#0A0B16',
      mid: '#080910',
      bottom: '#04050A',
      grid: '#FFFFFF',
      gridOpacity: 0.03,
      particle: '#8FA6FF',
      beam: '#8FA6FF',
      vignette: '#000000',
      vignetteOpacity: 0.52,
    },
    glowOpacity: [0.34, 0.2, 0.13],
  },
  /**
   * deep_blue —— 亿检链品牌色系（深海底 + 信任蓝 / 智能青 / 通过绿 / 暖珊瑚）。
   * 取自「亿检链 · 产品宣讲」设计规范：
   *   TRUST #1A4FE8 · CYAN #0DA7C7 · GREEN #22C99A · CORAL #FF6B5C
   *   BG_DEEP #060B1A · PANEL #141F3A · TEXT #E8EEF8 · MUTED #8A99B5
   */
  deep_blue: {
    gold: '#0DA7C7',
    brandText: '#0A142E',
    goldSoft: '#7FD9EA',
    goldFaint: '#2A4C6B',
    titleStops: ['#FFFFFF', '#DCE9FF', '#4FD3E7', '#1A4FE8', '#0DA7C7', '#22C99A', '#FF6B5C'],
    titleGradient: { x1: 0, y1: 0, x2: 1, y2: 0.15 },
    text: '#E8EEF8',
    textDim: '#C7D2E8',
    textFaint: '#8A99B5',
    cardFill: '#141F3A',
    cardStroke: '#2B3E66',
    chipFill: '#101B33',
    chipText: '#7FD9EA',
    rail: '#2A4C6B',
    divider: '#22304F',
    scrim: '#060B1A',
    scrimOpacity: [0.62, 0.5, 0.72],
    glow: '#1A4FE8',
    glow2: '#0DA7C7',
    glow3: '#FF6B5C',
    titleStroke: '#04070F',
    titleStrokeWidth: 0.032,
    titleShadow: true,
    accentStops: ['#1A4FE8', '#0DA7C7', '#22C99A', '#FF6B5C'],
    cardOpacity: 0.86,
    accentGradient: true,
    bg: {
      top: '#0A142E',
      mid: '#060B1A',
      bottom: '#04070F',
      grid: '#FFFFFF',
      gridOpacity: 0.03,
      particle: '#9FE3F2',
      beam: '#9FE3F2',
      vignette: '#000000',
      vignetteOpacity: 0.52,
    },
    glowOpacity: [0.34, 0.2, 0.13],
  },

  /**
   * warm_amber —— 暖色版（V2）。深蓝科技感偏冷，转化率上"暖"更容易拉近距离：
   * 奶油米底 + 琥珀金 + 暖橙 + 珊瑚，参考「重要提醒」提醒卡的暖调。
   * 浅底上标题不能加发光阴影、也不能加深色描边，否则字会发灰糊掉。
   */
  warm_amber: {
    gold: '#F08A24',
    brandText: '#7A4A16',
    goldSoft: '#C2550F',
    goldFaint: '#E8C89A',
    titleStops: ['#B3261E', '#E04A1B', '#F08A24', '#F7B733', '#E86A1E'],
    titleGradient: { x1: 0, y1: 0, x2: 1, y2: 0.15 },
    text: '#3B2A1C',
    textDim: '#6E5744',
    textFaint: '#9A8069',
    cardFill: '#FFFDF7',
    cardStroke: '#E7CFA5',
    chipFill: '#FCEBD0',
    chipText: '#C2550F',
    rail: '#E0B87A',
    divider: '#EBD9BC',
    scrim: '#FFF3E2',
    scrimOpacity: [0.22, 0.16, 0.28],
    glow: '#F5A623',
    glow2: '#FF6B5C',
    glow3: '#E0A63C',
    titleStroke: '#FFF6E8',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#F08A24', '#F7B733', '#FF6B5C', '#E04A1B'],
    cardOpacity: 1,
    accentGradient: true,
    bg: {
      top: '#FFF9F0',
      mid: '#FCEBD2',
      bottom: '#F6DDB6',
      grid: '#B4763A',
      gridOpacity: 0.03,
      particle: '#E8A33D',
      beam: '#FFD9A0',
      vignette: '#8A4A12',
      vignetteOpacity: 0.1,
    },
    glowOpacity: [0.18, 0.11, 0.08],
  },

  /**
   * classic_blue —— 经典商务蓝（V4）。
   * 宝蓝主色 + 经典金点缀：比 deep_blue 的多彩青绿渐变更沉稳、更像企业级技术课，
   * 标题走纵向金属金渐变 + 深蓝描边，卡片用半透明宝蓝浮在深蓝渐变背景上。
   *   BLUE #123A86 / #0A2455 / #050F28（背景三段）
   *   GOLD #E8B24C（强调）　TEXT #EEF3FC
   */
  classic_blue: {
    gold: '#E8B24C',
    brandText: '#0A2455',
    goldSoft: '#F7DFA8',
    goldFaint: '#7A5A22',
    titleStops: ['#FFFFFF', '#F4F8FF', '#DDE9FC', '#E8B24C', '#F7DFA8', '#C08C28', '#FFF6E2'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#EEF3FC',
    textDim: '#C2D0E8',
    textFaint: '#8496B8',
    cardFill: '#0E2A5C',
    cardStroke: '#2B4E93',
    chipFill: '#122E68',
    chipText: '#F0C878',
    rail: '#2B4E93',
    divider: '#1D3A72',
    scrim: '#05102A',
    scrimOpacity: [0.66, 0.54, 0.76],
    glow: '#2F6BD8',
    glow2: '#1A4FA8',
    glow3: '#0B2A6B',
    titleStroke: '#04102A',
    titleStrokeWidth: 0.028,
    titleShadow: true,
    accentStops: ['#E8B24C', '#F7DFA8', '#C08C28'],
    cardOpacity: 0.88,
    accentGradient: false,
    bg: {
      top: '#123A86',
      mid: '#0A2455',
      bottom: '#050F28',
      grid: '#FFFFFF',
      gridOpacity: 0.032,
      particle: '#9FC0FF',
      beam: '#CFE0FF',
      vignette: '#000000',
      vignetteOpacity: 0.5,
    },
    glowOpacity: [0.32, 0.19, 0.12],
  },

  /**
   * pure_white —— 纯白底（视频号小店「纯色底图」用）。
   *
   * 平台自带 AI 抠图会把深底海报的白字抠成“隐形”，所以浅底版本必须
   * 从源头重新配色：文字一律深色，强调色压深，背景绝对平涂无纹理。
   */
  pure_white: {
    gold: '#B07C1F',
    brandText: '#123A2B',
    goldSoft: '#8A5F14',
    goldFaint: '#E7CE9A',
    titleStops: ['#0A2455', '#123A86', '#1E5CB8', '#0A2455'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#12243F',
    textDim: '#41598A',
    textFaint: '#8FA0BF',
    cardFill: '#F4F7FC',
    cardStroke: '#D6E1F2',
    chipFill: '#EDF2FA',
    chipText: '#123A86',
    rail: '#C9D8EF',
    divider: '#E4EBF6',
    scrim: '#FFFFFF',
    scrimOpacity: [0, 0, 0],
    glow: '#FFFFFF',
    glow2: '#FFFFFF',
    glow3: '#FFFFFF',
    titleStroke: '#FFFFFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#B07C1F', '#E8B24C', '#8A5F14'],
    cardOpacity: 1,
    accentGradient: false,
    bg: {
      top: '#FFFFFF',
      mid: '#FFFFFF',
      bottom: '#FFFFFF',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#FFFFFF',
      beam: '#FFFFFF',
      vignette: '#FFFFFF',
      vignetteOpacity: 0,
    },
    glowOpacity: [0, 0, 0],
  },

  /**
   * pure_blue —— 纯宝蓝底（视频号小店「纯色底图」用，深色版）。
   *
   * 与 classic_blue 的区别：背景是绝对平涂的 #123A86，没有渐变、
   * 网格、粒子和暗角，主体（标题 / 数值卡）对比更硬更聚焦。
   */
  pure_blue: {
    gold: '#E8B24C',
    brandText: '#0A2455',
    goldSoft: '#F7DFA8',
    goldFaint: '#7A5A22',
    titleStops: ['#FFFFFF', '#F4F8FF', '#DDE9FC', '#E8B24C', '#F7DFA8', '#C08C28', '#FFF6E2'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#EEF3FC',
    textDim: '#C2D0E8',
    textFaint: '#8496B8',
    cardFill: '#0A2455',
    cardStroke: '#2B4E93',
    chipFill: '#122E68',
    chipText: '#F0C878',
    rail: '#2B4E93',
    divider: '#1D3A72',
    scrim: '#123A86',
    scrimOpacity: [0, 0, 0],
    glow: '#2F6BD8',
    glow2: '#1A4FA8',
    glow3: '#0B2A6B',
    titleStroke: '#04102A',
    titleStrokeWidth: 0.028,
    titleShadow: true,
    accentStops: ['#E8B24C', '#F7DFA8', '#C08C28'],
    cardOpacity: 0.9,
    accentGradient: false,
    bg: {
      top: '#123A86',
      mid: '#123A86',
      bottom: '#123A86',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#123A86',
      beam: '#123A86',
      vignette: '#123A86',
      vignetteOpacity: 0,
    },
    glowOpacity: [0.28, 0.16, 0.1],
  },

  /**
   * fresh_green —— 清新绿（V7 主视觉）。
   *
   * 取色自参考图（奶油底 + 浅绿有机块 + 亮黄点缀 + 草绿标题 + 深青正文）：
   *   CREAM #FDFCF0（底）　LIGHT GREEN #CDE9A8（大块）　YELLOW #FFC93C（点缀）
   *   GRASS #5CB02F（装饰）　DEEP TEAL #1B3D2E（正文）　DOT #8CC63F（圆点）
   *
   * 浅底铁律：
   *   1. 标题不加描边、不加发光阴影（否则字发灰）
   *   2. 小标签文字用深绿 goldSoft，装饰色另走 accentStops
   *   3. 正文用深青 text / textDim，弱信息用 textFaint（都 ≥ 4.5:1）
   *   4. 网格 / 粒子 / 光束 / 暗角全关，底图交给有机色块
   */
  fresh_green: {
    gold: '#3A8619',
    goldSoft: '#2A6E12',
    goldFaint: '#CDE9A8',
    titleStops: ['#3E8E1F', '#357C18', '#2A6E12'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#1B3D2E',
    textDim: '#3A5A4A',
    textFaint: '#5A7A6C',
    cardFill: '#FFFFFF',
    cardStroke: '#D8E9C4',
    chipFill: '#EAF6DC',
    chipText: '#2A6E12',
    rail: '#B7D98F',
    divider: '#DCE9C9',
    scrim: '#FFFFFF',
    scrimOpacity: [0, 0, 0],
    glow: '#CDE9A8',
    glow2: '#FFE9A3',
    glow3: '#A9D98B',
    titleStroke: '#FFFFFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#5CB02F', '#8CC63F', '#FFC93C'],
    cardOpacity: 1,
    accentGradient: true,
    brandText: '#1B3D2E',
    organic: {
      base: '#FDFCF0',
      base2: '#EFF6DE',
      shapeA: '#CDE9A8',
      shapeB: '#E4F1D0',
      accent: '#FFC93C',
      dot: '#8CC63F',
    },
    bg: {
      top: '#FDFCF0',
      mid: '#F8FBEC',
      bottom: '#EFF6DE',
      grid: '#5CB02F',
      gridOpacity: 0,
      particle: '#8CC63F',
      beam: '#FFC93C',
      vignette: '#4A7A50',
      vignetteOpacity: 0,
    },
    glowOpacity: [0, 0, 0],
  },

  /**
   * pure_fresh —— 清新绿 · 纯白底（浅底纯色图）。
   * 平台 AI 抠图会把深底海报的白字抠成“隐形”，浅底必须从源头重排。
   */
  pure_fresh: {
    gold: '#357C18',
    goldSoft: '#2A6E12',
    goldFaint: '#CDE9A8',
    titleStops: ['#3E8E1F', '#357C18', '#2A6E12'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#1B3D2E',
    textDim: '#3A5A4A',
    textFaint: '#5A7A6C',
    cardFill: '#F6FBF0',
    cardStroke: '#D8E9C4',
    chipFill: '#EAF6DC',
    chipText: '#2A6E12',
    rail: '#B7D98F',
    divider: '#DCE9C9',
    scrim: '#FFFFFF',
    scrimOpacity: [0, 0, 0],
    glow: '#FFFFFF',
    glow2: '#FFFFFF',
    glow3: '#FFFFFF',
    titleStroke: '#FFFFFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#5CB02F', '#8CC63F', '#FFC93C'],
    cardOpacity: 1,
    accentGradient: false,
    brandText: '#1B3D2E',
    bg: {
      top: '#FFFFFF',
      mid: '#FFFFFF',
      bottom: '#FFFFFF',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#FFFFFF',
      beam: '#FFFFFF',
      vignette: '#FFFFFF',
      vignetteOpacity: 0,
    },
    glowOpacity: [0, 0, 0],
  },

  /**
   * pure_green —— 清新绿 · 纯深绿底（深底纯色图）。
   * 礼物 / 推荐位缩略图里对比更硬，主推用。
   */
  pure_green: {
    gold: '#FFD75E',
    goldSoft: '#FFE9A3',
    goldFaint: '#14543A',
    titleStops: ['#FFFFFF', '#F2FBF3', '#CDE9A8', '#FFD75E'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#F2FAF4',
    textDim: '#C6E3D2',
    textFaint: '#A9CDB8',
    cardFill: '#175938',
    cardStroke: '#2E7A55',
    chipFill: '#1A6341',
    chipText: '#FFD98A',
    rail: '#2E7A55',
    divider: '#2A6E4E',
    scrim: '#1F6B45',
    scrimOpacity: [0, 0, 0],
    glow: '#2E7A55',
    glow2: '#FFD75E',
    glow3: '#14543A',
    titleStroke: '#0E3D28',
    titleStrokeWidth: 0.018,
    titleShadow: false,
    accentStops: ['#FFD75E', '#FFE9A3', '#8CC63F'],
    cardOpacity: 0.92,
    accentGradient: false,
    brandText: '#1B3D2E',
    bg: {
      top: '#1F6B45',
      mid: '#1F6B45',
      bottom: '#1F6B45',
      grid: '#1F6B45',
      gridOpacity: 0,
      particle: '#1F6B45',
      beam: '#1F6B45',
      vignette: '#1F6B45',
      vignetteOpacity: 0,
    },
    glowOpacity: [0.2, 0.12, 0.08],
  },

  /**
   * pure_cream —— 暖色琥珀 · 纯米白底（浅底纯色图）。
   */
  pure_cream: {
    gold: '#B07C1F',
    goldSoft: '#8A5F14',
    goldFaint: '#E7CE9A',
    titleStops: ['#C2550F', '#A33A10', '#8A5F14'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#3B2A1C',
    textDim: '#6E5744',
    textFaint: '#9A8069',
    cardFill: '#FFFDF7',
    cardStroke: '#E7CFA5',
    chipFill: '#FCEBD0',
    chipText: '#8A5F14',
    rail: '#E0B87A',
    divider: '#EBD9BC',
    scrim: '#FFFFFF',
    scrimOpacity: [0, 0, 0],
    glow: '#FFFFFF',
    glow2: '#FFFFFF',
    glow3: '#FFFFFF',
    titleStroke: '#FFFFFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#F08A24', '#F7B733', '#E04A1B'],
    cardOpacity: 1,
    accentGradient: false,
    brandText: '#7A4A16',
    bg: {
      top: '#FFFFFF',
      mid: '#FFFFFF',
      bottom: '#FFFFFF',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#FFFFFF',
      beam: '#FFFFFF',
      vignette: '#FFFFFF',
      vignetteOpacity: 0,
    },
    glowOpacity: [0, 0, 0],
  },

  /**
   * pure_warm —— 暖色琥珀 · 纯深琥珀底（深底纯色图）。
   */
  pure_warm: {
    gold: '#F5A623',
    goldSoft: '#FFE0A8',
    goldFaint: '#7A4A16',
    titleStops: ['#FFF6E8', '#FFE0A8', '#F5A623', '#E07B18', '#FFF0D4'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#FFF4E4',
    textDim: '#E8CBA4',
    textFaint: '#C6A882',
    cardFill: '#3A2209',
    cardStroke: '#6B431C',
    chipFill: '#43270C',
    chipText: '#FFD08A',
    rail: '#6B431C',
    divider: '#5A3A17',
    scrim: '#4A2C10',
    scrimOpacity: [0, 0, 0],
    glow: '#6B431C',
    glow2: '#F5A623',
    glow3: '#3A2209',
    titleStroke: '#2A1806',
    titleStrokeWidth: 0.018,
    titleShadow: false,
    accentStops: ['#F5A623', '#FFD08A', '#E07B18'],
    cardOpacity: 0.9,
    accentGradient: false,
    brandText: '#7A4A16',
    bg: {
      top: '#4A2C10',
      mid: '#4A2C10',
      bottom: '#4A2C10',
      grid: '#4A2C10',
      gridOpacity: 0,
      particle: '#4A2C10',
      beam: '#4A2C10',
      vignette: '#4A2C10',
      vignetteOpacity: 0,
    },
    glowOpacity: [0.2, 0.12, 0.08],
  },

  /**
   * tech_light —— 浅色科技风（直播间封面）。
   *
   * 取自参考图：近白底 + 底部蓝/青/紫极光 + 蓝色地台；
   * 标题为近黑纯色（浅底不加描边、不加发光阴影，否则字会发灰）。
   */
  tech_light: {
    gold: '#168CFF',
    goldSoft: '#45DDF3',
    goldFaint: '#C9E2FF',
    titleStops: ['#14181F', '#0A0A0B', '#1D2836'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#171719',
    textDim: '#4C525B',
    textFaint: '#8A909A',
    cardFill: '#FFFFFF',
    cardStroke: '#E4E9F2',
    chipFill: '#EDF4FF',
    chipText: '#168CFF',
    rail: '#C9E2FF',
    divider: '#E4E9F2',
    scrim: '#FFFFFF',
    scrimOpacity: [0, 0, 0],
    glow: '#168CFF',
    glow2: '#45DDF3',
    glow3: '#8A55F7',
    titleStroke: '#FFFFFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#168CFF', '#45DDF3', '#8A55F7'],
    cardOpacity: 1,
    accentGradient: true,
    brandText: '#171719',
    titleFont: 'sans',
    bg: {
      top: '#FBFBFC',
      mid: '#F6F8FB',
      bottom: '#FFFFFF',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#45DDF3',
      beam: '#45DDF3',
      vignette: '#FFFFFF',
      vignetteOpacity: 0,
    },
    glowOpacity: [0.16, 0.13, 0.12],
    aurora: {
      base: '#FFFFFF',
      ground: ['#1E63FF', '#1B44C8', '#7A45E8', '#C46BFF'],
      groundTop: 0.79,
      groundHeight: 0.21,
      groundShade: 0.38,
      groundTopTint: ['#7FD4FF', '#8FB4FF', '#9C8CFF', '#E5BCFF'],
      groundTopTintOpacity: 0.8,
      groundTopTintFade: 0.45,
      glows: [
        { color: '#45DDF3', opacity: 0.62 },
        { color: '#A855F7', opacity: 0.55 },
        { color: '#168CFF', opacity: 0.24 },
      ],
      blobs: [
        { cx: 0.06, cy: 0.64, rx: 0.36, ry: 0.22 },
        { cx: 0.97, cy: 0.84, rx: 0.34, ry: 0.2 },
        { cx: 0.5, cy: 0.9, rx: 0.5, ry: 0.16 },
      ],
    },
    card: {
      text: '#171719',
      textDim: '#5A6069',
      textFaint: '#9AA0AA',
      gold: '#168CFF',
      goldSoft: '#45DDF3',
      goldFaint: '#C9E2FF',
      cardFill: '#F5F9FF',
      cardStroke: '#E4E9F2',
      chipFill: '#EDF4FF',
      chipText: '#168CFF',
      rail: '#C9E2FF',
      divider: '#E4E9F2',
      titleStops: ['#14181F', '#0A0A0B', '#1D2836'],
      titleStroke: '#FFFFFF',
      titleStrokeWidth: 0,
      titleShadow: false,
      accentStops: ['#168CFF', '#45DDF3', '#8A55F7'],
      accentGradient: true,
      cardOpacity: 1,
    },
  },

  /**
   * solid_blue —— 纯色亮蓝（信息型海报）。
   *
   * 通栏蓝底 + 白字标题；中部白色信息卡用 card 反色调色板渲染子块。
   */
  solid_blue: {
    gold: '#FFFFFF',
    goldSoft: '#DCEAFF',
    goldFaint: '#BBD8FF',
    titleStops: ['#FFFFFF', '#EAF3FF', '#FFFFFF'],
    titleGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
    text: '#FFFFFF',
    textDim: '#D6E7FF',
    textFaint: '#DCEBFF',
    cardFill: '#FFFFFF',
    cardStroke: '#FFFFFF',
    chipFill: '#E8F1FF',
    chipText: '#007AFF',
    rail: '#BBD8FF',
    divider: '#D6E7FF',
    scrim: '#007AFF',
    scrimOpacity: [0, 0, 0],
    glow: '#45DDF3',
    glow2: '#8A55F7',
    glow3: '#168CFF',
    titleStroke: '#007AFF',
    titleStrokeWidth: 0,
    titleShadow: false,
    accentStops: ['#007AFF', '#168CFF'],
    cardOpacity: 1,
    accentGradient: false,
    brandText: '#FFFFFF',
    titleFont: 'sans',
    bg: {
      top: '#007AFF',
      mid: '#007AFF',
      bottom: '#007AFF',
      grid: '#FFFFFF',
      gridOpacity: 0,
      particle: '#FFFFFF',
      beam: '#FFFFFF',
      vignette: '#0456B8',
      vignetteOpacity: 0,
    },
    glowOpacity: [0.12, 0.1, 0.08],
    card: {
      text: '#1A1A1A',
      textDim: '#6F7378',
      textFaint: '#9AA0A8',
      gold: '#007AFF',
      goldSoft: '#45DDF3',
      goldFaint: '#CDE4FF',
      cardFill: '#F5F7FB',
      cardStroke: '#E6EEF9',
      chipFill: '#E8F1FF',
      chipText: '#007AFF',
      rail: '#CDE4FF',
      divider: '#E6EEF9',
      titleStops: ['#007AFF', '#0A6FE0', '#168CFF'],
      titleStroke: '#FFFFFF',
      titleStrokeWidth: 0,
      titleShadow: false,
      accentStops: ['#007AFF', '#168CFF'],
      accentGradient: false,
      cardOpacity: 1,
    },
  },
};

const TITLE_FONT =
  "'YouSheBiaoTiHei', 'STKaiti', 'Kaiti SC', 'Hiragino Sans GB', 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
const BODY_FONT =
  "'PingFang SC', 'Hiragino Sans GB', 'Heiti SC', 'Noto Sans CJK SC', 'Microsoft YaHei', Arial, sans-serif";

/** 按配色方案取标题字体（科技风用无衬线，课程/商品图用标题体） */
function titleFamily(pal: PosterPalette): string {
  return pal.titleFont === 'sans' ? BODY_FONT : TITLE_FONT;
}

// ============ 基础工具 ============

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 估算文本宽度（以字号为单位） */
function textUnits(value: string): number {
  let units = 0;
  for (const char of value) {
    if (/\s/.test(char)) units += 0.3;
    else if (/[\u2e80-\u9fff\uff00-\uffef]/.test(char)) units += 1;
    else if (/[A-Z0-9]/.test(char)) units += 0.62;
    else units += 0.52;
  }
  return units;
}

function textWidth(value: string, size: number): number {
  return textUnits(value) * size;
}

/** 数字 + 单位视为一个不可拆单元（避免出现 "8 / 处" 这种断行） */
const UNIT_CHARS = '处个天元年月日次倍层步项种类台份套条张件单人%';

/** 把文本切成"不可拆单元"序列 */
function tokenizeUnits(value: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < value.length) {
    const char = value[index];
    if (/[0-9]/.test(char)) {
      let end = index;
      while (end < value.length && /[0-9.,]/.test(value[end])) end += 1;
      let unit = end;
      if (value[unit] === ' ') unit += 1;
      if (unit < value.length && UNIT_CHARS.includes(value[unit])) unit += 1;
      tokens.push(value.slice(index, unit));
      index = unit;
      continue;
    }
    tokens.push(char);
    index += 1;
  }
  return tokens;
}

/**
 * 按像素宽度折行。
 * - 支持显式 \n 断行（标题按语义分行，避免尾字孤行）
 * - 数字+单位、英文单词不拆开
 */
function wrapText(value: string, maxWidth: number, size: number, maxLines: number): string[] {
  const text = String(value ?? '').replace(/[ \t]+/g, ' ').trim();
  if (!text) return [];
  const limit = Math.max(1, maxWidth / size);
  const lines: string[] = [];

  for (const paragraph of text.split('\n')) {
    const tokens = tokenizeUnits(paragraph.trim());
    let line = '';
    let width = 0;
    for (const token of tokens) {
      const tokenWidth = textUnits(token);
      if (line && width + tokenWidth > limit) {
        lines.push(line);
        line = '';
        width = 0;
        if (lines.length === maxLines) break;
      }
      line += token;
      width += tokenWidth;
    }
    if (lines.length < maxLines && line.trim()) lines.push(line.trim());
    if (lines.length >= maxLines) break;
  }

  // 超出 maxLines 时，最后一行补省略号
  if (lines.length === maxLines) {
    const consumed = lines.join('').replace(/\s/g, '').length;
    const expected = text.replace(/\s/g, '').length;
    if (consumed < expected) {
      lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[。、，,]$/, '')}…`;
    }
  }
  return lines;
}

interface TextElOptions {
  x: number;
  y: number;
  text: string;
  size: number;
  fill: string;
  weight?: number;
  anchor?: 'start' | 'middle' | 'end';
  family?: string;
  opacity?: number;
  letterSpacing?: number;
  stroke?: string;
  strokeWidth?: number;
  filterId?: string;
}

function textEl(options: TextElOptions): string {
  const {
    x, y, text, size, fill,
    weight = 600,
    anchor = 'start',
    family = BODY_FONT,
    opacity = 1,
    letterSpacing,
    stroke,
    strokeWidth = 0,
    filterId,
  } = options;
  const strokeAttr = stroke ? ` stroke="${stroke}" stroke-width="${strokeWidth}" paint-order="stroke fill"` : '';
  const spacingAttr = letterSpacing ? ` letter-spacing="${letterSpacing.toFixed(2)}"` : '';
  const filterAttr = filterId ? ` filter="url(#${filterId})"` : '';
  return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-family="${family}" font-size="${size.toFixed(1)}" font-weight="${weight}"${spacingAttr} fill="${fill}" fill-opacity="${opacity}"${strokeAttr}${filterAttr}>${esc(text)}</text>`;
}

function linesEl(
  lines: string[],
  x: number,
  firstBaseline: number,
  lineHeight: number,
  options: Omit<TextElOptions, 'x' | 'y' | 'text'>,
): string {
  if (!lines.length) return '';
  const attrs = textEl({ ...options, x, y: firstBaseline, text: '' });
  const head = attrs.slice(0, attrs.indexOf('>') + 1);
  const tail = attrs.slice(attrs.indexOf('>') + 1);
  const body = lines
    .map((line, index) => `<tspan x="${x.toFixed(1)}" dy="${index === 0 ? 0 : lineHeight}">${esc(line)}</tspan>`)
    .join('');
  return `${head}${body}${tail}`;
}

interface BlockContext {
  W: number;
  contentW: number;
  padX: number;
  pal: PosterPalette;
  /** 目标成品高度（给了 fit 时才有），用于 heightRatio 这类相对高度的占位 */
  H?: number;
  /** 标题渐变的 SVG id（面板块内用另一套颜色） */
  titleGradientId?: string;
}

const GAP = (W: number, ratio: number): number => W * ratio;

/**
 * 块间距：默认 W*0.058，可被块的 gapAfter / 下一块的 gapBefore 覆盖（成品像素）。
 *
 * 为什么需要：1:1 复刻参考版式时，每两个元素之间的留白都要对齐到参考图的
 * 具体像素，默认间距做不到。
 */
function blockGapOf(blocks: PosterBlock[], index: number, defaultGap: number): number {
  const cur = blocks[index] as any;
  const next = blocks[index + 1] as any;
  if (typeof next?.gapBefore === 'number') return next.gapBefore;
  if (typeof cur?.gapAfter === 'number') return cur.gapAfter;
  return defaultGap;
}

// ============ 块渲染器（局部坐标，由外层 <g> 平移）============

function renderHero(block: Extract<PosterBlock, { kind: 'hero' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const parts: string[] = [];
  let y = 0;

  if (block.kicker) {
    const size = W * 0.028;
    const lineW = W * 0.055;
    parts.push(
      `<rect x="${padX}" y="${(y + size * 0.28).toFixed(1)}" width="${lineW.toFixed(1)}" height="${Math.max(2, W * 0.004).toFixed(1)}" fill="${pal.gold}"/>`,
      textEl({ x: padX + lineW + W * 0.022, y: y + size, text: block.kicker, size, fill: pal.goldSoft, weight: 700, letterSpacing: size * 0.12 }),
    );
    y += size * 1.9;
  }

  const titleSize = W * 0.072;
  const titleLines = wrapText(block.title, contentW, titleSize, 3);
  const titleLineHeight = titleSize * 1.22;
  parts.push(
    linesEl(titleLines, padX, y + titleSize, titleLineHeight, {
      size: titleSize,
      fill: `url(#${ctx.titleGradientId ?? 'posterTitle'})`,
      weight: 800,
      family: titleFamily(pal),
      stroke: pal.titleStrokeWidth > 0 ? pal.titleStroke : undefined,
      strokeWidth: Math.max(1.4, titleSize * pal.titleStrokeWidth),
      filterId: pal.titleShadow ? 'posterGlowF' : undefined,
    }),
  );
  y += titleSize + (titleLines.length - 1) * titleLineHeight + W * 0.028;

  if (block.subtitle) {
    const size = W * 0.031;
    const lines = wrapText(block.subtitle, contentW * 0.96, size, 3);
    const lineHeight = size * 1.5;
    parts.push(
      linesEl(lines, padX, y + size, lineHeight, { size, fill: pal.text, weight: 500, opacity: 0.94 }),
    );
    y += size + (lines.length - 1) * lineHeight + W * 0.02;
  }

  if (block.badges?.length) {
    const size = W * 0.024;
    const padH = size * 0.9;
    const gap = size * 0.55;
    const chipH = size * 1.85;
    let cursor = padX;
    for (const badge of block.badges) {
      const chipW = textWidth(badge, size) + padH * 2;
      parts.push(
        `<rect x="${cursor.toFixed(1)}" y="${y.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${pal.chipFill}" stroke="${pal.gold}" stroke-opacity="0.55" stroke-width="1.5"/>`,
        textEl({ x: cursor + chipW / 2, y: y + chipH * 0.68, text: badge, size, fill: pal.chipText, weight: 600, anchor: 'middle' }),
      );
      cursor += chipW + gap;
    }
    y += chipH;
  }

  return { height: y, svg: parts.join('') };
}

/**
 * 大标题自适应字号：在 maxW 内尽量放大，直到最长行刚好装下。
 *
 * 关键：以「显式 \n 分段」为单位计算宽度，而不是用自动折行的结果——
 * 否则一旦自动折行把「自我进化训练营」拆成两行，宽度就变“合格”了，
 * 字号永远不会缩小，词组反而被拆开。
 */
function fitTitleSize(
  text: string,
  maxW: number,
  startSize: number,
  minSize: number,
): { size: number; lines: string[] } {
  const segments = text
    .split('\n')
    .map((segment) => segment.trim())
    .filter(Boolean);
  let size = startSize;
  for (let i = 0; i < 24; i += 1) {
    const widest = segments.reduce((max, segment) => Math.max(max, textWidth(segment, size)), 0);
    if (widest <= maxW || size <= minSize) break;
    const next = Math.max(minSize, (size * maxW) / widest * 0.985);
    if (Math.abs(next - size) < 0.5) break;
    size = next;
  }
  // 正常情况下每段一行；万一单段仍然超宽，允许它折行
  const lines: string[] = [];
  for (const segment of segments) lines.push(...wrapText(segment, maxW, size, 2));
  return { size, lines };
}

/**
 * 封面标题版式：英文小标 → 顶部短标 → 超大主标题 → 渐变短线 → 副标题 → 数值卡 → 胶囊徽章
 */
function renderTitle(block: Extract<PosterBlock, { kind: 'title' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const spec = block.spec;
  const parts: string[] = [];
  let y = 0;

  if (spec.enLabel) {
    const size = W * 0.0185;
    parts.push(
      textEl({
        x: padX,
        y: y + size,
        text: spec.enLabel,
        size,
        fill: pal.gold,
        weight: 700,
        letterSpacing: size * 0.46,
        opacity: 0.85,
      }),
    );
    y += size * 1.95;
  }

  if (spec.eyebrow) {
    const size = W * 0.028;
    const lineW = W * 0.055;
    parts.push(
      `<rect x="${padX}" y="${(y + size * 0.28).toFixed(1)}" width="${lineW.toFixed(1)}" height="${Math.max(2, W * 0.004).toFixed(1)}" fill="${pal.gold}"/>`,
      textEl({
        x: padX + lineW + W * 0.022,
        y: y + size,
        text: spec.eyebrow,
        size,
        fill: pal.goldSoft,
        weight: 700,
        letterSpacing: size * 0.12,
      }),
    );
    y += size * 1.95;
  }

  // 超大主标题
  const { size: titleSize, lines: titleLines } = fitTitleSize(spec.title, contentW * 0.86, W * 0.142, W * 0.06);
  const titleLineHeight = titleSize * 1.2;
  parts.push(
    linesEl(titleLines, padX, y + titleSize, titleLineHeight, {
      size: titleSize,
      fill: `url(#${ctx.titleGradientId ?? 'posterTitle'})`,
      weight: 800,
      family: titleFamily(pal),
      stroke: pal.titleStrokeWidth > 0 ? pal.titleStroke : undefined,
      strokeWidth: Math.max(1.4, titleSize * pal.titleStrokeWidth),
      filterId: pal.titleShadow ? 'posterGlowF' : undefined,
    }),
  );
  y += titleSize + (titleLines.length - 1) * titleLineHeight + W * 0.03;

  // 渐变短线
  const ruleW = W * 0.17;
  const ruleH = Math.max(3, W * 0.0055);
  parts.push(
    `<rect x="${padX}" y="${y.toFixed(1)}" width="${ruleW.toFixed(1)}" height="${ruleH.toFixed(1)}" rx="${(ruleH / 2).toFixed(1)}" fill="url(#posterAccent)"/>`,
  );
  y += ruleH + W * 0.034;

  if (spec.subtitle) {
    const size = W * 0.033;
    const lines = wrapText(spec.subtitle, contentW * 0.96, size, 3);
    const lineHeight = size * 1.52;
    parts.push(
      linesEl(lines, padX, y + size, lineHeight, { size, fill: pal.text, weight: 500, opacity: 0.94 }),
    );
    y += size + (lines.length - 1) * lineHeight + W * 0.03;
  }

  // 数值卡
  if (spec.stats?.length) {
    const stats = spec.stats;
    const gap = W * 0.028;
    const cardW = (contentW - gap * (stats.length - 1)) / stats.length;
    const cardH = W * 0.172;
    const radius = W * 0.018;
    const valueSize = W * 0.058;
    const labelSize = W * 0.0215;
    stats.forEach((stat, index) => {
      const x = padX + index * (cardW + gap);
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${pal.cardFill}" fill-opacity="${pal.cardOpacity}" stroke="${pal.cardStroke}" stroke-width="1.5"/>`,
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(cardW * 0.32).toFixed(1)}" height="${Math.max(3, W * 0.005).toFixed(1)}" rx="2" fill="url(#posterAccent)"/>`,
        textEl({
          x: x + cardW / 2,
          y: y + valueSize * 1.42,
          text: stat.value,
          size: valueSize,
          fill: `url(#${ctx.titleGradientId ?? 'posterTitle'})`,
          weight: 800,
          family: titleFamily(pal),
          anchor: 'middle',
        }),
        textEl({
          x: x + cardW / 2,
          y: y + cardH - W * 0.026,
          text: stat.label,
          size: labelSize,
          fill: pal.textDim,
          weight: 600,
          anchor: 'middle',
        }),
      );
    });
    y += cardH + W * 0.022;
  }

  // 胶囊徽章
  if (spec.badges?.length) {
    const size = W * 0.024;
    const padH = size * 0.9;
    const gap = size * 0.55;
    const chipH = size * 1.85;
    let cursor = padX;
    for (const badge of spec.badges) {
      const chipW = textWidth(badge, size) + padH * 2;
      parts.push(
        `<rect x="${cursor.toFixed(1)}" y="${y.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${pal.chipFill}" stroke="${pal.gold}" stroke-opacity="0.55" stroke-width="1.5"/>`,
        textEl({ x: cursor + chipW / 2, y: y + chipH * 0.68, text: badge, size, fill: pal.chipText, weight: 600, anchor: 'middle' }),
      );
      cursor += chipW + gap;
    }
    y += chipH;
  }

  return { height: y, svg: parts.join('') };
}

function renderSection(block: Extract<PosterBlock, { kind: 'section' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const parts: string[] = [];
  let y = 0;

  const labelSize = W * 0.024;
  parts.push(
    textEl({ x: padX, y: y + labelSize, text: block.label, size: labelSize, fill: pal.gold, weight: 800, letterSpacing: labelSize * 0.18 }),
  );
  y += labelSize * 1.55;

  const titleSize = W * 0.046;
  const titleLines = wrapText(block.title, contentW, titleSize, 2);
  const titleLineHeight = titleSize * 1.3;
  parts.push(
    linesEl(titleLines, padX, y + titleSize, titleLineHeight, {
      size: titleSize,
      fill: pal.text,
      weight: 800,
      family: titleFamily(pal),
    }),
  );
  y += titleSize + (titleLines.length - 1) * titleLineHeight;

  if (block.desc) {
    const size = W * 0.026;
    const lines = wrapText(block.desc, contentW * 0.98, size, 3);
    const lineHeight = size * 1.62;
    y += W * 0.022;
    parts.push(
      linesEl(lines, padX, y + size, lineHeight, { size, fill: pal.textDim, weight: 400, opacity: 0.92 }),
    );
    y += size + (lines.length - 1) * lineHeight;
  }

  return { height: y, svg: parts.join('') };
}

function renderCards(block: Extract<PosterBlock, { kind: 'cards' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const columns = Math.max(1, Math.min(3, block.columns ?? 3));
  const gap = W * 0.026;
  const cardW = (contentW - gap * (columns - 1)) / columns;
  const pad = W * 0.032;
  const radius = W * 0.018;

  const titleSize = W * 0.029;
  const bodySize = W * 0.0225;
  const tagSize = W * 0.0215;
  const bodyLineHeight = bodySize * 1.52;

  // 先算每张卡片的文字高度，行内取最大值为统一卡高
  const metrics = block.items.map((item) => {
    const titleLines = wrapText(item.title, cardW - pad * 2, titleSize, 2);
    const bodyLines = (item.lines ?? []).flatMap((line) => wrapText(line, cardW - pad * 2, bodySize, 4));
    const tagH = item.tag ? tagSize * 1.9 : 0;
    const contentH =
      tagH +
      (item.tag ? W * 0.014 : 0) +
      titleLines.length * titleSize * 1.32 +
      (bodyLines.length ? W * 0.018 : 0) +
      bodyLines.length * bodyLineHeight;
    return { item, titleLines, bodyLines, tagH, contentH };
  });

  const cardH = Math.max(...metrics.map((m) => m.contentH)) + pad * 2;
  const parts: string[] = [];
  const topAccent = W * 0.006;

  metrics.forEach((m, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = padX + col * (cardW + gap);
    const cardY = row * (cardH + gap);

    parts.push(
      `<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${pal.cardFill}" fill-opacity="${pal.cardOpacity}" stroke="${pal.cardStroke}" stroke-width="1.5"/>`,
      `<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${(cardW * 0.28).toFixed(1)}" height="${topAccent.toFixed(1)}" rx="${(topAccent / 2).toFixed(1)}" fill="${pal.accentGradient ? 'url(#posterAccent)' : pal.gold}"/>`,
    );

    let ty = cardY + pad;
    if (m.item.tag) {
      const chipH = tagSize * 1.9;
      const chipW = textWidth(m.item.tag, tagSize) + tagSize * 1.5;
      parts.push(
        `<rect x="${(x + pad).toFixed(1)}" y="${ty.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${pal.chipFill}" stroke="${pal.gold}" stroke-opacity="0.5" stroke-width="1.2"/>`,
        textEl({ x: x + pad + chipW / 2, y: ty + chipH * 0.68, text: m.item.tag, size: tagSize, fill: pal.chipText, weight: 700, anchor: 'middle' }),
      );
      ty += chipH + W * 0.014;
    }

    parts.push(
      linesEl(m.titleLines, x + pad, ty + titleSize, titleSize * 1.32, {
        size: titleSize,
        fill: pal.text,
        weight: 800,
        family: titleFamily(pal),
      }),
    );
    ty += m.titleLines.length * titleSize * 1.32;

    if (m.bodyLines.length) {
      ty += W * 0.018;
      parts.push(
        linesEl(m.bodyLines, x + pad, ty + bodySize, bodyLineHeight, {
          size: bodySize,
          fill: pal.textDim,
          weight: 400,
          opacity: 0.9,
        }),
      );
    }
  });

  const rows = Math.ceil(metrics.length / columns);
  return { height: rows * cardH + (rows - 1) * gap, svg: parts.join('') };
}

function renderTimeline(block: Extract<PosterBlock, { kind: 'timeline' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const parts: string[] = [];
  const railX = padX + W * 0.016;

  const timeSize = W * 0.023;
  const titleSize = W * 0.03;
  const bodySize = W * 0.0235;
  const bodyLineHeight = bodySize * 1.5;

  const timeW = W * 0.2;
  const textX = railX + W * 0.03 + timeW + W * 0.028;

  let y = 0;
  block.items.forEach((item, index) => {
    const bodyLines = (item.lines ?? []).flatMap((line) => wrapText(line, contentW - (textX - padX), bodySize, 4));
    const chipH = timeSize * 2.1;
    const titleLineHeight = titleSize * 1.3;
    const itemH = Math.max(
      chipH,
      titleSize + (bodyLines.length ? W * 0.014 + bodyLines.length * bodyLineHeight : 0),
    );

    // 左侧竖轨
    if (index < block.items.length - 1) {
      parts.push(
        `<rect x="${(railX - 1).toFixed(1)}" y="${(y + chipH * 0.5).toFixed(1)}" width="2" height="${(itemH + W * 0.03).toFixed(1)}" fill="${pal.rail}"/>`,
      );
    }
    // 节点
    parts.push(
      `<circle cx="${railX.toFixed(1)}" cy="${(y + chipH * 0.5).toFixed(1)}" r="${(W * 0.011).toFixed(1)}" fill="${pal.gold}"/>`,
      `<circle cx="${railX.toFixed(1)}" cy="${(y + chipH * 0.5).toFixed(1)}" r="${(W * 0.019).toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-opacity="0.35" stroke-width="1.5"/>`,
    );
    // 时间 chip
    parts.push(
      `<rect x="${(railX + W * 0.03).toFixed(1)}" y="${y.toFixed(1)}" width="${timeW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${pal.chipFill}" stroke="${pal.gold}" stroke-opacity="0.5" stroke-width="1.2"/>`,
      textEl({ x: railX + W * 0.03 + timeW / 2, y: y + chipH * 0.66, text: item.time, size: timeSize, fill: pal.chipText, weight: 700, anchor: 'middle', letterSpacing: timeSize * 0.08 }),
    );

    let ty = y + titleSize;
    parts.push(
      textEl({ x: textX, y: ty, text: item.title, size: titleSize, fill: pal.text, weight: 800, family: titleFamily(pal) }),
    );
    if (bodyLines.length) {
      ty += W * 0.014 + bodySize;
      parts.push(
        linesEl(bodyLines, textX, ty, bodyLineHeight, { size: bodySize, fill: pal.textDim, weight: 400, opacity: 0.9 }),
      );
    }
    y += itemH + W * 0.034;
  });

  return { height: Math.max(0, y - W * 0.034), svg: parts.join('') };
}

function renderRows(block: Extract<PosterBlock, { kind: 'rows' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const parts: string[] = [];
  let y = 0;
  const align = block.align ?? 'left';
  const isCenter = align === 'center';

  if (block.title) {
    const size = W * 0.036;
    parts.push(
      textEl({
        x: isCenter ? padX + contentW / 2 : padX,
        y: y + size,
        text: block.title,
        size,
        fill: pal.text,
        weight: 800,
        family: titleFamily(pal),
        anchor: isCenter ? 'middle' : 'start',
      }),
    );
    y += size * 1.7;
  }

  const labelSize = W * 0.023;
  const titleSize = W * 0.028;
  const bodySize = W * 0.0235;
  const bodyLineHeight = bodySize * 1.55;

  block.items.forEach((item, index) => {
    const labelW = textWidth(item.label, labelSize) + labelSize * 1.5;
    const chipH = labelSize * 1.9;
    const textX = padX + labelW + W * 0.026;
    const titleLines = wrapText(item.title, contentW - (textX - padX), titleSize, 2);
    const bodyLines = (item.lines ?? []).flatMap((line) => wrapText(line, contentW - (textX - padX), bodySize, 4));

    // 居中排版：整行（标签 + 文字）作为一个整体居中
    const rowW = labelW + W * 0.026 + Math.max(
      titleLines.reduce((max, line) => Math.max(max, textWidth(line, titleSize)), 0),
      bodyLines.reduce((max, line) => Math.max(max, textWidth(line, bodySize)), 0),
    );
    const shift = isCenter ? Math.max(0, (contentW - rowW) / 2) : 0;
    const chipX = padX + shift;
    const textShift = textX + shift;

    parts.push(
      `<rect x="${chipX.toFixed(1)}" y="${y.toFixed(1)}" width="${labelW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH / 2).toFixed(1)}" fill="${pal.chipFill}" stroke="${pal.gold}" stroke-opacity="0.5" stroke-width="1.2"/>`,
      textEl({ x: chipX + labelW / 2, y: y + chipH * 0.67, text: item.label, size: labelSize, fill: pal.chipText, weight: 700, anchor: 'middle' }),
    );

    let ty = y + titleSize;
    parts.push(
      linesEl(titleLines, textShift, ty, titleSize * 1.3, { size: titleSize, fill: pal.text, weight: 700 }),
    );
    ty += titleLines.length * titleSize * 1.3;
    // linesEl 传入的是首行基线，块底要再加 (n-1) 行高，否则下一行会盖上来
    let blockEnd = ty;
    if (bodyLines.length) {
      ty += W * 0.012 + bodySize;
      parts.push(
        linesEl(bodyLines, textShift, ty, bodyLineHeight, { size: bodySize, fill: pal.textDim, weight: 400, opacity: 0.9 }),
      );
      blockEnd = ty + (bodyLines.length - 1) * bodyLineHeight;
    }
    y = Math.max(y + chipH, blockEnd) + W * 0.026;

    if (index < block.items.length - 1) {
      parts.push(
        `<rect x="${padX.toFixed(1)}" y="${(y - W * 0.013).toFixed(1)}" width="${contentW.toFixed(1)}" height="1" fill="${pal.divider}"/>`,
      );
    }
  });

  return { height: y, svg: parts.join('') };
}

/** 头像裁剪 id 递增（同一张图里可能有多个圆形头像） */
let avatarClipSeq = 0;

function renderProfile(block: Extract<PosterBlock, { kind: 'profile' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const profile = block.profile;
  const parts: string[] = [];

  const cardPad = W * 0.034;
  const radius = W * 0.018;
  const avatarSize = W * 0.165;
  const nameSize = W * 0.042;
  const roleSize = W * 0.024;
  const bulletSize = W * 0.0235;
  const bulletLineHeight = bulletSize * 1.5;

  const hasAvatar = Boolean(profile.avatar);
  const gap = W * 0.03;
  const headerX = padX + cardPad + (hasAvatar ? avatarSize + gap : 0);
  const headerW = contentW - cardPad * 2 - (hasAvatar ? avatarSize + gap : 0);

  const nameLines = wrapText(profile.name, headerW, nameSize, 2);
  const roleLines = profile.role ? wrapText(profile.role, headerW, roleSize, 2) : [];
  const nameH = nameSize + (nameLines.length - 1) * nameSize * 1.2;
  const roleH = roleLines.length ? W * 0.018 + roleSize + (roleLines.length - 1) * roleSize * 1.45 : 0;

  const bulletBlocks = (profile.bullets ?? []).map((text) =>
    wrapText(text, headerW - W * 0.042, bulletSize, 2),
  );
  const bulletsH =
    bulletBlocks.reduce((sum, lines) => sum + lines.length * bulletLineHeight, 0) +
    Math.max(0, bulletBlocks.length - 1) * W * 0.012;

  // 有头像时：姓名 / 头衔 / 资历统一排在右列，卡片变成紧凑的名片版式
  const inlineBullets = hasAvatar && bulletBlocks.length > 0;
  const bulletsGap = inlineBullets ? W * 0.026 : 0;
  const rightColH = nameH + roleH + (bulletBlocks.length ? bulletsGap + bulletsH : 0);
  const cardH = (hasAvatar ? Math.max(avatarSize, rightColH) : rightColH) + cardPad * 2;

  parts.push(
    `<rect x="${padX.toFixed(1)}" y="0" width="${contentW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${pal.cardFill}" fill-opacity="${pal.cardOpacity}" stroke="${pal.cardStroke}" stroke-width="1.5"/>`,
  );

  // 头像（圆形裁切）
  if (hasAvatar) {
    avatarClipSeq += 1;
    const clipId = `avatarClip${avatarClipSeq}`;
    const ax = padX + cardPad;
    const ay = cardPad;
    const cx = ax + avatarSize / 2;
    const cy = ay + avatarSize / 2;
    const r = avatarSize / 2;
    parts.push(
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.chipFill}"/>`,
      `<clipPath id="${clipId}"><circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}"/></clipPath>`,
      `<image href="${esc(profile.avatar)}" xlink:href="${esc(profile.avatar)}" x="${ax.toFixed(1)}" y="${ay.toFixed(1)}" width="${avatarSize.toFixed(1)}" height="${avatarSize.toFixed(1)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`,
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r - W * 0.003).toFixed(1)}" fill="none" stroke="${pal.gold}" stroke-width="${(W * 0.0045).toFixed(1)}"/>`,
    );
  }

  // 姓名 + 头衔
  let ty = cardPad + nameSize;
  parts.push(
    linesEl(nameLines, headerX, ty, nameSize * 1.2, {
      size: nameSize,
      fill: pal.text,
      weight: 800,
      family: titleFamily(pal),
    }),
  );
  if (roleLines.length) {
    ty += (nameLines.length - 1) * nameSize * 1.2 + W * 0.018 + roleSize;
    parts.push(
      linesEl(roleLines, headerX, ty, roleSize * 1.45, {
        size: roleSize,
        fill: pal.goldSoft,
        weight: 700,
      }),
    );
  }

  // 资历要点
  if (bulletBlocks.length) {
    let by = inlineBullets
      ? cardPad + nameH + roleH + bulletsGap + bulletSize
      : cardPad + Math.max(hasAvatar ? avatarSize : 0, nameH + roleH) + W * 0.026 + bulletSize;
    const textX = inlineBullets ? headerX : padX + cardPad;
    const dotX = inlineBullets ? headerX + W * 0.011 : padX + cardPad + W * 0.011;
    bulletBlocks.forEach((lines) => {
      parts.push(
        linesEl(lines, textX + W * 0.028, by, bulletLineHeight, {
          size: bulletSize,
          fill: pal.textDim,
          weight: 500,
          opacity: 0.95,
        }),
        `<circle cx="${dotX.toFixed(1)}" cy="${(by - bulletSize * 0.32).toFixed(1)}" r="${(W * 0.0055).toFixed(1)}" fill="${pal.gold}"/>`,
      );
      by += lines.length * bulletLineHeight + W * 0.012;
    });
  }

  return { height: cardH, svg: parts.join('') };
}

function renderNote(block: Extract<PosterBlock, { kind: 'note' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const size = W * 0.025;
  const lines = wrapText(block.text, contentW - W * 0.06, size, 4);
  const lineHeight = size * 1.6;
  const boxPad = W * 0.026;
  const boxH = lines.length * lineHeight + boxPad * 2;
  return {
    height: boxH,
    svg: [
      `<rect x="${padX.toFixed(1)}" y="0" width="${contentW.toFixed(1)}" height="${boxH.toFixed(1)}" rx="${(W * 0.014).toFixed(1)}" fill="${pal.cardFill}" fill-opacity="${pal.cardOpacity}" stroke="${pal.cardStroke}" stroke-width="1.2"/>`,
      `<rect x="${padX.toFixed(1)}" y="0" width="${(W * 0.006).toFixed(1)}" height="${boxH.toFixed(1)}" rx="${(W * 0.003).toFixed(1)}" fill="${pal.gold}"/>`,
      linesEl(lines, padX + W * 0.03, boxPad + size, lineHeight, { size, fill: pal.textDim, weight: 400, opacity: 0.92 }),
    ].join(''),
  };
}

function renderFooter(block: Extract<PosterBlock, { kind: 'footer' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const size = W * (block.size ?? 0.024);
  const align = block.align ?? 'center';
  const anchor = align === 'center' ? 'middle' : 'start';
  const x = align === 'center' ? W / 2 : padX;
  const color = block.color ?? pal.textFaint;
  const lines = wrapText(block.text, contentW * 0.95, size, 2);
  const lineHeight = size * 1.55;
  const showDivider = block.divider ?? true;

  // 第二行（小字）：品牌 / 版权 / 补充说明
  const subSize = block.subSize ? W * block.subSize : size * 0.78;
  const subLines = block.sub ? wrapText(block.sub, contentW * 0.95, subSize, 2) : [];
  const subLineHeight = subSize * 1.5;
  const subGap = subLines.length ? (block.subGap ?? W * 0.014) : 0;

  const height =
    lines.length * lineHeight +
    subGap +
    subLines.length * subLineHeight +
    (block.trailing ?? W * 0.05);

  const parts: string[] = [];
  if (showDivider) {
    parts.push(
      `<rect x="${padX.toFixed(1)}" y="${(W * 0.018).toFixed(1)}" width="${contentW.toFixed(1)}" height="1" fill="${pal.divider}"/>`,
    );
  }
  parts.push(
    ...lines.map((line, index) =>
      textEl({
        x,
        y: W * 0.042 + size + index * lineHeight,
        text: line,
        size,
        fill: color,
        weight: 500,
        anchor,
        letterSpacing: size * 0.06,
      }),
    ),
  );
  if (subLines.length) {
    const subTop = W * 0.042 + size + (lines.length - 1) * lineHeight + subGap;
    parts.push(
      ...subLines.map((line, index) =>
        textEl({
          x,
          y: subTop + subSize + index * subLineHeight,
          text: line,
          size: subSize,
          fill: color,
          weight: 500,
          anchor,
          opacity: 0.78,
          letterSpacing: subSize * 0.04,
        }),
      ),
    );
  }

  return { height, svg: parts.join('') };
}

/* ==================================================================== */
/* 通用海报新增块：居中标题 / 功能卡 / 卖点网格 / 面板 / 二维码 / 主视觉 */
/* ==================================================================== */

/** 取面板块内的反色调色板（白底深字）；没配则回退到主调色板 */
function cardPalette(pal: PosterPalette): PosterPalette {
  if (!pal.card) return pal;
  return { ...pal, ...pal.card };
}

/** 居中标题：小标 → 超大主标题 → 副标题 → 注解 */
function renderCenterTitle(block: Extract<PosterBlock, { kind: 'centerTitle' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, pal } = ctx;
  const spec = block;
  const parts: string[] = [];
  let y = 0;

  const align = spec.align ?? 'center';
  const x = align === 'center' ? W / 2 : ctx.padX;
  const anchor = align === 'center' ? 'middle' : 'start';

  if (spec.kicker) {
    const size = W * (spec.kickerScale ?? 0.026);
    const lines = wrapText(spec.kicker, contentW, size, 2);
    const lineHeight = size * 1.5;
    parts.push(
      linesEl(lines, x, y + size, lineHeight, {
        size,
        fill: pal.gold,
        weight: 800,
        anchor,
        letterSpacing: size * 0.1,
      }),
    );
    y += size + (lines.length - 1) * lineHeight + (spec.kickerGap ?? W * 0.022);
  }

  if (spec.title) {
    const fitted = spec.titleScale
      ? { size: W * spec.titleScale, lines: wrapText(spec.title, contentW, W * spec.titleScale, 3) }
      : fitTitleSize(spec.title, contentW, W * 0.085, W * 0.036);
    const titleSize = fitted.size;
    const titleLineHeight = titleSize * 1.2;
    parts.push(
      linesEl(fitted.lines, x, y + titleSize, titleLineHeight, {
        size: titleSize,
        fill: `url(#${ctx.titleGradientId ?? 'posterTitle'})`,
        weight: 800,
        family: spec.font === 'sans' ? BODY_FONT : titleFamily(pal),
        anchor,
        stroke: pal.titleStrokeWidth > 0 ? pal.titleStroke : undefined,
        strokeWidth: Math.max(1.4, titleSize * pal.titleStrokeWidth),
        filterId: pal.titleShadow ? 'posterGlowF' : undefined,
      }),
    );
    y += titleSize + (fitted.lines.length - 1) * titleLineHeight;
  }

  if (spec.subtitle) {
    const size = W * (spec.subtitleScale ?? 0.03);
    const lines = wrapText(spec.subtitle, contentW * 0.96, size, 3);
    const lineHeight = size * 1.5;
    y += spec.subtitleGap ?? W * 0.022;
    parts.push(
      linesEl(lines, x, y + size, lineHeight, { size, fill: pal.textDim, weight: 500, anchor, opacity: 0.95 }),
    );
    y += size + (lines.length - 1) * lineHeight;
  }

  if (spec.note) {
    const size = W * (spec.noteScale ?? 0.021);
    const lines = wrapText(spec.note, contentW * 0.9, size, 2);
    const lineHeight = size * 1.55;
    y += spec.noteGap ?? W * 0.018;
    parts.push(linesEl(lines, x, y + size, lineHeight, { size, fill: pal.textFaint, weight: 500, anchor }));
    y += size + (lines.length - 1) * lineHeight;
  }

  return { height: y, svg: parts.join('') };
}

/** 横向功能卡片组：图标（或序号圆牌）+ 标题 + 说明 */
/**
 * 线性小图标（内置描边矢量）。
 *
 * 为什么要内置：参考图里的功能卡图标是「细黑线稿」（信封 / 节点 / 循环箭头），
 * 用 emoji 或图片都会偏差；内置路径能保证任何机器上形状一致、无字体依赖。
 * 坐标系：单位方框（0..1），由调用方缩放到实际像素。
 */
function lineIconSvg(
  shape: 'envelope' | 'flow' | 'loop' | 'bolt' | 'check',
  x: number,
  y: number,
  size: number,
  color: string,
): string {
  const s = (v: number) => (v * size).toFixed(2);
  const stroke = `fill="none" stroke="${color}" stroke-width="${(size * 0.055).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"`;
  const g = (body: string) =>
    `<g transform="translate(${x.toFixed(2)}, ${y.toFixed(2)})" ${stroke}>${body}</g>`;

  switch (shape) {
    case 'envelope':
      // 信封：六边感外轮廓 + 封口折线
      return g(
        `<path d="M ${s(0.1)} ${s(0.28)} L ${s(0.5)} ${s(0.05)} L ${s(0.9)} ${s(0.28)} L ${s(0.9)} ${s(0.72)} L ${s(0.5)} ${s(0.95)} L ${s(0.1)} ${s(0.72)} Z"/>` +
          `<path d="M ${s(0.1)} ${s(0.28)} L ${s(0.5)} ${s(0.56)} L ${s(0.9)} ${s(0.28)}"/>`,
      );
    case 'flow':
      // 流程：三个节点 + 连线
      return g(
        `<circle cx="${s(0.2)}" cy="${s(0.22)}" r="${s(0.11)}"/>` +
          `<circle cx="${s(0.78)}" cy="${s(0.5)}" r="${s(0.11)}"/>` +
          `<circle cx="${s(0.24)}" cy="${s(0.8)}" r="${s(0.11)}"/>` +
          `<path d="M ${s(0.29)} ${s(0.3)} L ${s(0.67)} ${s(0.45)}"/>` +
          `<path d="M ${s(0.67)} ${s(0.57)} L ${s(0.34)} ${s(0.74)}"/>`,
      );
    case 'loop':
      // 循环：开口圆环 + 箭头
      return g(
        `<path d="M ${s(0.82)} ${s(0.32)} A ${s(0.4)} ${s(0.4)} 0 1 0 ${s(0.85)} ${s(0.62)}"/>` +
          `<path d="M ${s(0.72)} ${s(0.2)} L ${s(0.88)} ${s(0.34)} L ${s(0.7)} ${s(0.44)}"/>`,
      );
    case 'bolt':
      return g(`<path d="M ${s(0.55)} ${s(0.05)} L ${s(0.22)} ${s(0.55)} L ${s(0.46)} ${s(0.55)} L ${s(0.4)} ${s(0.95)} L ${s(0.78)} ${s(0.42)} L ${s(0.53)} ${s(0.42)} Z"/>`);
    case 'check':
      return g(
        `<circle cx="${s(0.5)}" cy="${s(0.5)}" r="${s(0.42)}"/>` +
          `<path d="M ${s(0.29)} ${s(0.52)} L ${s(0.45)} ${s(0.68)} L ${s(0.73)} ${s(0.33)}"/>`,
      );
  }
}

function renderFeatures(block: Extract<PosterBlock, { kind: 'features' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, pal } = ctx;
  const columns = Math.max(1, Math.min(4, block.columns ?? 3));
  const gap = block.gap ?? W * 0.022;
  const pad = block.padding ?? W * 0.026;
  const radius = block.radius ?? W * 0.018;
  const iconSize = W * (block.iconScale ?? 0.07);
  const titleSize = W * (block.titleScale ?? 0.028);
  const descSize = W * (block.descScale ?? 0.021);
  const titleLineHeight = titleSize * (block.titleLineHeight ?? 1.3);
  const descLineHeight = descSize * 1.5;
  const titleGap = block.titleGap ?? W * 0.012;
  const iconGap = block.iconGap ?? W * 0.016;

  // 整组宽度：默认铺满内容区；widthRatio < 1 时水平居中
  const rowW = block.widthRatio ? W * block.widthRatio : contentW;
  const rowX = block.widthRatio ? (W - rowW) / 2 : ctx.padX;
  const cardW = (rowW - gap * (columns - 1)) / columns;

  const metrics = block.items.map((item) => {
    const titleLines = wrapText(item.title, cardW - pad * 2, titleSize, 2);
    const descLines = item.desc ? wrapText(item.desc, cardW - pad * 2, descSize, 3) : [];
    const contentH =
      iconSize +
      iconGap +
      titleLines.length * titleLineHeight +
      (descLines.length ? titleGap : 0) +
      descLines.length * descLineHeight;
    return { item, titleLines, descLines, contentH };
  });

  const autoH = Math.max(...metrics.map((m) => m.contentH)) + pad * 2;
  const cardH = block.height ?? autoH;
  const parts: string[] = [];

  metrics.forEach((m, index) => {
    const x = rowX + (index % columns) * (cardW + gap);
    const cardY = Math.floor(index / columns) * (cardH + gap);
    const fill = m.item.tint ?? pal.cardFill;
    const fillOpacity = m.item.gradient ? 1 : pal.cardOpacity;

    // 阴影：卡片底下垫一层同形状的模糊黑块（浅底卡片靠它浮起来）
    if (m.item.shadow) {
      parts.push(
        `<rect x="${(x + 2).toFixed(1)}" y="${(cardY + 6).toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="#0B2A4A" fill-opacity="0.16" filter="url(#posterCardShadow)"/>`,
      );
    }

    if (m.item.gradient) {
      const gid = `featGrad${index}`;
      if (m.item.gradientType === 'radial') {
        // 玻璃卡：中心纯白、四周透出色 + 一圈同色描边（对齐参考图功能卡）
        parts.push(
          `<defs><radialGradient id="${gid}" cx="0.5" cy="0.5" r="0.72">
          <stop offset="0%" stop-color="${m.item.gradient[1]}"/>
          <stop offset="72%" stop-color="${m.item.gradient[0]}"/>
          <stop offset="100%" stop-color="${m.item.gradient[0]}"/>
        </radialGradient></defs>`,
        );
      } else {
        parts.push(
          `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${m.item.gradient[0]}"/>
          <stop offset="100%" stop-color="${m.item.gradient[1]}"/>
        </linearGradient></defs>`,
        );
      }
      const stroke = m.item.stroke
        ? ` stroke="${m.item.stroke}" stroke-width="2"`
        : '';
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="url(#${gid})"${stroke}/>`,
      );
    } else {
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${cardY.toFixed(1)}" width="${cardW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${pal.cardStroke}" stroke-width="1.2"/>`,
      );
    }

    const iconX = x + pad;
    const iconY = cardY + pad;
    if (iconSize <= 0) {
      // 无图标：内容顶对齐
      parts.push(
        linesEl(m.titleLines, iconX, iconY + titleSize, titleLineHeight, {
          size: titleSize,
          fill: pal.text,
          weight: 800,
          family: titleFamily(pal),
        }),
      );
      if (m.descLines.length) {
        const dy = iconY + titleSize + m.titleLines.length * titleLineHeight + titleGap;
        parts.push(
          linesEl(m.descLines, iconX, dy + descSize, descLineHeight, {
            size: descSize,
            fill: pal.textDim,
            weight: 400,
            opacity: 0.9,
          }),
        );
      }
      return;
    }
    if (m.item.icon) {
      parts.push(
        `<image href="${esc(m.item.icon)}" xlink:href="${esc(m.item.icon)}" x="${iconX.toFixed(1)}" y="${iconY.toFixed(1)}" width="${iconSize.toFixed(1)}" height="${iconSize.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`,
      );
    } else if (m.item.iconShape) {
      parts.push(lineIconSvg(m.item.iconShape, iconX, iconY, iconSize, m.item.iconColor ?? '#12141A'));
    } else {
      const r = iconSize / 2;
      parts.push(
        `<circle cx="${(iconX + r).toFixed(1)}" cy="${(iconY + r).toFixed(1)}" r="${r.toFixed(1)}" fill="${pal.gold}" fill-opacity="0.12" stroke="${pal.gold}" stroke-opacity="0.5" stroke-width="1.2"/>`,
        textEl({
          x: iconX + r,
          y: iconY + r + iconSize * 0.17,
          text: String(index + 1),
          size: iconSize * 0.46,
          fill: pal.gold,
          weight: 800,
          anchor: 'middle',
        }),
      );
    }

    let ty = cardY + pad + iconSize + iconGap;
    parts.push(
      linesEl(m.titleLines, iconX, ty + titleSize, titleLineHeight, {
        size: titleSize,
        fill: pal.text,
        weight: 800,
        family: titleFamily(pal),
      }),
    );
    ty += m.titleLines.length * titleLineHeight;

    if (m.descLines.length) {
      ty += titleGap;
      parts.push(
        linesEl(m.descLines, iconX, ty + descSize, descLineHeight, {
          size: descSize,
          fill: pal.textDim,
          weight: 400,
          opacity: 0.9,
        }),
      );
    }
  });

  const rows = Math.ceil(metrics.length / columns);
  return { height: rows * cardH + (rows - 1) * gap, svg: parts.join('') };
}

/** 卖点网格：纯文字（无卡片底），信息型海报的白卡内常用 */
function renderGrid(block: Extract<PosterBlock, { kind: 'grid' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const columns = Math.max(1, Math.min(3, block.columns ?? 2));
  const align = block.align ?? 'center';
  const colW = contentW / columns;

  const titleSize = W * (block.titleScale ?? 0.042);
  const descSize = W * (block.descScale ?? 0.025);
  const titleLineHeight = titleSize * 1.28;
  const descLineHeight = descSize * (block.descLineHeight ?? 1.6);
  const titleGap = block.titleGap ?? W * 0.016;

  const metrics = block.items.map((item) => {
    const titleLines = wrapText(item.title, colW * 0.92, titleSize, 2);
    const descLines = item.desc
      ? wrapText(item.desc, colW * 0.88, descSize, block.descMaxLines ?? 3)
      : [];
    return { item, titleLines, descLines };
  });

  const rowHeights: number[] = [];
  for (let row = 0; row * columns < metrics.length; row += 1) {
    const rowItems = metrics.slice(row * columns, row * columns + columns);
    const maxTitle = Math.max(...rowItems.map((m) => m.titleLines.length));
    const maxDesc = Math.max(...rowItems.map((m) => m.descLines.length));
    rowHeights.push(
      maxTitle * titleLineHeight + (maxDesc ? titleGap + maxDesc * descLineHeight : 0),
    );
  }

  const parts: string[] = [];

  // 每行的起始 y（行高取该行最大内容高度）
  const rowGap = block.rowGap ?? W * 0.03;
  const rowStarts: number[] = [];
  let acc = 0;
  for (let row = 0; row * columns < metrics.length; row += 1) {
    rowStarts.push(acc);
    acc += rowHeights[row];
    if (row * columns + columns < metrics.length) acc += rowGap;
  }

  metrics.forEach((m, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const cellX = padX + col * colW;
    const x = align === 'center' ? cellX + colW / 2 : cellX;
    const anchor = align === 'center' ? 'middle' : 'start';

    let ty = rowStarts[row];
    parts.push(
      linesEl(m.titleLines, x, ty + titleSize, titleLineHeight, {
        size: titleSize,
        fill: block.titleColor ?? pal.gold,
        weight: 800,
        family: titleFamily(pal),
        anchor,
      }),
    );
    ty += m.titleLines.length * titleLineHeight;

    if (m.descLines.length) {
      ty += titleGap;
      parts.push(
        linesEl(m.descLines, x, ty + descSize, descLineHeight, {
          size: descSize,
          fill: block.descColor ?? pal.textDim,
          weight: 400,
          anchor,
          opacity: 0.95,
        }),
      );
    }
  });

  // 每行单独推进 y（行内每格用自身内容高度，行高取最大）
  let rowY = 0;
  for (let row = 0; row * columns < metrics.length; row += 1) {
    rowY += rowHeights[row];
    if (row * columns + columns < metrics.length) rowY += rowGap;
  }

  return { height: rowY, svg: parts.join('') };
}

/** 圆角面板：内嵌子块（白卡信息区） */
function renderPanel(block: Extract<PosterBlock, { kind: 'panel' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const padding = block.padding ?? W * 0.05;
  const radius = block.radius ?? W * 0.028;
  // 面板宽度：默认铺满内容区，widthRatio < 1 时水平居中
  const panelW = contentW * (block.widthRatio ?? 1);
  const panelX = padX + (contentW - panelW) / 2;
  const innerW = Math.max(W * 0.2, panelW - padding * 2);
  const innerPal = block.tone === 'inherit' ? pal : cardPalette(pal);
  // 面板内部的字号仍然按整张画布算（与外层一致），
  // 只有可用宽度按面板内宽算——否则白卡里的字会比外面小一号
  const innerCtx: BlockContext = {
    W,
    contentW: innerW,
    // 内边距要同时作用在水平方向（padX），
    // 否则白卡里的子块会贴左边排，右边空出一大块，整体看着往左偏
    padX: padding,
    pal: innerPal,
    titleGradientId: block.tone === 'inherit' ? ctx.titleGradientId : 'posterTitleCard',
  };

  const rendered = block.blocks.map((child) => renderBlock(child, innerCtx));
  const gap = block.gap ?? W * 0.028;

  let innerH = 0;
  rendered.forEach((r, index) => {
    innerH += r.height;
    if (index < rendered.length - 1) innerH += blockGapOf(block.blocks, index, gap);
  });

  // 弹性占位：面板有 minHeight 时，差额分给内部的 fill: true 占位
  const fillIndexes = block.blocks
    .map((child, index) => ((child as any).kind === 'spacer' && (child as any).fill ? index : -1))
    .filter((index) => index >= 0);
  const targetInner = (block.minHeight ?? 0) - padding * 2;
  if (fillIndexes.length && targetInner > innerH) {
    const each = (targetInner - innerH) / fillIndexes.length;
    for (const index of fillIndexes) rendered[index] = { height: each, svg: '' };
    innerH = targetInner;
  }

  const cardH = Math.max(innerH + padding * 2, block.minHeight ?? 0);
  const fill = block.fill ?? innerPal.cardFill;
  const stroke = block.stroke ?? innerPal.cardStroke;

  const parts: string[] = [];

  // 投影：一张模糊的深色圆角矩形垫在面板下面（模板里卡片有很轻的浮起感）
  if (block.shadow && block.shadow > 0) {
    const blur = block.shadow;
    const shadowId = `posterShadow${Math.round(blur)}`;
    parts.push(
      `<defs><filter id="${shadowId}" x="-25%" y="-25%" width="150%" height="160%"><feGaussianBlur stdDeviation="${(blur * 0.45).toFixed(1)}"/></filter></defs>`,
    );
    parts.push(
      `<rect x="${(panelX - blur * 0.06).toFixed(1)}" y="${(blur * 0.18).toFixed(1)}" width="${panelW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${(radius + blur * 0.06).toFixed(1)}" fill="#0B1B33" opacity="0.16" filter="url(#${shadowId})"/>`,
    );
  }

  parts.push(
    `<rect x="${panelX.toFixed(1)}" y="0" width="${panelW.toFixed(1)}" height="${cardH.toFixed(1)}" rx="${radius.toFixed(1)}" fill="${fill}" fill-opacity="${innerPal.cardOpacity}" stroke="${stroke}" stroke-width="1.2"/>`,
  );

  let y = padding;
  rendered.forEach((r, index) => {
    if (r.svg) parts.push(`<g transform="translate(${panelX.toFixed(1)}, ${y.toFixed(1)})">${r.svg}</g>`);
    y += r.height + (index < rendered.length - 1 ? blockGapOf(block.blocks, index, gap) : 0);
  });

  return { height: cardH, svg: parts.join('') };
}

/**
 * 二维码块：白底方框 + 真实二维码 + 引导文案
 *
 * 两种编码来源：
 *   1. spec.content —— 本地用 qrcode 库编码成矢量码（推荐，配置里改文案即可换码）
 *   2. spec.src —— 外部图片（保留兼容）
 *
 * 托底框：frame='square' 时是一块正方形白框，二维码居中放在框里；
 * 框本身提供静区（白边），所以扫码不会失败。
 */
function renderQr(block: Extract<PosterBlock, { kind: 'qr' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const spec = block;
  const parts: string[] = [];

  const titleSize = W * (spec.titleScale ?? 0.03);
  const captionSize = W * (spec.captionScale ?? 0.024);
  const overlap = spec.overlap ?? 0;

  // —— 托底框尺寸 ——
  const squareFrame = spec.frame === 'square';
  const frameFill = spec.frameFill ?? '#FFFFFF';
  const frameStroke = spec.frameStroke ?? '#E3E8EF';
  const frameRadius = spec.frameRadius ?? W * 0.018;
  const framePad = spec.framePad ?? W * 0.03;

  const frameW = spec.frameWidth ?? (squareFrame ? contentW * 0.68 : Math.max(W * 0.26 + framePad * 2, contentW * 0.62));
  // 二维码尺寸：按“模块数 × 整数像素”对齐，避免 SVG 半像素描边把模块边缘糊掉（糊了就扫不出来）
  const matrix = spec.content ? qrMatrix(spec.content) : null;
  const units = matrix ? matrix.size + 8 : 0; // 含 4 模块静区
  const avail = frameW - framePad * 2;
  let qrSize = avail;
  if (units > 0) {
    const target = spec.size ?? avail;
    const module = Math.max(1, Math.round(target / units));
    qrSize = module * units;
  } else if (spec.size) {
    qrSize = spec.size;
  }
  const frameH = squareFrame ? frameW : qrSize + framePad * 2;
  const frameX = padX + (contentW - frameW) / 2;

  let y = -overlap;

  if (spec.title) {
    const lines = wrapText(spec.title, contentW, titleSize, 2);
    const lineHeight = titleSize * 1.5;
    parts.push(
      linesEl(lines, W / 2, y + titleSize, lineHeight, {
        size: titleSize,
        fill: pal.text,
        weight: 800,
        anchor: 'middle',
      }),
    );
    y += titleSize + (lines.length - 1) * lineHeight + W * 0.02;
  }

  // 框
  if (spec.card !== false || squareFrame) {
    parts.push(
      `<rect x="${frameX.toFixed(1)}" y="${y.toFixed(1)}" width="${frameW.toFixed(1)}" height="${frameH.toFixed(1)}" rx="${frameRadius.toFixed(1)}" fill="${frameFill}" stroke="${frameStroke}" stroke-width="1.2"/>`,
    );
  }

  // 二维码（居中）
  const qrX = frameX + (frameW - qrSize) / 2;
  const qrY = y + (frameH - qrSize) / 2;
  if (spec.content) {
    const svg = qrSvg(spec.content, {
      size: qrSize,
      margin: 4,
      dark: '#111827',
      light: '#FFFFFF',
      errorCorrectionLevel: 'M',
    });
    if (svg) {
      parts.push(`<g transform="translate(${qrX.toFixed(2)}, ${qrY.toFixed(2)})">${svg}</g>`);
    }
  } else if (spec.src) {
    parts.push(
      `<image href="${esc(spec.src)}" xlink:href="${esc(spec.src)}" x="${qrX.toFixed(1)}" y="${qrY.toFixed(1)}" width="${qrSize.toFixed(1)}" height="${qrSize.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }
  y += frameH;

  if (spec.caption) {
    const lines = wrapText(spec.caption, contentW, captionSize, 2);
    const lineHeight = captionSize * 1.5;
    y += spec.captionGap ?? W * 0.018;
    parts.push(
      linesEl(lines, W / 2, y + captionSize, lineHeight, {
        size: captionSize,
        fill: spec.captionColor ?? pal.textDim,
        weight: 500,
        anchor: 'middle',
      }),
    );
    y += captionSize + (lines.length - 1) * lineHeight;
  }

  // 注意：高度只算“框底 + 说明”这部分。
  // overlap 是往上借的空间（二维码压在上一块上），不能再计一次，
  // 否则下一块会被推远 2×overlap，节奏就散了。
  return { height: Math.max(0, y), svg: parts.join('') };
}

/** 主视觉图：AI 生成的插画 / 产品图，或本地素材 */
let visualClipSeq = 0;

function renderVisual(block: Extract<PosterBlock, { kind: 'visual' }>, ctx: BlockContext): { height: number; svg: string } {
  const { W, contentW, padX, pal } = ctx;
  const spec = block;
  if (!spec.src) return { height: 0, svg: '' };

  const height = spec.height ?? W * (spec.heightRatio ?? 0.5);
  const imgW = spec.widthRatio ? W * spec.widthRatio : contentW;
  const imgX = spec.widthRatio ? (W - imgW) / 2 : padX;
  const parts: string[] = [];

  if (spec.fit === 'cover') {
    visualClipSeq += 1;
    const clipId = `visualClip${visualClipSeq}`;
    parts.push(
      `<defs><clipPath id="${clipId}"><rect x="${imgX.toFixed(1)}" y="0" width="${imgW.toFixed(1)}" height="${height.toFixed(1)}" rx="${(W * 0.02).toFixed(1)}"/></clipPath></defs>`,
      `<image href="${esc(spec.src)}" xlink:href="${esc(spec.src)}" x="${imgX.toFixed(1)}" y="0" width="${imgW.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`,
    );
  } else {
    parts.push(
      `<image href="${esc(spec.src)}" xlink:href="${esc(spec.src)}" x="${imgX.toFixed(1)}" y="0" width="${imgW.toFixed(1)}" height="${height.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
  }

  let total = height;
  if (spec.caption) {
    const size = W * 0.022;
    const lines = wrapText(spec.caption, contentW, size, 2);
    const lineHeight = size * 1.5;
    parts.push(
      linesEl(lines, padX, height + size + W * 0.012, lineHeight, { size, fill: pal.textFaint, weight: 500 }),
    );
    total += size + (lines.length - 1) * lineHeight + W * 0.012;
  }

  return { height: total, svg: parts.join('') };
}

/** 空白间隔 */
function renderSpacer(block: Extract<PosterBlock, { kind: 'spacer' }>, ctx: BlockContext): { height: number; svg: string } {
  // fill: true 的弹性占位高度由 renderContent 统一分配
  if (block.fill) return { height: 0, svg: '' };
  if (block.heightPx != null) return { height: block.heightPx, svg: '' };
  if (block.heightRatio != null && ctx.H) return { height: ctx.H * block.heightRatio, svg: '' };
  return { height: block.height ?? ctx.W * (block.ratio ?? 0.05), svg: '' };
}

function renderBlock(block: PosterBlock, ctx: BlockContext): { height: number; svg: string } {
  switch (block.kind) {
    case 'hero':
      return renderHero(block, ctx);
    case 'title':
      return renderTitle(block, ctx);
    case 'section':
      return renderSection(block, ctx);
    case 'cards':
      return renderCards(block, ctx);
    case 'timeline':
      return renderTimeline(block, ctx);
    case 'rows':
      return renderRows(block, ctx);
    case 'profile':
      return renderProfile(block, ctx);
    case 'note':
      return renderNote(block, ctx);
    case 'footer':
      return renderFooter(block, ctx);
    case 'centerTitle':
      return renderCenterTitle(block, ctx);
    case 'features':
      return renderFeatures(block, ctx);
    case 'grid':
      return renderGrid(block, ctx);
    case 'panel':
      return renderPanel(block, ctx);
    case 'qr':
      return renderQr(block, ctx);
    case 'visual':
      return renderVisual(block, ctx);
    case 'spacer':
      return renderSpacer(block, ctx);
    default:
      return { height: 0, svg: '' };
  }
}


// ============ 程序化品牌背景 ============

/** 确定性伪随机（保证每次出图背景一致，便于 A/B 对照） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 本地程序化背景：深海底渐变 + 径向品牌光晕 + 细网格 + 粒子 + 斜向光束 + 暗角。
 *
 * 为什么不用 AI 底图做商品图：
 *   image-01 会在背景角落"自作主张"画出伪中文（形近乱码），
 *   商品详情图出现乱码文字是硬伤。本地程序化背景 100% 可控、无文字、体积小。
 */
function backgroundSvg(W: number, H: number, pal: PosterPalette, glowX: number): string {
  const rand = mulberry32(20260120);
  const grid = Math.max(24, Math.round(W * 0.042));

  const gridLines: string[] = [];
  for (let x = 0; x <= W; x += grid) {
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${pal.bg.grid}" stroke-opacity="${pal.bg.gridOpacity}" stroke-width="1"/>`);
  }
  for (let y = 0; y <= H; y += grid) {
    gridLines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${pal.bg.grid}" stroke-opacity="${pal.bg.gridOpacity}" stroke-width="1"/>`);
  }
  for (let x = 0; x <= W; x += grid * 5) {
    gridLines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="${pal.glow2}" stroke-opacity="${(pal.bg.gridOpacity * 1.8).toFixed(3)}" stroke-width="1"/>`);
  }

  const particles: string[] = [];
  const particleCount = Math.round((W * H) / 26000);
  for (let index = 0; index < particleCount; index += 1) {
    const x = (rand() * W).toFixed(1);
    const y = (rand() * H).toFixed(1);
    const radius = (rand() * 2.1 + 0.5).toFixed(2);
    const opacity = (rand() * 0.22 + 0.05).toFixed(3);
    particles.push(`<circle cx="${x}" cy="${y}" r="${radius}" fill="${pal.bg.particle}" fill-opacity="${opacity}"/>`);
  }

  // 斜向光束：低透明度长条，制造纵深
  const beams: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    const x = Math.round(rand() * W);
    const width = Math.round(W * (0.06 + rand() * 0.1));
    const skew = Math.round(W * (0.18 + rand() * 0.22));
    const opacity = (0.018 + rand() * 0.03).toFixed(3);
    beams.push(
      `<path d="M ${x} 0 L ${x + width} 0 L ${x + width - skew} ${H} L ${x - skew} ${H} Z" fill="url(#beamGrad)" fill-opacity="${opacity}"/>`,
    );
  }

  return `<rect width="${W}" height="${H}" fill="url(#baseGrad)"/>
<rect width="${W}" height="${H}" fill="url(#gridMask)"/>
${gridLines.join('')}
${beams.join('')}
<ellipse cx="${(W * glowX).toFixed(1)}" cy="${(H * 0.05).toFixed(1)}" rx="${(W * 0.9).toFixed(1)}" ry="${(H * 0.28).toFixed(1)}" fill="url(#glowA)"/>
<ellipse cx="${(W * (1 - glowX) * 0.9).toFixed(1)}" cy="${(H * 0.62).toFixed(1)}" rx="${(W * 0.75).toFixed(1)}" ry="${(H * 0.3).toFixed(1)}" fill="url(#glowB)"/>
<ellipse cx="${(W * 0.5).toFixed(1)}" cy="${(H * 0.98).toFixed(1)}" rx="${(W * 0.7).toFixed(1)}" ry="${(H * 0.18).toFixed(1)}" fill="url(#glowC)"/>
${particles.join('')}
<rect width="${W}" height="${H}" fill="url(#vignette)"/>`;
}

// ============ 有机背景（清新绿方案） ============

/**
 * 有机闭合 blob 路径：在椭圆基线上用固定种子扰动半径点，
 * 再用 Catmull-Rom 转三次贝塞尔，得到平滑的“手绘色块”边缘。
 *
 * 为什么用固定种子：同一份配置每次出图必须一致，否则没法做 A/B 对照。
 */
function blobPath(cx: number, cy: number, rx: number, ry: number, rand: () => number, wobble = 0.18, points = 8): string {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    const radius = 1 + (rand() - 0.5) * 2 * wobble;
    pts.push({ x: cx + Math.cos(angle) * rx * radius, y: cy + Math.sin(angle) * ry * radius });
  }

  const n = pts.length;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return `${d} Z`;
}

/**
 * 有机背景：奶油底 + 边缘有机色块 + 亮黄点缀 + 圆点。
 *
 * 铁律：
 *   1. 不输出网格 / 粒子 / 光束 / 暗角——浅底上这些高频元素会脏
 *   2. 中心阅读区保持干净：用径向遮罩让色块向画布中心退开
 *   3. 色块只压在画布外圈，顶部约 1/4 留给标题与品牌位
 */
function organicBackgroundSvg(W: number, H: number, pal: PosterPalette): string {
  const cfg = pal.organic;
  const base = cfg?.base ?? pal.bg.top;
  const base2 = cfg?.base2 ?? pal.bg.bottom;
  const shapeA = cfg?.shapeA ?? pal.goldFaint;
  const shapeB = cfg?.shapeB ?? pal.bg.mid;
  const accent = cfg?.accent ?? pal.bg.beam;
  const dot = cfg?.dot ?? pal.bg.particle;

  const rand = mulberry32(20260318);
  // 长图里纵向会被拉得很长，色块半径改用 W 做基准，否则一块能盖掉半张图
  const isTall = H / W > 1.4;
  const unit = isTall ? W : H;

  const shape = (cx: number, cy: number, rx: number, ry: number, wobble: number, fill: string, opacity: number) =>
    `<path d="${blobPath(cx * W, cy * H, rx * W, ry * unit, rand, wobble)}" fill="${fill}" fill-opacity="${opacity}"/>`;

  // 方图：色块压在四周边缘；长图：只保留首尾两端的色块，中间阅读区彻底留白
  const shapes = isTall
    ? [
        shape(-0.1, 1.06, 0.3, 0.22, 0.16, shapeA, 1),
        shape(0.44, 1.12, 0.4, 0.18, 0.2, shapeB, 0.95),
        shape(1.08, 1.06, 0.18, 0.12, 0.18, accent, 0.9),
        shape(1.1, 0.16, 0.16, 0.13, 0.2, shapeB, 0.9),
        shape(-0.1, 0.1, 0.13, 0.1, 0.22, shapeB, 0.85),
        shape(1.0, 0.04, 0.12, 0.08, 0.25, accent, 0.5),
      ].join('')
    : [
        // 左下角大块浅绿（参考图的绿色主块）
        shape(-0.08, 1.08, 0.3, 0.24, 0.16, shapeA, 1),
        // 底部中间的淡绿带
        shape(0.46, 1.1, 0.4, 0.2, 0.2, shapeB, 0.95),
        // 右下角亮黄
        shape(1.02, 0.92, 0.2, 0.16, 0.18, accent, 0.9),
        // 右侧淡绿
        shape(1.04, 0.46, 0.17, 0.24, 0.2, shapeB, 0.9),
        // 左侧淡绿
        shape(-0.08, 0.4, 0.14, 0.2, 0.22, shapeB, 0.85),
        // 右上角淡黄（品牌位是白色卡片，压在色块上反而更干净）
        shape(0.99, 0.1, 0.13, 0.1, 0.25, accent, 0.5),
      ].join('');

  const dots: string[] = [];
  const dotSpots: [number, number, number][] = isTall
    ? [
        [0.08, 0.94, 0.012],
        [0.94, 0.05, 0.01],
        [0.5, 0.012, 0.009],
        [0.2, 0.985, 0.01],
        [0.72, 0.99, 0.008],
      ]
    : [
        [0.1, 0.86, 0.012],
        [0.92, 0.3, 0.01],
        [0.86, 0.68, 0.014],
        [0.5, 0.035, 0.009],
        [0.22, 0.985, 0.01],
        [0.72, 0.99, 0.008],
      ];
  for (const [dx, dy, dr] of dotSpots) {
    dots.push(`<circle cx="${(dx * W).toFixed(1)}" cy="${(dy * H).toFixed(1)}" r="${(dr * Math.min(W, H)).toFixed(1)}" fill="${dot}" fill-opacity="0.55"/>`);
  }

  return `<defs>
  <linearGradient id="organicBase" x1="0" y1="0" x2="0.25" y2="1">
    <stop offset="0%" stop-color="${base}"/>
    <stop offset="100%" stop-color="${base2}"/>
  </linearGradient>
  <radialGradient id="organicLight" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.6"/>
    <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="organicFade" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="#000000"/>
    <stop offset="26%" stop-color="#000000"/>
    <stop offset="72%" stop-color="#8A8A8A"/>
    <stop offset="100%" stop-color="#FFFFFF"/>
  </radialGradient>
  <mask id="organicMask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}">
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#organicFade)"/>
  </mask>
</defs>
<rect width="${W}" height="${H}" fill="url(#organicBase)"/>
<ellipse cx="${(W * 0.5).toFixed(1)}" cy="${(H * 0.46).toFixed(1)}" rx="${(W * 0.62).toFixed(1)}" ry="${(H * 0.42).toFixed(1)}" fill="url(#organicLight)"/>
<g mask="url(#organicMask)">
${shapes}
${dots.join('')}
</g>`;
}

// ============ 极光背景（浅色科技封面） ============

/**
 * 极光背景：近白底 + 底部蓝/青/紫柔光 + 底部渐变地台。
 *
 * 浅色科技封面的底：上半部大面积留白给标题，中下部用三团极光撑住画面，
 * 底部一条深蓝→紫的地台给主视觉（笔记本 / 角色）一个落位。
 */
function auroraBackgroundSvg(W: number, H: number, pal: PosterPalette): string {
  const cfg = pal.aurora;
  const base = cfg?.base ?? pal.bg.top;
  const ground = cfg?.ground ?? ['#123A86', '#4A1E8C'];
  const glows = cfg?.glows ?? [
    { color: pal.glow, opacity: 0.18 },
    { color: pal.glow2, opacity: 0.15 },
    { color: pal.glow3, opacity: 0.14 },
  ];
  const groundTop = cfg?.groundTop ?? 0.78;
  const groundHeight = cfg?.groundHeight ?? 0.22;
  const groundShade = cfg?.groundShade ?? 0.5;

  const defs = glows
    .map(
      (glow, index) => `<radialGradient id="auroraGlow${index}" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="${glow.color}" stop-opacity="${glow.opacity}"/>
    <stop offset="55%" stop-color="${glow.color}" stop-opacity="${(glow.opacity * 0.35).toFixed(3)}"/>
    <stop offset="100%" stop-color="${glow.color}" stop-opacity="0"/>
  </radialGradient>`,
    )
    .join('\n');

  const blobs = (cfg?.blobs ?? [
    { cx: 0.08, cy: 0.62, rx: 0.34, ry: 0.2 },
    { cx: 0.52, cy: 0.82, rx: 0.46, ry: 0.26 },
    { cx: 0.94, cy: 0.72, rx: 0.4, ry: 0.24 },
  ])
    .map(
      (blob, index) =>
        `<ellipse cx="${(W * blob.cx).toFixed(1)}" cy="${(H * blob.cy).toFixed(1)}" rx="${(W * blob.rx).toFixed(1)}" ry="${(H * blob.ry).toFixed(1)}" fill="url(#auroraGlow${index % glows.length})"/>`,
    )
    .join('\n');

  const groundY = H * groundTop;
  const groundH = H * groundHeight;
  // 地台渐变支持多档色标（青 → 深蓝 → 紫），比两色更接近参考图
  const groundStops = ground
    .map((color, index) => {
      const offset = ground.length === 1 ? 0 : Math.round((index / (ground.length - 1)) * 100);
      return `<stop offset="${offset}%" stop-color="${color}"/>`;
    })
    .join('\n    ');
  // 地台顶部浅色叠层：横向色标 + 纵向衰减（模拟「地面远端发亮」）
  const tint = cfg?.groundTopTint;
  const tintOpacity = cfg?.groundTopTintOpacity ?? 0;
  const tintFade = cfg?.groundTopTintFade ?? 0.45;
  const tintH = groundH * tintFade;
  const tintStops = (tint ?? [])
    .map((color, index) => {
      const offset = tint.length === 1 ? 0 : Math.round((index / (tint.length - 1)) * 100);
      return `<stop offset="${offset}%" stop-color="${color}" stop-opacity="${tintOpacity}"/>`;
    })
    .join('\n    ');

  return `<defs>
${defs}
  <linearGradient id="auroraGround" x1="0" y1="0" x2="1" y2="0">
    ${groundStops}
  </linearGradient>
  <linearGradient id="auroraGroundShade" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000000" stop-opacity="0"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="${groundShade}"/>
  </linearGradient>
  <linearGradient id="auroraGroundMaskGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000000"/>
    <stop offset="100%" stop-color="#ffffff"/>
  </linearGradient>
  <mask id="auroraGroundMask">
    <rect x="0" y="${(groundY - groundH * 0.55).toFixed(1)}" width="${W}" height="${(groundH * 0.55).toFixed(1)}" fill="url(#auroraGroundMaskGrad)"/>
  </mask>
  ${tint && tintOpacity > 0 ? `<linearGradient id="auroraGroundTint" x1="0" y1="0" x2="1" y2="0">
    ${tintStops}
  </linearGradient>
  <linearGradient id="auroraTintFadeGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#ffffff"/>
    <stop offset="100%" stop-color="#000000"/>
  </linearGradient>
  <mask id="auroraTintMask">
    <rect x="0" y="${groundY.toFixed(1)}" width="${W}" height="${tintH.toFixed(1)}" fill="url(#auroraTintFadeGrad)"/>
  </mask>` : ''}
</defs>
<rect width="${W}" height="${H}" fill="${base}"/>
${blobs}
<rect x="0" y="${(groundY - groundH * 0.55).toFixed(1)}" width="${W}" height="${(groundH * 0.55).toFixed(1)}" fill="url(#auroraGround)" mask="url(#auroraGroundMask)"/>
<rect x="0" y="${groundY.toFixed(1)}" width="${W}" height="${groundH.toFixed(1)}" fill="url(#auroraGround)"/>
${tint && tintOpacity > 0 ? `<rect x="0" y="${groundY.toFixed(1)}" width="${W}" height="${tintH.toFixed(1)}" fill="url(#auroraGroundTint)" mask="url(#auroraTintMask)"/>` : ''}
<rect x="0" y="${groundY.toFixed(1)}" width="${W}" height="${groundH.toFixed(1)}" fill="url(#auroraGroundShade)"/>`;
}

// ============ 右上角品牌位 ============

/**
 * 右上角品牌位：白色圆角卡片托住 Logo + 品牌名。
 *
 * 为什么单独一层：
 *   品牌位要钉在成品画布的右上角（像素级固定），不能跟着内容等比缩放；
 *   浅蓝 Logo 放到深绿 / 深蓝底上会糊，所以统一用白色图标块托底。
 */
function cornerMarkSvg(W: number, H: number, pal: PosterPalette, mark: PosterCornerMark): string {
  const logoH = mark.logoHeight ?? W * 0.03;
  const logoW = mark.logoWidth ?? logoH;
  const textSize = W * (mark.textScale ?? 0.02);
  const offsetX = mark.offsetX ?? W * 0.016;
  const offsetY = mark.offsetY ?? W * 0.012;
  const gap = W * 0.008;
  const textW = mark.text ? textWidth(mark.text, textSize) : 0;

  const groupW = (mark.logo ? logoW : 0) + (mark.text ? gap + textW : 0);
  const groupH = Math.max(logoH, textSize * 1.1);
  const left = mark.position === 'bottom-left' ? offsetX : W - offsetX - groupW;
  const top = H - offsetY - groupH;

  const parts: string[] = [];
  let cursor = left;
  if (mark.logo) {
    parts.push(
      `<image href="${mark.logo}" xlink:href="${mark.logo}" x="${cursor.toFixed(1)}" y="${(top + (groupH - logoH) / 2).toFixed(1)}" width="${logoW.toFixed(1)}" height="${logoH.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
    cursor += logoW + (mark.text ? gap : 0);
  }
  if (mark.text) {
    parts.push(
      textEl({
        x: cursor,
        y: top + groupH / 2 + textSize * 0.35,
        text: mark.text,
        size: textSize,
        fill: mark.color ?? pal.brandText ?? '#171719',
        weight: 700,
      }),
    );
  }
  return parts.join('');
}

function brandSvg(W: number, H: number, pal: PosterPalette, brand: PosterBrand): string {
  const position = brand.position ?? 'top-right';
  const style = brand.style ?? 'chip';
  const padRight = W * 0.055;
  const top = W * 0.035;
  const logoH = brand.logoHeight ?? W * 0.05;
  const logoW = brand.logoWidth ?? logoH * 1.27;
  const textSize = W * (brand.textScale ?? 0.028);
  const textW = textWidth(brand.text, textSize);
  const gap = W * 0.014;
  const padX = W * 0.016;
  const padY = W * 0.013;

  const hasLogo = Boolean(brand.logo);
  const innerW = (hasLogo ? logoW + gap : 0) + textW;
  const chipW = innerW + padX * 2;
  const chipH = logoH + padY * 2;

  // 位置：top-right（历史行为）/ top-left / bottom-center
  // offsetX / offsetY 可覆写默认边距（1:1 复刻参考版式时用）
  let chipX: number;
  let chipY: number;
  if (position === 'top-left') {
    chipX = brand.offsetX ?? W * 0.055;
    chipY = brand.offsetY ?? top;
  } else if (position === 'bottom-center') {
    chipX = (W - chipW) / 2 + (brand.offsetX ?? 0);
    chipY = H - top - chipH + (brand.offsetY ?? 0);
  } else {
    chipX = W - padRight - chipW + (brand.offsetX ?? 0);
    chipY = top + (brand.offsetY ?? 0);
  }

  const isChip = style === 'chip';
  // plain 样式不加内边距：Logo 直接坐在起点上，文字与 Logo 垂直居中对齐
  const contentX = isChip ? chipX + padX : chipX;
  const contentY = isChip ? chipY + padY : chipY;
  const contentH = hasLogo ? logoH : textSize * 1.2;

  const parts: string[] = [];
  if (isChip) {
    parts.push(
      `<rect x="${chipX.toFixed(1)}" y="${chipY.toFixed(1)}" width="${chipW.toFixed(1)}" height="${chipH.toFixed(1)}" rx="${(chipH * 0.3).toFixed(1)}" fill="#FFFFFF" fill-opacity="0.95" stroke="#123A2B" stroke-opacity="0.1" stroke-width="1"/>`,
    );
  }

  let cursor = contentX;
  if (hasLogo && brand.logo) {
    parts.push(
      `<image href="${brand.logo}" xlink:href="${brand.logo}" x="${cursor.toFixed(1)}" y="${contentY.toFixed(1)}" width="${logoW.toFixed(1)}" height="${logoH.toFixed(1)}" preserveAspectRatio="xMidYMid meet"/>`,
    );
    cursor += logoW + gap;
  }

  parts.push(
    textEl({
      x: cursor,
      y: contentY + contentH / 2 + textSize * 0.35,
      text: brand.text,
      size: textSize,
      fill: pal.brandText ?? '#123A2B',
      weight: 800,
      letterSpacing: textSize * 0.04,
    }),
  );

  return parts.join('');
}

// ============ 主入口 ============

/** 只排内容（不含背景层），返回局部坐标下的 SVG 与内容高度 */
function renderContent(
  blocks: PosterBlock[],
  ctx: BlockContext,
  fillExtra = 0,
  padding?: { top?: number; bottom?: number },
): { svg: string; height: number } {
  const { W } = ctx;
  const rendered = blocks.map((block) => renderBlock(block, ctx));
  const blockGap = W * 0.058;
  const topPad = padding?.top ?? W * 0.085;
  const bottomPad = padding?.bottom ?? W * 0.06;

  // 弹性占位：把多余高度平均分给 fill: true 的 spacer
  const fillIndexes = blocks
    .map((block, index) => ((block as any).kind === 'spacer' && (block as any).fill ? index : -1))
    .filter((index) => index >= 0);
  if (fillIndexes.length && fillExtra > 0) {
    const each = fillExtra / fillIndexes.length;
    for (const index of fillIndexes) rendered[index] = { height: each, svg: '' };
  }

  let contentHeight = 0;
  rendered.forEach((r, index) => {
    contentHeight += r.height;
    if (index < rendered.length - 1) contentHeight += blockGapOf(blocks, index, blockGap);
  });

  const parts: string[] = [];
  let y = topPad;
  rendered.forEach((r, index) => {
    if (r.svg) {
      parts.push(`<g transform="translate(0, ${y.toFixed(1)})">${r.svg}</g>`);
    }
    y += r.height + (index < rendered.length - 1 ? blockGapOf(blocks, index, blockGap) : 0);
  });

  return { svg: parts.join(String.fromCharCode(10)), height: Math.round(topPad + contentHeight + bottomPad) };
}

/**
 * 渲染一张结构化海报。
 * 返回的 SVG 只含压暗层与光晕（半透明），需由调用方 composite 到底图上。
 */
export function renderPoster(blocks: PosterBlock[], options: PosterOptions): PosterResult {
  const W = Math.round(options.width);
  const pal = PALETTES[options.tone ?? 'deep_blue'];
  const padX = W * 0.067;
  const contentW = W - padX * 2;
  const ctx: BlockContext = { W, contentW, padX, pal, H: options.fit?.height };

  const { svg: measuredSvg, height: measuredHeight } = renderContent(blocks, ctx, 0, options.padding);

  let content = measuredSvg;
  let naturalHeight = measuredHeight;

  let outW = W;
  let outH = naturalHeight;
  let contentTransform = '';
  if (options.fit) {
    outW = Math.round(options.fit.width);
    outH = Math.round(options.fit.height);
    // 等比缩放 + 居中：强制 1:1 方图时既不拉伸也不裁切
    const scaleX = outW / W;
    // 弹性占位：把「目标高度」换算回布局单位，把差额补给 fill: true 的 spacer，
    // 这样内容既按宽度缩放，又正好填满目标画布（不靠居中留白）
    const layoutTarget = outH / scaleX;
    if (layoutTarget > naturalHeight) {
      const extra = layoutTarget - naturalHeight;
      const stretched = renderContent(blocks, ctx, extra, options.padding);
      if (stretched.height > naturalHeight) {
        content = stretched.svg;
        naturalHeight = stretched.height;
      }
    }
    const scale = Math.min(outW / W, outH / naturalHeight);
    const dx = (outW - W * scale) / 2;
    const anchor = options.fit.anchor ?? 'center';
    const dy =
      anchor === 'top'
        ? 0
        : anchor === 'bottom'
          ? outH - naturalHeight * scale
          : (outH - naturalHeight * scale) / 2;
    contentTransform = ` transform="translate(${dx.toFixed(1)}, ${dy.toFixed(1)}) scale(${scale.toFixed(4)})"`;
  }

  const glowX = options.glowX ?? 0.68;
  const backgroundMode = options.background ?? 'gradient';
  const useGradient = backgroundMode === 'gradient';
  const useSolid = backgroundMode === 'solid';
  const useOrganic = backgroundMode === 'organic';
  const useAurora = backgroundMode === 'aurora';
  const nl = String.fromCharCode(10);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">
<defs>
  <linearGradient id="baseGrad" x1="0" y1="0" x2="0.3" y2="1">
    <stop offset="0%" stop-color="${pal.bg.top}"/>
    <stop offset="45%" stop-color="${pal.bg.mid}"/>
    <stop offset="100%" stop-color="${pal.bg.bottom}"/>
  </linearGradient>
  <linearGradient id="gridMask" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="${pal.bg.grid}" stop-opacity="${(pal.bg.gridOpacity * 1.7).toFixed(3)}"/>
    <stop offset="55%" stop-color="${pal.bg.grid}" stop-opacity="0"/>
    <stop offset="100%" stop-color="${pal.bg.grid}" stop-opacity="${pal.bg.gridOpacity.toFixed(3)}"/>
  </linearGradient>
  <linearGradient id="beamGrad" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0%" stop-color="${pal.bg.beam}" stop-opacity="0"/>
    <stop offset="45%" stop-color="${pal.bg.beam}" stop-opacity="0.6"/>
    <stop offset="100%" stop-color="${pal.bg.beam}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="glowA" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="${pal.glow}" stop-opacity="${pal.glowOpacity[0]}"/>
    <stop offset="55%" stop-color="${pal.glow}" stop-opacity="${(pal.glowOpacity[0] * 0.24).toFixed(3)}"/>
    <stop offset="100%" stop-color="${pal.glow}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glowB" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="${pal.glow2}" stop-opacity="${pal.glowOpacity[1]}"/>
    <stop offset="60%" stop-color="${pal.glow2}" stop-opacity="${(pal.glowOpacity[1] * 0.25).toFixed(3)}"/>
    <stop offset="100%" stop-color="${pal.glow2}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glowC" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="${pal.glow3}" stop-opacity="${pal.glowOpacity[2]}"/>
    <stop offset="60%" stop-color="${pal.glow3}" stop-opacity="${(pal.glowOpacity[2] * 0.23).toFixed(3)}"/>
    <stop offset="100%" stop-color="${pal.glow3}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="vignette" cx="0.5" cy="0.45" r="0.72">
    <stop offset="0%" stop-color="${pal.bg.vignette}" stop-opacity="0"/>
    <stop offset="70%" stop-color="${pal.bg.vignette}" stop-opacity="${(pal.bg.vignetteOpacity * 0.35).toFixed(3)}"/>
    <stop offset="100%" stop-color="${pal.bg.vignette}" stop-opacity="${pal.bg.vignetteOpacity}"/>
  </radialGradient>
  <linearGradient id="posterScrim" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0%" stop-color="${pal.scrim}" stop-opacity="${pal.scrimOpacity[0]}"/>
    <stop offset="45%" stop-color="${pal.scrim}" stop-opacity="${pal.scrimOpacity[1]}"/>
    <stop offset="100%" stop-color="${pal.scrim}" stop-opacity="${pal.scrimOpacity[2]}"/>
  </linearGradient>
  <linearGradient id="posterTitle" x1="${pal.titleGradient.x1}" y1="${pal.titleGradient.y1}" x2="${pal.titleGradient.x2}" y2="${pal.titleGradient.y2}">
    ${pal.titleStops
      .map((color, index) => `<stop offset="${Math.round((index / Math.max(1, pal.titleStops.length - 1)) * 100)}%" stop-color="${color}"/>`)
      .join('')}
  </linearGradient>
  ${pal.card ? `<linearGradient id="posterTitleCard" x1="${pal.titleGradient.x1}" y1="${pal.titleGradient.y1}" x2="${pal.titleGradient.x2}" y2="${pal.titleGradient.y2}">
    ${pal.card.titleStops
      .map((color, index) => `<stop offset="${Math.round((index / Math.max(1, pal.card.titleStops.length - 1)) * 100)}%" stop-color="${color}"/>`)
      .join('')}
  </linearGradient>` : ''}
  <linearGradient id="posterAccent" x1="0" y1="0" x2="1" y2="0">
    ${pal.accentStops
      .map((color, index) => `<stop offset="${Math.round((index / Math.max(1, pal.accentStops.length - 1)) * 100)}%" stop-color="${color}"/>`)
      .join('')}
  </linearGradient>
  <radialGradient id="posterGlow" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0%" stop-color="${pal.glow}" stop-opacity="0.32"/>
    <stop offset="60%" stop-color="${pal.glow}" stop-opacity="0.07"/>
    <stop offset="100%" stop-color="${pal.glow}" stop-opacity="0"/>
  </radialGradient>
  <filter id="posterGlowF" x="-30%" y="-40%" width="160%" height="200%">
    <feDropShadow dx="0" dy="${Math.max(2, Math.round(W * 0.005))}" stdDeviation="${Math.max(3, Math.round(W * 0.008))}" flood-color="${pal.glow}" flood-opacity="0.38"/>
  </filter>
  <filter id="posterCardShadow" x="-20%" y="-20%" width="140%" height="160%">
    <feGaussianBlur stdDeviation="${Math.max(4, Math.round(W * 0.012))}"/>
  </filter>
</defs>
${useGradient
  ? backgroundSvg(outW, outH, pal, glowX)
  : useSolid
    ? `<rect width="${outW}" height="${outH}" fill="${pal.bg.top}"/>`
    : useOrganic
      ? organicBackgroundSvg(outW, outH, pal)
      : useAurora
        ? auroraBackgroundSvg(outW, outH, pal)
        : `<rect width="${outW}" height="${outH}" fill="url(#posterScrim)"/>
<ellipse cx="${(outW * glowX).toFixed(1)}" cy="${(outH * 0.06).toFixed(1)}" rx="${(outW * 0.85).toFixed(1)}" ry="${(outH * 0.2).toFixed(1)}" fill="url(#posterGlow)"/>`}
<g${contentTransform}>
${content}
</g>
${options.brand ? brandSvg(outW, outH, pal, options.brand) : ''}
${options.cornerMark ? cornerMarkSvg(outW, outH, pal, options.cornerMark) : ''}
</svg>`;

  return { svg, width: outW, height: outH };
}
