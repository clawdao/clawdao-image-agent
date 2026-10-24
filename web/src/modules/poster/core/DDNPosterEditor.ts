import {
  Canvas,
  Image as FabricImage,
  FabricObject,
  Gradient,
  Point,
  Rect,
  Textbox,
} from 'fabric';
import type { PosterCanvasSize } from '../types';
import { DDN_POSTER_CUSTOM_PROPS, DDN_POSTER_SKETCH_ID, DDN_POSTER_BG_IMAGE_ID } from './constants';
import { CanvasHistory } from './history';
import { genId } from './id';

// Fabric v6+ 需要显式登记自定义属性，否则它们不会参与序列化 / 还原。
// 这里登记 id / ddnRole / locked / ddnDesiredSize，保证草稿与历史快照里的对象
// 仍然“认得出身份”（sketch 能按 id 找回、图层有名字、AI 指令有目标）。
DDN_POSTER_CUSTOM_PROPS.forEach((prop) => {
  const list = (FabricObject as any).customProperties as string[];
  if (Array.isArray(list) && !list.includes(prop)) list.push(prop);
});

const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));

type OriginX = 'left' | 'center' | 'right';
type OriginY = 'top' | 'center' | 'bottom';

const loadHtmlImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = src;
  });

export type DDNPosterEditorOptions = {
  canvasEl: HTMLCanvasElement;
  containerEl: HTMLElement;
  canvasSize: PosterCanvasSize;
  background?:
    | { type: 'solid'; color: string }
    | {
        type: 'gradient';
        gradient: { type: 'linear' | 'radial'; colors: string[] };
      }
    | { type: 'image'; src: string };
};

export class DDNPosterEditor {
  public canvas: Canvas;
  public sketch: Rect;
  public history: CanvasHistory;

  private gridEnabled = false;
  private gridSize = 20;
  private gridColor = 'rgba(0,0,0,0.10)';
  private onAfterRender: (() => void) | null = null;

  private ro: ResizeObserver | null = null;
  private onWindowResize: (() => void) | null = null;
  private canvasSize: PosterCanvasSize;

  private viewportRaf: number | null = null;
  private viewportDirty = false;
  private viewportStabilizeTries = 0;
  /** 迁移补丁：编辑器销毁后禁止再碰 canvas（Fabric v6+ 销毁后 this.lower 已被删除，
   *  再调 setDimensions 会抛 “Cannot destructure property 'el' of 'this.lower'”） */
  private destroyed = false;
  private lastMeasuredContainerSize: { w: number; h: number } | null = null;
  private lastAppliedViewportContainerSize: { w: number; h: number } | null =
    null;
  private isLoading = false;

  // 视口更新冻结机制：用于在 Tab 切换、Drawer 展开等 UI 剧烈变化期间，
  // 暂时忽略 ResizeObserver 的回调，避免中间态（如容器尺寸瞬间变 0 或变小）
  // 导致视口错误重算（闪动/错位）。
  private viewportSuspendUntil = 0;
  private viewportSuspendTimer: any = null;

  constructor(private options: DDNPosterEditorOptions) {
    this.canvasSize = options.canvasSize;

    this.canvas = new Canvas(options.canvasEl, {
      width: options.canvasSize.width,
      height: options.canvasSize.height,
      selection: true,
      preserveObjectStacking: true,
      enableRetinaScaling: true,
    });

    // 对齐 fabritor：工作区（画布外部）默认灰底，方便区分“海报画板/内容区”。
    (this.canvas as any).backgroundColor = '#dddddd';

    this.sketch = new Rect({
      left: 0,
      top: 0,
      // Fabric v7 默认原点是 center/center，必须显式指定 left/top，
      // 否则 sketch 的中心会落在 (0,0)，整张海报会偏移到画布右下角。
      originX: 'left',
      originY: 'top',
      width: options.canvasSize.width,
      height: options.canvasSize.height,
      fill: '#ffffff',
      selectable: false,
      evented: false,
      hasControls: false,
      hoverCursor: 'default',
      id: DDN_POSTER_SKETCH_ID,
      ddnRole: 'sketch',
    } as any);

    this.canvas.add(this.sketch);
    this.canvas.sendObjectToBack(this.sketch);

    this.syncClipPathFromSketch();

    this.history = new CanvasHistory(this.canvas, {
      getJson: () => JSON.stringify(this.toFabricJson()),
      maxLength: 50,
    });

    this.history.bind();

    this.bindGrid();

    this.bindResize();
  }

