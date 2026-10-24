/**
 * 公共类型定义
 */

export type AspectRatio =
  | '1:1' | '3:2' | '2:3' | '3:4' | '4:3'
  | '16:9' | '9:16' | '21:9' | '5:4';

export type Category = 'cover' | 'top_banner' | 'mid_banner' | 'popup' | 'custom';

/** 场景库 key（与 src/lib/scenes.ts 中的 SceneKey 一致） */
export type SceneKey = 'livestream' | 'product_launch' | 'holiday' | 'recruiting';

export type ColorTone = 'blue_purple' | 'black_gold';

export interface ThemeConfig {
  title?: string;
  subtitle?: string;
  tags?: string[];
  gifts?: Array<{ name: string; value: string }>;
}

/** v0.2: A/B 变体生成配置 */
export interface VariantConfig {
  /** 生成张数（1~5，默认 1） */
  count: number;
  /** 变体策略：parallel 复用同一 prompt，diverse 在 prompt 中注入视角/光照种子 */
  strategy: 'parallel' | 'diverse';
}

export interface VisualDNA {
  palette: string[];
  composition: string;
  lighting: string;
  textures: string[];
  typography: string;
  mood: string;
  design_patterns: string[];
  ip_visibility: {
    lobster_mascot: boolean;
    logo: boolean;
  };
  key_elements: string[];
}

export interface BrandContext {
  colorTone?: ColorTone;
  useLobster?: boolean;
  brandName?: string;
  ipName?: string;
}

export interface PresetConfig {
  ratio: AspectRatio;
  size: { w: number; h: number };
  promptHint: string;
}

export interface Task {
  id: string;
  userId: string;
  category: Category;
  refImages: string[];
  theme: ThemeConfig;
  ratio: AspectRatio;
  /** 业务场景 key（livestream/product_launch/holiday/recruiting） */
  scene?: SceneKey;
  /** 用户手写提示词（覆盖模板） */
  customPrompt?: string;
  /** v0.2: 本次任务的变体配置（默认 count=1） */
  variantConfig?: VariantConfig;
  status: TaskStatus;
  progress: number;
  result?: TaskResult;
  error?: string;
  createdAt: string;
  completedAt?: string;
}

export type TaskStatus =
  | 'pending' | 'analyzing' | 'generating' | 'completed' | 'failed';

export interface TaskResult {
  /** 首张变体 URL（兼容老调用方，等价于 variants[0].url） */
  imageUrl: string;
  thumbUrl?: string;
  /** v0.2: 多变体结果（variantCount=1 时长度为 1） */
  variants?: Array<{
    url: string;
    width: number;
    height: number;
    bytes: number;
  }>;
  params: Record<string, unknown>;
}

export interface BrandAsset {
  id: string;
  type: 'logo' | 'mascot' | 'palette' | 'font';
  url: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
