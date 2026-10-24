/**
 * poster-ops.ts — 海报编辑器的「AI 指令」层
 *
 * 背景：
 *   ddn-hub 的 PosterDesigner 里，AI 面板是**假的**（services/aiPoster.ts 返回随机 mock 操作）。
 *   本项目把它换成真的：LLM 读当前画布（Fabric JSON）→ 输出一组**受控操作**
 *   （PosterOperation[]），前端 applyOperations 直接落到画布上。
 *
 * 为什么要受控：
 *   让 LLM 直接吐 Fabric JSON 等于让它做像素级排版——慢、不准、不可复现。
 *   只允许它吐「加字 / 改字 / 移动 / 缩放 / 旋转 / 换图 / 换底 / 锁定」这 9 个原子操作，
 *   既有语义约束，又能被校验、被撤销、能审计。
 *
 * 本文件是纯函数（无 IO），便于单测。
 */

/* ------------------------------------------------------------------ */
/* 类型（与 web/src/modules/poster/types.ts 保持一致）                 */
/* ------------------------------------------------------------------ */

export type PosterBackground =
  | { type: 'solid'; color: string }
  | { type: 'gradient'; gradient: { type: 'linear' | 'radial'; colors: string[] } }
  | { type: 'image'; src: string };

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
  | { op: 'move'; id: string; left: number; top: number }
  | {
      op: 'resize';
      id: string;
      scaleX?: number;
      scaleY?: number;
      width?: number;
      height?: number;
    }
  | { op: 'rotate'; id: string; angle: number }
  | { op: 'replaceImage'; id: string; src: string }
  | { op: 'setBackground'; background: PosterBackground }
  | { op: 'lock'; id: string; locked: boolean };

export const ALLOWED_OPS = [
  'addText',
  'addImage',
  'updateText',
  'move',
  'resize',
  'rotate',
  'replaceImage',
  'setBackground',
  'lock',
] as const;

/** 单次最多允许的操作数（与 ddn-hub 的 MVP 限制一致，避免 LLM 一次把画布改乱） */
export const MAX_OPERATIONS = 3;

/* ------------------------------------------------------------------ */
/* 画布摘要（喂给 LLM 的上下文）                                       */
/* ------------------------------------------------------------------ */

interface FabricObjectLike {
  id?: string;
  type?: string;
  ddnRole?: string;
  text?: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  fontSize?: number;
  fill?: string;
  fontWeight?: string | number;
  src?: string;
  locked?: boolean;
}

export interface PosterDesignLike {
  canvas?: { width: number; height: number };
  fabricJson?: { objects?: FabricObjectLike[] } | null;
}

/**
 * 把画布压缩成一段可读文本。
 *
 * 只喂必要信息：id（后续操作要引用）、角色、类型、文字摘要、位置尺寸。
 * 整张 JSON 塞进去会让 LLM 既慢又容易照抄旧文案。
 */
export function summarizeDesign(design: PosterDesignLike): string {
  const canvas = design?.canvas;
  const objects = design?.fabricJson?.objects ?? [];
  if (!canvas && objects.length === 0) {
    return '（空画布）';
  }

  const lines: string[] = [];
  lines.push(
    `画布尺寸：${canvas?.width ?? '?'} × ${canvas?.height ?? '?'}（单位 px，左上角为原点）`,
  );
  lines.push(`对象总数：${objects.length}`);

  objects.forEach((obj, index) => {
    const parts: string[] = [];
    parts.push(`#${index}`);
    if (obj.id) parts.push(`id=${obj.id}`);
    if (obj.ddnRole) parts.push(`角色=${obj.ddnRole}`);
    if (obj.type) parts.push(`类型=${obj.type}`);
    if (typeof obj.text === 'string' && obj.text.trim()) {
      const text = obj.text.replace(/\s+/g, ' ').trim();
      parts.push(`文字="${text.length > 40 ? `${text.slice(0, 40)}…` : text}"`);
    }
    if (typeof obj.left === 'number' || typeof obj.top === 'number') {
      parts.push(`位置=(${Math.round(obj.left ?? 0)}, ${Math.round(obj.top ?? 0)})`);
    }
    if (typeof obj.width === 'number' || typeof obj.height === 'number') {
      parts.push(`尺寸=${Math.round(obj.width ?? 0)}×${Math.round(obj.height ?? 0)}`);
    }
    if (typeof obj.fontSize === 'number') parts.push(`字号=${obj.fontSize}`);
    if (typeof obj.fill === 'string') parts.push(`颜色=${obj.fill}`);
    if (obj.locked) parts.push('已锁定');
    lines.push(`- ${parts.join('，')}`);
  });

  return lines.join('\n');
}