  private bindGrid() {
    const draw = () => {
      if (!this.gridEnabled) return;
      const anyCanvas: any = this.canvas as any;
      const ctx: CanvasRenderingContext2D | undefined = anyCanvas?.contextTop;
      if (!ctx) return;

      const vpt = this.canvas.viewportTransform || [1, 0, 0, 1, 0, 0];
      const zoom = Number(vpt[0]) || 1;
      const offsetX = Number(vpt[4]) || 0;
      const offsetY = Number(vpt[5]) || 0;
      // 使用 CSS 像素尺寸绘制；contextTop 默认带 retina 缩放
      const w =
        Number((this.canvas as any).getWidth?.() ?? this.canvas.width) || 0;
      const h =
        Number((this.canvas as any).getHeight?.() ?? this.canvas.height) || 0;
      if (!w || !h) return;

      const retina =
        Number(
          (this.canvas as any).getRetinaScaling?.() ??
            window.devicePixelRatio ??
            1,
        ) || 1;

      const step = Math.max(4, this.gridSize * zoom);
      if (!isFinite(step) || step <= 0) return;

      // 让网格跟随画布平移/缩放（对齐世界坐标系）
      const startX = ((offsetX % step) + step) % step;
      const startY = ((offsetY % step) + step) % step;

      ctx.save();
      // 将绘制坐标系固定到 CSS 像素，避免 retina 屏只画到左上角一小块
      ctx.setTransform(retina, 0, 0, retina, 0, 0);
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = this.gridColor;

      for (let x = startX; x <= w; x += step) {
        ctx.moveTo(x + 0.5, 0);
        ctx.lineTo(x + 0.5, h);
      }
      for (let y = startY; y <= h; y += step) {
        ctx.moveTo(0, y + 0.5);
        ctx.lineTo(w, y + 0.5);
      }

      ctx.stroke();
      ctx.restore();
    };

    this.onAfterRender = draw;
    (this.canvas as any).on?.('after:render', draw as any);
  }

  public setGridEnabled(enabled: boolean) {
    this.gridEnabled = !!enabled;
    this.canvas.requestRenderAll();
  }

  private syncClipPathFromSketch() {
    const w = Number((this.sketch as any).width) || this.canvasSize.width;
    const h = Number((this.sketch as any).height) || this.canvasSize.height;
    const left = Number((this.sketch as any).left) || 0;
    const top = Number((this.sketch as any).top) || 0;
    const rx = Number((this.sketch as any).rx) || 0;
    const ry = Number((this.sketch as any).ry) || 0;

    this.canvas.clipPath = new Rect({
      left,
      top,
      width: w,
      height: h,
      originX: 'left',
      originY: 'top',
      rx,
      ry,
      selectable: false,
      evented: false,
      hasControls: false,
    } as any);
  }

  public destroy() {
    this.destroyed = true;
    if (this.ro) {
      this.ro.disconnect();
      this.ro = null;
    }
    if (this.onWindowResize) {
      window.removeEventListener('resize', this.onWindowResize);
      this.onWindowResize = null;
    }
    // 迁移补丁：冻结视口的定时器也要一起清掉，否则销毁后它会再次拉起 rAF，
    // 在已 dispose 的 canvas 上调 setDimensions。
    if (this.viewportSuspendTimer) {
      clearTimeout(this.viewportSuspendTimer);
      this.viewportSuspendTimer = null;
    }

    if (this.onAfterRender) {
      (this.canvas as any).off?.('after:render', this.onAfterRender as any);
      this.onAfterRender = null;
    }

    if (this.viewportRaf !== null) {
      cancelAnimationFrame(this.viewportRaf);
      this.viewportRaf = null;
    }
    this.history.unbind();
    this.canvas.dispose();
  }

