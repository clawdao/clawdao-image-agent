export const POSTER_V2_SCHEMA_VERSION = 2 as const;
export const POSTER_ENGINE = 'fabric' as const;

export type PosterV2Engine = typeof POSTER_ENGINE;

export type PosterCanvasSize = { width: number; height: number };

/**
 * 画布背景。
 * 迁移补丁：ddn-hub 原类型里只在 PosterOperation 里内联写了一份，
 * 这里抽成独立类型，供「背景设置面板」与 exportPng 复用。
 */
export type PosterBackground =
  | { type: 'solid'; color: string }
  | {
      type: 'gradient';
      gradient: { type: 'linear' | 'radial'; colors: string[] };
    }
  | { type: 'image'; src: string };

export type BindingRule = {
  kind: 'template' | 'expression';
  source: string;
};

export type PosterBindings = {
  [objectId: string]: {
    [prop: string]: BindingRule;
  };
};

export type PosterDesignV2Config = {
  engine: PosterV2Engine;
  schemaVersion: typeof POSTER_V2_SCHEMA_VERSION;
  canvas: PosterCanvasSize;
  templateId?: string;
  /**
   * 画布背景。
   *
   * 迁移补丁：Fabric 的 backgroundColor / backgroundImage 不在 fabricJson 里
   * （保存时会剥掉），所以背景必须随设计对象一起保存，否则草稿丢失背景。
   */
  background?: PosterBackground;
  fabricJson: any;
  bindings?: PosterBindings;
  dataSchema?: { jsonSchema: any };
  defaultData?: Record<string, any>;
};

export type DataContext = Record<string, any>;

export type PosterOperation =
  | {
      op: 'addText';
      id?: string;
      text: string;
      left: number;
      top: number;
      width?: number;
      fontSize?: number;
      fill?: string;
      fontWeight?: string | number;
      textAlign?: 'left' | 'center' | 'right' | 'justify';
      ddnRole?: string;
    }
  | {
      op: 'addImage';
      id?: string;
      src: string;
      left: number;
      top: number;
      width?: number;
      height?: number;
      originX?: 'left' | 'center' | 'right';
      originY?: 'top' | 'center' | 'bottom';
      ddnRole?: string;
    }
  | {
      op: 'updateText';
      id: string;
      text?: string;
      fontSize?: number;
      fill?: string;
      fontWeight?: string | number;
      textAlign?: 'left' | 'center' | 'right' | 'justify';
    }
  | {
      op: 'move';
      id: string;
      left: number;
      top: number;
    }
  | {
      op: 'resize';
      id: string;
      scaleX?: number;
      scaleY?: number;
      width?: number;
      height?: number;
    }
  | {
      op: 'rotate';
      id: string;
      angle: number;
    }
  | {
      op: 'replaceImage';
      id: string;
      src: string;
    }
  | {
      op: 'setBackground';
      background:
        | { type: 'solid'; color: string }
        | {
            type: 'gradient';
            gradient: { type: 'linear' | 'radial'; colors: string[] };
          }
        | { type: 'image'; src: string };
    }
  | {
      op: 'lock';
      id: string;
      locked: boolean;
    };

export type PosterAIAssistantResult = {
  success: boolean;
  operations: PosterOperation[];
  explanation?: string;
  suggestions?: string[];
};