/* ------------------------------------------------------------------ */
/* 提示词                                                             */
/* ------------------------------------------------------------------ */

export const OPS_SYSTEM_PROMPT = `你是海报设计器的「指令执行器」。用户会给你当前画布摘要和一句中文指令。
你只能输出 JSON，不要输出任何解释性文字或 Markdown 代码块以外的内容。

JSON 格式：
{"operations":[{"op":"...","...":"..."}],"explanation":"一句话说明做了什么","suggestions":["可选的后续建议"]}

你只能使用以下 9 个操作，且最多输出 ${MAX_OPERATIONS} 个：
1. addText      {op,id?,text,left,top,width?,fontSize?,fill?,fontWeight?,textAlign?,ddnRole?}
2. addImage     {op,id?,src,left,top,width?,height?,originX?,originY?,ddnRole?}
3. updateText   {op,id,text?,fontSize?,fill?,fontWeight?,textAlign?}
4. move         {op,id,left,top}
5. resize       {op,id,scaleX?,scaleY?,width?,height?}
6. rotate       {op,id,angle}
7. replaceImage {op,id,src}
8. setBackground{op,background:{type:"solid",color} | {type:"gradient",gradient:{type:"linear"|"radial",colors:[...]}} | {type:"image",src}}
9. lock         {op,id,locked}

硬性要求：
- 修改已有对象时，id 必须来自画布摘要里出现过的 id，不得凭空编造。
- 坐标以画布左上角为原点，单位 px，必须落在画布范围内。
- 中文文案要短（标题 ≤ 14 字，说明 ≤ 30 字），不要写价格、承诺、联系方式。
- 不要输出 markdown 代码块以外的内容；不要解释你的推理过程。
- 若指令无法用上述操作表达，输出 {"operations":[],"explanation":"该指令暂不支持"}。`;

export function buildOpsUserPrompt(design: PosterDesignLike, instruction: string): string {
  return `【当前画布】\n${summarizeDesign(design)}\n\n【用户指令】\n${instruction}`;
}

/* ------------------------------------------------------------------ */
/* 解析 + 校验                                                         */
/* ------------------------------------------------------------------ */

function extractJson(text: string): unknown {
  const raw = String(text ?? '').trim();
  if (!raw) throw new Error('LLM 返回为空');

  // 优先取 ```json ... ``` 包裹块
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], raw].filter(Boolean) as string[];

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    try {
      return JSON.parse(trimmed);
    } catch {
      // 继续尝试：截取第一个 { 到最后一个 }
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(trimmed.slice(start, end + 1));
        } catch {
          /* ignore */
        }
      }
    }
  }
  throw new Error('LLM 返回不是合法 JSON');
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface OpsValidationContext {
  /** 画布宽高，用于坐标越界检查 */
  canvas?: { width: number; height: number };
  /** 当前画布上的对象 id 集合 */
  objectIds?: Set<string>;
  /** 允许的图片来源前缀（默认只允许站内 /outputs/ 与 data:image/） */
  allowedImagePrefixes?: string[];
}

export interface OpsValidationResult {
  ok: boolean;
  operations: PosterOperation[];
  rejected: string[];
  error?: string;
}

/**
 * 校验 LLM 产出的操作。
 *
 * 这是 AI 指令层的**安全闸门**：LLM 只允许在画布上做「白名单里的事」，
 * 不能引用不存在的对象、不能把图片换成任意外链、不能越界。
 */