  private bindResize() {
    const apply = () => {
      if (this.isLoading) {
        this.viewportDirty = true;
        return;
      }
      this.requestApplyViewport();
    };
    if (typeof ResizeObserver !== 'undefined') {
      this.ro = new ResizeObserver(apply);
      this.ro.observe(this.options.containerEl);
    } else {
      this.onWindowResize = apply;
      window.addEventListener('resize', apply);
    }
    this.requestApplyViewport();
  }

  public setCanvasSize(size: PosterCanvasSize) {
    this.canvasSize = size;
    this.sketch.set({ width: size.width, height: size.height });
    this.sketch.setCoords();
    this.syncClipPathFromSketch();
    this.canvas.requestRenderAll();
    this.requestApplyViewport({ force: true });
  }

  /**
   * 暂时冻结视口自动更新（ResizeObserver）。
   * 场景：Tab 切换、侧边栏展开/收起等会导致容器尺寸剧烈抖动或瞬间为 0 的操作。
   * 原理：类似“保存期间暂停渲染”，这里是“UI 切换期间暂停视口重算”。
   * @param ms 冻结时长（毫秒），默认 160ms（略大于常见的 UI 动画时长）
   */
  public suspendViewport(ms = 160) {
    this.viewportSuspendUntil = Date.now() + ms;

    // 清理旧的定时器
    if (this.viewportSuspendTimer) {
      clearTimeout(this.viewportSuspendTimer);
      this.viewportSuspendTimer = null;
    }

    // 冻结结束后，主动触发一次检查，确保最终状态正确
    this.viewportSuspendTimer = setTimeout(() => {
      this.viewportSuspendTimer = null;
      // 冻结结束，强制检查一次（force=false，因为如果尺寸没变就不需要动）
      // 但为了保险起见，如果期间有 resize 被忽略了，这里应该触发。
      // 由于 flushApplyViewport 会检查 lastAppliedViewportContainerSize，
      // 所以直接调用 requestApplyViewport 即可。
      this.requestApplyViewport();
    }, ms + 10);
  }

  private requestApplyViewport(options?: { force?: boolean }) {
    if (this.destroyed) return;
    if (this.isLoading) {
      this.viewportDirty = true;
      return;
    }

    // 如果处于冻结期，且非强制执行，则忽略
    if (!options?.force && Date.now() < this.viewportSuspendUntil) {
      this.viewportDirty = true; // 标记为脏，以便解冻后处理
      return;
    }

    this.viewportDirty = true;
    if (this.viewportRaf !== null) cancelAnimationFrame(this.viewportRaf);
    this.viewportRaf = requestAnimationFrame(() => {
      this.viewportRaf = null;
      this.flushApplyViewport(options);
    });
  }

  /**
   * 判断是否应该跳过本次视口更新
   * @param cw 当前容器宽
   * @param ch 当前容器高
   * @param force 是否强制更新
   */
  private shouldSkipViewportApply(
    cw: number,
    ch: number,
    force: boolean,
  ): boolean {
    // 1. 容器尺寸异常（过小）：始终跳过（即使 force 也不行，因为算出来也是错的）
    // 这种情况通常发生在 Tab 切换动画中，容器宽度可能暂时为 0 或很小。
    // 必须等待尺寸恢复正常。
    if (cw < 50 || ch < 50) return true;

    // 2. 强制更新：不跳过
    if (force) return false;

    // 3. 尺寸未稳定（连续两帧变化）：跳过（防抖）
    const prev = this.lastMeasuredContainerSize;
    if (!prev || prev.w !== cw || prev.h !== ch) {
      this.lastMeasuredContainerSize = { w: cw, h: ch };
      this.viewportStabilizeTries = 1;
      return true; // 尺寸还在变，等下一帧
    }

    // 4. 稳定次数不足：跳过
    if (this.viewportStabilizeTries < 2) {
      this.viewportStabilizeTries += 1;
      return true;
    }

    // 5. 微小抖动（<= 2px）：跳过
    // 浏览器布局计算/滚动条出现可能导致 1px 左右的抖动，
    // 这种抖动会导致画面模糊或轻微跳动，体验不好，且无必要。
    const lastApplied = this.lastAppliedViewportContainerSize;
    if (lastApplied) {
      const dw = Math.abs(lastApplied.w - cw);
      const dh = Math.abs(lastApplied.h - ch);
      if (dw <= 2 && dh <= 2) return true;
    }

    return false;
  }

