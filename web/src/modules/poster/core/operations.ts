import type { Canvas, Object as FabricObject, Textbox } from 'fabric';
import type { PosterCanvasSize, PosterOperation } from '../types';

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

const getSketchBounds = (
  sketch: FabricObject,
  canvasSize: PosterCanvasSize,
) => {
  // sketch 默认放在 (0,0)，但仍以其 width/height 为准
  const w = Number((sketch as any).width) || canvasSize.width;
  const h = Number((sketch as any).height) || canvasSize.height;
  return { left: 0, top: 0, width: w, height: h };
};

const clampObjectIntoSketch = (
  obj: FabricObject,
  sketch: FabricObject,
  canvasSize: PosterCanvasSize,
) => {
  const { left, top, width, height } = getSketchBounds(sketch, canvasSize);

  const w = obj.getScaledWidth();
  const h = obj.getScaledHeight();

  const nextLeft = clamp(
    Number(obj.left) || 0,
    left,
    Math.max(left, left + width - w),
  );
  const nextTop = clamp(
    Number(obj.top) || 0,
    top,
    Math.max(top, top + height - h),
  );
  obj.set({ left: nextLeft, top: nextTop });
  obj.setCoords();
};

export const validateOperations = (ops: PosterOperation[]) => {
  if (!Array.isArray(ops) || ops.length === 0)
    return { ok: false as const, error: 'operations 为空' };
  if (ops.length > 3)
    return { ok: false as const, error: 'operations 超过 3 步（MVP 限制）' };
  return { ok: true as const };
};

export const applyOperations = async (params: {
  canvas: Canvas;
  sketch: FabricObject;
  canvasSize: PosterCanvasSize;
  ops: PosterOperation[];
  createTextbox: (cfg: {
    id: string;
    text: string;
    left: number;
    top: number;
    width?: number;
    fontSize?: number;
    fill?: string;
    fontWeight?: string | number;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    ddnRole?: string;
  }) => Textbox;
  addImage: (cfg: {
    id?: string;
    src: string;
    left: number;
    top: number;
    width?: number;
    height?: number;
    originX?: 'left' | 'center' | 'right';
    originY?: 'top' | 'center' | 'bottom';
    ddnRole?: string;
  }) => Promise<any>;
  replaceImageById: (id: string, src: string) => Promise<void>;
  setBackground: (bg: any) => Promise<void>;
}) => {
  const {
    canvas,
    sketch,
    canvasSize,
    ops,
    createTextbox,
    addImage,
    replaceImageById,
    setBackground,
  } = params;

  for (const op of ops) {
    if (!op) continue;

    if (op.op === 'setBackground') {
      await setBackground(op.background);
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'addText') {
      const id = op.id || `ai_text_${Date.now()}`;
      const tb = createTextbox({
        id,
        text: op.text,
        left: op.left,
        top: op.top,
        width: op.width,
        fontSize: op.fontSize,
        fill: op.fill,
        fontWeight: op.fontWeight,
        textAlign: op.textAlign,
        ddnRole: op.ddnRole,
      });
      clampObjectIntoSketch(tb as any, sketch, canvasSize);
      canvas.add(tb as any);
      canvas.setActiveObject(tb as any);
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'addImage') {
      const img = await addImage({
        id: op.id,
        src: op.src,
        left: op.left,
        top: op.top,
        width: op.width,
        height: op.height,
        originX: op.originX,
        originY: op.originY,
        ddnRole: op.ddnRole,
      });

      if (img) {
        try {
          clampObjectIntoSketch(img as any, sketch, canvasSize);
        } catch {
          // ignore
        }
        try {
          canvas.setActiveObject(img as any);
        } catch {
          // ignore
        }
      }

      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    const target = canvas
      .getObjects()
      .find((o: any) => o?.id === (op as any).id) as any;
    if (!target) continue;

    if (op.op === 'lock') {
      target.set({
        selectable: !op.locked,
        evented: !op.locked,
        hasControls: !op.locked,
        locked: op.locked,
      });
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'updateText') {
      target.set({
        text: op.text ?? target.text,
        fontSize: op.fontSize ?? target.fontSize,
        fill: op.fill ?? target.fill,
        fontWeight: op.fontWeight ?? target.fontWeight,
        textAlign: op.textAlign ?? target.textAlign,
      });
      target.setCoords();
      clampObjectIntoSketch(target, sketch, canvasSize);
      canvas.requestRenderAll();
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'move') {
      target.set({ left: op.left, top: op.top });
      target.setCoords();
      clampObjectIntoSketch(target, sketch, canvasSize);
      canvas.requestRenderAll();
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'resize') {
      if (typeof op.scaleX === 'number' || typeof op.scaleY === 'number') {
        target.set({
          scaleX: typeof op.scaleX === 'number' ? op.scaleX : target.scaleX,
          scaleY: typeof op.scaleY === 'number' ? op.scaleY : target.scaleY,
        });
      }
      if (
        typeof op.width === 'number' &&
        typeof (target as any).width === 'number'
      ) {
        target.set({ width: op.width });
      }
      if (
        typeof op.height === 'number' &&
        typeof (target as any).height === 'number'
      ) {
        target.set({ height: op.height });
      }
      target.setCoords();
      clampObjectIntoSketch(target, sketch, canvasSize);
      canvas.requestRenderAll();
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'rotate') {
      target.set({ angle: op.angle });
      target.setCoords();
      canvas.requestRenderAll();
      canvas.fire('ddn:object:modified' as any);
      continue;
    }

    if (op.op === 'replaceImage') {
      await replaceImageById(op.id, op.src);
      canvas.fire('ddn:object:modified' as any);
      continue;
    }
  }

  canvas.requestRenderAll();
};