export function validateOperations(
  raw: unknown,
  ctx: OpsValidationContext = {},
): OpsValidationResult {
  const rejected: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { ok: false, operations: [], rejected, error: 'operations 格式非法' };
  }
  const payload = raw as {operations?: unknown; explanation?: string; suggestions?: unknown};
  const list = Array.isArray(payload.operations) ? payload.operations : [];

  if (list.length === 0) {
    return { ok: true, operations: [], rejected, error: 'LLM 未给出可执行操作' };
  }
  if (list.length > MAX_OPERATIONS) {
    rejected.push(`操作数 ${list.length} 超过上限 ${MAX_OPERATIONS}，已截断`);
  }

  const objectIds = ctx.objectIds ?? new Set<string>();
  const prefixes = ctx.allowedImagePrefixes ?? ['/outputs/', 'data:image/', 'blob:'];

  const hasId = (op: any): boolean => {
    const id = String(op?.id ?? '');
    if (!id) return false;
    if (objectIds.size === 0) return true; // 没给上下文时不拦截
    if (objectIds.has(id)) return true;
    rejected.push(`引用了不存在的对象 id=${id}`);
    return false;
  };

  const checkImageSrc = (op: any, field: string): boolean => {
    const src = String(op?.[field] ?? '');
    if (!src) {
      rejected.push(`${op?.op}.${field} 缺少图片地址`);
      return false;
    }
    if (!prefixes.some((prefix) => src.startsWith(prefix))) {
      rejected.push(`${op?.op}.${field} 来源不被允许：${src.slice(0, 60)}`);
      return false;
    }
    return true;
  };

  const checkCoord = (op: any, field: 'left' | 'top'): boolean => {
    const value = op?.[field];
    if (!isFiniteNumber(value)) {
      rejected.push(`${op?.op}.${field} 不是数字`);
      return false;
    }
    const max = field === 'left' ? ctx.canvas?.width : ctx.canvas?.height;
    if (max && (value < -50 || value > max + 50)) {
      rejected.push(`${op?.op}.${field}=${value} 超出画布范围`);
      return false;
    }
    return true;
  };

  const operations: PosterOperation[] = [];

  for (const item of list.slice(0, MAX_OPERATIONS)) {
    const op = item as any;
    const name = String(op?.op ?? '');
    if (!(ALLOWED_OPS as readonly string[]).includes(name)) {
      rejected.push(`未知操作 ${name}`);
      continue;
    }

    switch (name) {
      case 'addText': {
        const text = String(op.text ?? '').trim();
        if (!text) {
          rejected.push('addText 缺少文字');
          break;
        }
        if (!checkCoord(op, 'left') || !checkCoord(op, 'top')) break;
        operations.push({
          op: 'addText',
          id: op.id ? String(op.id) : undefined,
          text,
          left: Math.round(op.left),
          top: Math.round(op.top),
          width: isFiniteNumber(op.width) ? Math.round(op.width) : undefined,
          fontSize: isFiniteNumber(op.fontSize) ? Math.round(op.fontSize) : undefined,
          fill: typeof op.fill === 'string' && HEX_COLOR_RE.test(op.fill) ? op.fill : undefined,
          fontWeight: typeof op.fontWeight === 'string' || isFiniteNumber(op.fontWeight) ? op.fontWeight : undefined,
          textAlign: ['left', 'center', 'right', 'justify'].includes(op.textAlign) ? op.textAlign : undefined,
          ddnRole: typeof op.ddnRole === 'string' ? op.ddnRole : undefined,
        } as PosterOperation);
        break;
      }
      case 'addImage': {
        if (!checkImageSrc(op, 'src')) break;
        if (!checkCoord(op, 'left') || !checkCoord(op, 'top')) break;
        operations.push({
          op: 'addImage',
          id: op.id ? String(op.id) : undefined,
          src: String(op.src),
          left: Math.round(op.left),
          top: Math.round(op.top),
          width: isFiniteNumber(op.width) ? Math.round(op.width) : undefined,
          height: isFiniteNumber(op.height) ? Math.round(op.height) : undefined,
          originX: ['left', 'center', 'right'].includes(op.originX) ? op.originX : undefined,
          originY: ['top', 'center', 'bottom'].includes(op.originY) ? op.originY : undefined,
          ddnRole: typeof op.ddnRole === 'string' ? op.ddnRole : undefined,
        } as PosterOperation);
        break;
      }
      case 'updateText': {
        if (!hasId(op)) break;
        operations.push({
          op: 'updateText',
          id: String(op.id),
          text: typeof op.text === 'string' ? op.text : undefined,
          fontSize: isFiniteNumber(op.fontSize) ? Math.round(op.fontSize) : undefined,
          fill: typeof op.fill === 'string' && HEX_COLOR_RE.test(op.fill) ? op.fill : undefined,
          fontWeight: typeof op.fontWeight === 'string' || isFiniteNumber(op.fontWeight) ? op.fontWeight : undefined,
          textAlign: ['left', 'center', 'right', 'justify'].includes(op.textAlign) ? op.textAlign : undefined,
        } as PosterOperation);
        break;
      }
      case 'move': {
        if (!hasId(op)) break;
        if (!checkCoord(op, 'left') || !checkCoord(op, 'top')) break;
        operations.push({
          op: 'move',
          id: String(op.id),
          left: Math.round(op.left),
          top: Math.round(op.top),
        } as PosterOperation);
        break;
      }
      case 'resize': {
        if (!hasId(op)) break;
        const scaleX = isFiniteNumber(op.scaleX) ? Math.min(10, Math.max(0.05, op.scaleX)) : undefined;
        const scaleY = isFiniteNumber(op.scaleY) ? Math.min(10, Math.max(0.05, op.scaleY)) : undefined;
        if (!scaleX && !scaleY && !isFiniteNumber(op.width) && !isFiniteNumber(op.height)) {
          rejected.push('resize 缺少 scaleX/scaleY/width/height');
          break;
        }
        operations.push({
          op: 'resize',
          id: String(op.id),
          scaleX,
          scaleY,
          width: isFiniteNumber(op.width) ? Math.round(op.width) : undefined,
          height: isFiniteNumber(op.height) ? Math.round(op.height) : undefined,
        } as PosterOperation);
        break;
      }
      case 'rotate': {
        if (!hasId(op)) break;
        if (!isFiniteNumber(op.angle)) {
          rejected.push('rotate 缺少 angle');
          break;
        }
        operations.push({ op: 'rotate', id: String(op.id), angle: op.angle } as PosterOperation);
        break;
      }
      case 'replaceImage': {
        if (!hasId(op)) break;
        if (!checkImageSrc(op, 'src')) break;
        operations.push({ op: 'replaceImage', id: String(op.id), src: String(op.src) } as PosterOperation);
        break;
      }
      case 'setBackground': {
        const bg = op.background;
        if (!bg || typeof bg !== 'object') {
          rejected.push('setBackground 缺少 background');
          break;
        }
        if (bg.type === 'solid') {
          if (typeof bg.color !== 'string' || !HEX_COLOR_RE.test(bg.color)) {
            rejected.push('setBackground 颜色非法');
            break;
          }
          operations.push({ op: 'setBackground', background: { type: 'solid', color: bg.color } });
        } else if (bg.type === 'gradient') {
          const colors = Array.isArray(bg.gradient?.colors) ? bg.gradient.colors : [];
          const valid = colors.filter((c: unknown) => typeof c === 'string' && HEX_COLOR_RE.test(c));
          if (valid.length < 2) {
            rejected.push('setBackground 渐变至少需要 2 个合法颜色');
            break;
          }
          operations.push({
            op: 'setBackground',
            background: {
              type: 'gradient',
              gradient: {
                type: bg.gradient?.type === 'radial' ? 'radial' : 'linear',
                colors: valid,
              },
            },
          });
        } else if (bg.type === 'image') {
          if (!checkImageSrc({op: 'setBackground', src: bg.src}, 'src')) break;
          operations.push({ op: 'setBackground', background: { type: 'image', src: String(bg.src) } });
        } else {
          rejected.push('setBackground 类型非法');
        }
        break;
      }
      case 'lock': {
        if (!hasId(op)) break;
        operations.push({ op: 'lock', id: String(op.id), locked: !!op.locked } as PosterOperation);
        break;
      }
      default:
        rejected.push(`未知操作 ${name}`);
    }
  }

  return {
    ok: operations.length > 0,
    operations,
    rejected,
    error: operations.length === 0 ? '所有操作均未通过校验' : undefined,
  };
}

export interface ParsedOps {
  operations: PosterOperation[];
  explanation?: string;
  suggestions?: string[];
  rejected: string[];
}

/** 解析 + 校验一步到位 */
export function parseAndValidateOps(
  llmText: string,
  ctx: OpsValidationContext,
): ParsedOps {
  const raw = extractJson(llmText);
  const result = validateOperations(raw, ctx);
  const payload = (raw ?? {}) as {explanation?: string; suggestions?: unknown};
  const suggestions = Array.isArray(payload.suggestions)
    ? payload.suggestions.filter((s): s is string => typeof s === 'string').slice(0, 5)
    : [];
  return {
    operations: result.operations,
    explanation: typeof payload.explanation === 'string' ? payload.explanation : undefined,
    suggestions,
    rejected: result.rejected,
  };
}