  private flushApplyViewport(options?: { force?: boolean }) {
    if (this.destroyed) return;
    if (this.isLoading) {
      this.viewportDirty = true;
      return;
    }
    if (!this.viewportDirty && !options?.force) return;

    const container = this.options.containerEl;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const force = !!options?.force;

    // 使用策略方法判断是否跳过
    if (this.shouldSkipViewportApply(cw, ch, force)) {
      // 如果是因为“尺寸还在变”或“过小”而跳过，需要继续请求下一帧检查
      // 但如果是“微小抖动”跳过，就不需要继续请求了（除非 dirty）
      // 为了简单，只要跳过且 dirty，就继续请求（shouldSkip 内部逻辑会处理稳定计数）

      // 特殊处理：如果是微小抖动（shouldSkip 返回 true），
      // 我们需要区分是“正在稳定中”还是“已经稳定但变化很小”。
      // shouldSkipViewportApply 内部逻辑混合了这两者。
      // 重新审视：shouldSkipViewportApply 返回 true 意味着“现在不要更新”。
      // 如果是因为“不稳定”，我们需要再次 request。
      // 如果是因为“微小抖动”，我们不需要再次 request。

      // 让我们简化逻辑：
      // 如果 shouldSkip 返回 true，我们看看是否需要继续监听
      if (
        cw < 50 ||
        ch < 50 ||
        (this.lastMeasuredContainerSize &&
          (this.lastMeasuredContainerSize.w !== cw ||
            this.lastMeasuredContainerSize.h !== ch)) ||
        this.viewportStabilizeTries < 2
      ) {
        this.requestApplyViewport(options);
      }
      return;
    }

    // 极端情况兜底：即使尺寸持续轻微抖动，也不要无限等待
    if (this.viewportStabilizeTries > 10) {
      this.viewportStabilizeTries = 2;
    }

    this.viewportDirty = false;
    this.applyViewportNow(cw, ch);
  }

  private applyViewportNow(cw: number, ch: number) {
    const padding = 24;
    if (!cw || !ch) return;

    this.lastAppliedViewportContainerSize = { w: cw, h: ch };

    // 对齐 fabritor：canvas 尺寸=工作区容器尺寸
    // 注意：Fabric 的 setDimensions/setWidth 会重置画布位图（清屏），
    // 若每次视口应用都无条件重设尺寸，就会形成
    // “清屏 → 渲染 → 再清屏” 的循环，画布看起来始终是空白/闪烁。
    // 因此只有尺寸真的发生变化时才重设。
    const anyCanvas = this.canvas as any;
    const targetW = Math.max(1, Math.round(cw));
    const targetH = Math.max(1, Math.round(ch));
    const currentW = Math.round(Number(this.canvas.getWidth?.() ?? 0));
    const currentH = Math.round(Number(this.canvas.getHeight?.() ?? 0));
    if (currentW !== targetW || currentH !== targetH) {
      if (typeof (this.canvas as any).setDimensions === 'function') {
        this.canvas.setDimensions({ width: targetW, height: targetH });
      } else {
        anyCanvas.setWidth(targetW);
        anyCanvas.setHeight(targetH);
      }
    }

    // 更新偏移，避免容器/尺寸变化后出现坐标/视口计算异常
    try {
      (this.canvas as any).calcOffset?.();
    } catch {
      // ignore
    }

    const sketchW =
      (Number(this.sketch.width) || this.canvasSize.width) *
      (Number((this.sketch as any).scaleX) || 1);
    const sketchH =
      (Number(this.sketch.height) || this.canvasSize.height) *
      (Number((this.sketch as any).scaleY) || 1);

    const availableW = Math.max(0, cw - padding * 2);
    const availableH = Math.max(0, ch - padding * 2);
    const zw = availableW / Math.max(1, sketchW);
    const zh = availableH / Math.max(1, sketchH);
    // 画布高度被用户调得很长时，若最小缩放过大，会导致无法完整适配工作区，
    // 居中后顶部会被裁切，看起来像“保存后画板跑到下面”。
    const zoom = clamp(Math.min(zw, zh), 0.01, 4);

    const center = (this.canvas as any).getCenter?.() || {
      left: cw / 2,
      top: ch / 2,
    };
    this.canvas.zoomToPoint(new Point(center.left, center.top), zoom);

    // sketch 移至画布中心
    const sketchCenter = (this.sketch as any).getCenterPoint?.() || {
      x: sketchW / 2,
      y: sketchH / 2,
    };
    const vpt = this.canvas.viewportTransform || [zoom, 0, 0, zoom, 0, 0];
    // 确保不会继承旧 JSON/拖拽造成的 skew
    vpt[1] = 0;
    vpt[2] = 0;
    const cssW = Number((this.canvas as any).getWidth?.() ?? cw) || cw;
    const cssH = Number((this.canvas as any).getHeight?.() ?? ch) || ch;
    vpt[4] = cssW / 2 - sketchCenter.x * vpt[0];
    vpt[5] = cssH / 2 - sketchCenter.y * vpt[3];
    this.canvas.setViewportTransform(vpt);
    this.canvas.requestRenderAll();

    // 重新生成 clipPath，避免裁切区域与当前 viewport 不一致
    this.syncClipPathFromSketch();
    this.canvas.requestRenderAll();
  }

  public applyViewport() {
    this.requestApplyViewport();
  }

  public async setBackground(
    bg:
      | { type: 'solid'; color: string }
      | {
          type: 'gradient';
          gradient: { type: 'linear' | 'radial'; colors: string[] };
        }
      | { type: 'image'; src: string },
  ) {
    const sketch = this.sketch;
    if (!sketch) return;

    // 旧的图片背景图层先移除，避免重复叠加
    const oldBg = this.canvas
      .getObjects()
      .find((o: any) => o?.id === DDN_POSTER_BG_IMAGE_ID);
    if (oldBg) {
      this.canvas.remove(oldBg);
    }

    if (bg.type === 'solid') {
      // 背景画在“画板”对象上：画板填充属于对象局部坐标，
      // 会跟随缩放平移正确对齐（canvas 背景层不受 viewportTransform 影响，会错位）。
      sketch.set({fill: bg.color});
      this.canvas.requestRenderAll();
      return;
    }

    if (bg.type === 'gradient') {
      const colors = bg.gradient.colors || [];
      if (colors.length === 0) return;
      const stops = colors.map((c, idx) => ({
        offset: idx / Math.max(1, colors.length - 1),
        color: c,
      }));

      const w = Number(sketch.width) || this.canvasSize.width;
      const h = Number(sketch.height) || this.canvasSize.height;

      const g = new Gradient({
        type: bg.gradient.type,
        coords:
          bg.gradient.type === 'linear'
            ? { x1: 0, y1: 0, x2: 0, y2: h }
            : {
                x1: w / 2,
                y1: h / 2,
                r1: 0,
                x2: w / 2,
                y2: h / 2,
                r2: Math.max(w, h) / 2,
              },
        colorStops: stops,
      } as any);

      sketch.set({fill: g});
      this.canvas.requestRenderAll();
      return;
    }

    // image：Fabric v7 不支持把图片直接当作对象填充，
    // 因此铺一层不可选的背景图片图层（放在画板之上、内容之下）。
    sketch.set({fill: 'transparent'});
    const imgEl = await loadHtmlImage(bg.src);
    const image = new FabricImage(imgEl, {
      originX: 'left',
      originY: 'top',
      selectable: false,
      evented: false,
      hasControls: false,
      hoverCursor: 'default',
      id: DDN_POSTER_BG_IMAGE_ID,
      ddnRole: 'background',
    } as any);

    // cover
    const sx = this.canvasSize.width / (image.width || 1);
    const sy = this.canvasSize.height / (image.height || 1);
    const scale = Math.max(sx, sy);
    const w = (image.width || 0) * scale;
    const h = (image.height || 0) * scale;
    image.set({
      scaleX: scale,
      scaleY: scale,
      left: (this.canvasSize.width - w) / 2,
      top: (this.canvasSize.height - h) / 2,
    });

    this.canvas.add(image);
    // 画板始终在最底层，背景图片紧随其后
    this.canvas.sendObjectToBack(sketch);
    this.canvas.requestRenderAll();
  }

  public createTextbox(cfg: {
    id?: string;
    text: string;
    left: number;
    top: number;
    width?: number;
    fontSize?: number;
    fill?: string;
    fontWeight?: string | number;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    originX?: OriginX;
    originY?: OriginY;
    ddnRole?: string;
  }) {
    const tb = new Textbox(cfg.text, {
      left: cfg.left,
      top: cfg.top,
      width: cfg.width ?? 320,
      fontSize: cfg.fontSize ?? 18,
      fill: cfg.fill ?? '#333333',
      fontWeight: cfg.fontWeight ?? 'normal',
      textAlign: cfg.textAlign ?? 'left',
      originX: cfg.originX ?? 'left',
      originY: cfg.originY ?? 'top',
      splitByGrapheme: true,
      id: cfg.id || genId('text'),
      ddnRole: cfg.ddnRole,
    } as any);
    return tb;
  }

  public async addImage(cfg: {
    id?: string;
    src: string;
    left: number;
    top: number;
    width?: number;
    height?: number;
    originX?: 'left' | 'center' | 'right';
    originY?: 'top' | 'center' | 'bottom';
    ddnRole?: string;
  }) {
    const imgEl = await loadHtmlImage(cfg.src);
    const img = new FabricImage(imgEl, {
      left: cfg.left,
      top: cfg.top,
      originX: cfg.originX ?? 'left',
      originY: cfg.originY ?? 'top',
      id: cfg.id || genId('img'),
      ddnRole: cfg.ddnRole,
    } as any);

    if (cfg.width && cfg.height) {
      const sx = cfg.width / (img.width || 1);
      const sy = cfg.height / (img.height || 1);
      img.set({ scaleX: sx, scaleY: sy });
    }

    this.canvas.add(img as any);
    return img;
  }

  public async replaceImageById(id: string, src: string) {
    const obj = this.canvas.getObjects().find((o: any) => o?.id === id) as any;
    if (!obj || obj.type !== 'image') return;

    const imgEl = await loadHtmlImage(src);
    // FabricImage#setElement
    (obj as any).setElement(imgEl);

    const desired = obj?.ddnDesiredSize;
    const w = Number(desired?.width);
    const h = Number(desired?.height);
    const ow = Number(obj.width) || 0;
    const oh = Number(obj.height) || 0;
    if (w > 0 && h > 0 && ow > 0 && oh > 0) {
      obj.set({
        scaleX: w / ow,
        scaleY: h / oh,
      });
    }

    obj.set({ dirty: true });
    obj.setCoords();
    this.canvas.requestRenderAll();
  }

  public toFabricJson() {
    // Fabric v7 的 Canvas.toJSON() 会忽略入参（`toJSON() { return this.toObject(); }`），
    // 直接用 toJSON 会把自定义属性（id / ddnRole / locked / ddnDesiredSize）全部丢掉，
    // 导致草稿与历史快照里的对象“认不出身份”（sketch 找不到、图层无名、AI 指令无目标）。
    const json = (this.canvas as any).toObject(DDN_POSTER_CUSTOM_PROPS as any);
    return json;
  }

  public async loadFromFabricJson(json: any) {
    if (!json) return;
    let parsedJson = json;
    if (typeof parsedJson === 'string') {
      parsedJson = JSON.parse(parsedJson);
    }

    // 加载期间暂停 ResizeObserver 触发的 applyViewport，避免中途用错误尺寸/旧 sketch 对齐导致跳动。
    this.isLoading = true;
    const prevRenderOnAddRemove = (this.canvas as any).renderOnAddRemove;
    try {
      // 避免 load 过程中频繁 render，减少“先错位再对齐”的闪动
      (this.canvas as any).renderOnAddRemove = false;

      // 关键：草稿/历史里可能带着 viewportTransform（平移/缩放）或画布级背景。
      // 这些状态会导致“点草稿后画板跑偏 / 背景职责混乱”。加载时统一清理，只保留 objects。
      if (parsedJson && typeof parsedJson === 'object') {
        const cleaned: any = { ...parsedJson };
        delete cleaned.viewportTransform;
        delete cleaned.backgroundColor;
        delete cleaned.backgroundImage;
        delete cleaned.overlayColor;
        delete cleaned.overlayImage;
        delete cleaned.background;

        // 兼容性处理：Fabric 6+ 要求 type 为 PascalCase (如 Rect, Textbox)。
        // 如果数据是旧版本生成的 (lowercase)，或者某些模板不规范，可能导致对象无法加载（空元素）。
        // 这里统一将 type 首字母大写。
        if (Array.isArray(cleaned.objects)) {
          cleaned.objects.forEach((o: any) => {
            if (o && typeof o.type === 'string' && o.type.length > 0) {
              // 特殊处理：i-text -> IText (如果存在)
              if (o.type === 'i-text') {
                o.type = 'IText';
              } else {
                o.type = o.type.charAt(0).toUpperCase() + o.type.slice(1);
              }
            }
          });
        }
        if (
          cleaned.clipPath &&
          typeof cleaned.clipPath === 'object' &&
          typeof cleaned.clipPath.type === 'string'
        ) {
          cleaned.clipPath.type =
            cleaned.clipPath.type.charAt(0).toUpperCase() +
            cleaned.clipPath.type.slice(1);
        }

        parsedJson = cleaned;
      }

      // 清空：避免在多次 load 时出现对象残留/重复，导致首屏混乱、背景色修改无效、层级异常等。
      this.history.beginBatch();

      // clear 会同时清理 objects 与背景，背景会由 JSON（若携带）或后续逻辑恢复。
      this.canvas.clear();
      // 维持工作区灰底
      (this.canvas as any).backgroundColor = '#dddddd';

      // 明确复位视口，避免 loadFromJSON 恢复旧草稿的平移/缩放状态
      try {
        this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
      } catch {
        // ignore
      }

      try {
        // Fabric 7 的 loadFromJSON 是异步的。如果其中有图片加载失败且没有处理，Promise 会 reject 导致整个链条崩溃。
        // 我们已经在 applyBindingsToFabricJson 中对无效图片进行了 1px 像素兜底，但为了保险起见，这里再加一层 try-catch。
        await (this.canvas as any).loadFromJSON(parsedJson);
      } catch (err) {
        console.warn(
          'Fabric loadFromJSON encountered errors, but attempting to continue rendering:',
          err,
        );
      }

      // 找回 sketch
      const sketch = this.canvas
        .getObjects()
        .find((o: any) => o?.id === DDN_POSTER_SKETCH_ID) as any;
      if (sketch) {
        // 归一化 sketch，避免保存/迁移数据带来的 scale/left/top 异常导致裁切错位
        sketch.set({
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          selectable: false,
          evented: false,
          hasControls: false,
          hoverCursor: 'default',
        });

        // 关键：以当前编辑器 canvasSize 为准（由上层 config.canvas 控制），
        // 不使用存量 JSON 里的 sketch 尺寸来反向覆盖编辑器，否则会出现“点草稿后裁切/错位”。
        sketch.set({
          width: this.canvasSize.width,
          height: this.canvasSize.height,
        });
        sketch.setCoords();

        this.sketch = sketch;
        this.canvas.sendObjectToBack(sketch);

        this.syncClipPathFromSketch();
        this.canvas.requestRenderAll();
      } else {
        // 兜底：若数据里没有 sketch，则创建一个白色画板。
        const fallback = new Rect({
          left: 0,
          top: 0,
          originX: 'left',
          originY: 'top',
          width: this.canvasSize.width,
          height: this.canvasSize.height,
          fill: '#ffffff',
          selectable: false,
          evented: false,
          hasControls: false,
          hoverCursor: 'default',
          id: DDN_POSTER_SKETCH_ID,
          ddnRole: 'sketch',
        } as any);
        this.canvas.add(fallback);
        this.canvas.sendObjectToBack(fallback);
        this.sketch = fallback;
        this.syncClipPathFromSketch();
        this.canvas.requestRenderAll();
      }

      this.applyViewport();

      // 按 ddnDesiredSize 自动缩放图片（谨慎）：
      // - 跳过 1px 占位图（避免把二维码占位放大到巨大）
      // - 仅当当前显示尺寸与目标差异较大时才修正
      this.canvas.getObjects().forEach((o: any) => {
        if (o?.type !== 'image') return;
        const desired = o.ddnDesiredSize;
        if (!desired?.width || !desired?.height) return;

        const w = Number(desired.width);
        const h = Number(desired.height);
        if (!w || !h) return;

        const ow = Number(o.width) || 0;
        const oh = Number(o.height) || 0;
        // 资源未加载或是 1px 占位
        if (ow <= 2 || oh <= 2) return;

        const sx = w / ow;
        const sy = h / oh;
        o.set({ scaleX: sx, scaleY: sy });
        o.setCoords();
      });

      this.history.endBatch();
    } finally {
      (this.canvas as any).renderOnAddRemove = prevRenderOnAddRemove;
      this.isLoading = false;
    }

    // 统一在加载结束后做一次（合并后的）视口对齐
    this.requestApplyViewport({ force: true });
    this.canvas.requestRenderAll();
  }

  public async exportPng(options?: { multiplier?: number; width?: number }) {
    const transform = this.canvas.viewportTransform;
    const clip = this.canvas.clipPath;
    const bgColor = (this.canvas as any).backgroundColor;
    const bgImage = (this.canvas as any).backgroundImage;

    // 复位 viewport
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0]);
    this.canvas.clipPath = undefined;

    const left = Number(this.sketch.left) || 0;
    const top = Number(this.sketch.top) || 0;
    const width = Number(this.sketch.width) || this.canvasSize.width;
    const height = Number(this.sketch.height) || this.canvasSize.height;

    let multiplier = options?.multiplier;
    if (!multiplier && options?.width) {
      multiplier = options.width / width;
    }

    try {
      const dataUrl = this.canvas.toDataURL({
        left,
        top,
        width,
        height,
        format: 'png',
        multiplier: multiplier ?? 1,
      } as any);

      return dataUrl;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (
        e?.name === 'SecurityError' ||
        msg.includes('Tainted canvases') ||
        msg.includes('tainted')
      ) {
        throw new Error(
          '导出失败：画布包含跨域图片且未开启 CORS（tainted canvas）。请将图片换成同源地址，或在图片源站开启 CORS（Access-Control-Allow-Origin），或改用 dataURL 图片。',
        );
      }
      throw e;
    } finally {
      // restore
      this.canvas.setViewportTransform(transform);
      this.canvas.clipPath = clip;
      (this.canvas as any).backgroundColor = bgColor;
      (this.canvas as any).backgroundImage = bgImage;
      this.canvas.requestRenderAll();
    }
  }
}
