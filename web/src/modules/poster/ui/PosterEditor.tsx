import type { Canvas } from 'fabric';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { DDNPosterEditor } from '../core/DDNPosterEditor';
import { applyBindingsToFabricJson } from '../core/bindings';
import { applyOperations, validateOperations } from '../core/operations';
import type {
  DataContext,
  PosterBackground,
  PosterDesignV2Config,
  PosterOperation,
} from '../types';
import { POSTER_ENGINE, POSTER_V2_SCHEMA_VERSION } from '../types';

const TRANSPARENT_PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wn7cAAAAASUVORK5CYII=';

export type PosterEditorHandle = {
  getDesignV2: () => PosterDesignV2Config;
  loadDesignV2: (cfg: PosterDesignV2Config) => Promise<void>;
  exportPng: (
    dataCtx: DataContext,
    options?: {
      width?: number;
      multiplier?: number;
      /**
       * 画布背景。
       *
       * 迁移补丁：ddn-hub 原实现导出会新建一个临时画布并 loadFromFabricJson，
       * 而 loadFromFabricJson 会清掉 backgroundColor / backgroundImage ——
       * 于是「AI 生成的主视觉」这类背景在导出时整块丢失。
       * 这里把背景显式传给临时画布，保证导出的 PNG 与所见一致。
       */
      background?: PosterBackground;
    },
  ) => Promise<string>;
  applyOperations: (
    ops: PosterOperation[],
  ) => Promise<{ ok: boolean; error?: string }>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  canUndo: () => boolean;
  canRedo: () => boolean;
  getCanvas: () => Canvas | null;
  suspendViewport: (ms?: number) => void;
};

type Props = {
  value: PosterDesignV2Config;
  onChange: (next: PosterDesignV2Config) => void;
  dataCtx: DataContext;
  showGrid?: boolean;
  onBackgroundClick?: () => void;
};

const PosterEditor = forwardRef<PosterEditorHandle, Props>(
  ({ value, onChange, dataCtx, showGrid, onBackgroundClick }, ref) => {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<DDNPosterEditor | null>(null);
    const [ready, setReady] = useState(false);
    const loadingRef = useRef(false);
    const lastInternalFabricJsonRef = useRef<any>(null);
    const lastLoadedFabricJsonRef = useRef<any>(null);
    const lastAppliedDataCtxRef = useRef<DataContext | null>(null);
    const onBackgroundClickRef = useRef<(() => void) | undefined>(
      onBackgroundClick,
    );

    const canvasSize = value.canvas;

    const stableValue = useMemo(() => value, [value]);

    const valueRef = useRef<PosterDesignV2Config>(value);
    const dataCtxRef = useRef<DataContext>(dataCtx);

    useEffect(() => {
      valueRef.current = value;
    }, [value]);

    useEffect(() => {
      dataCtxRef.current = dataCtx;
    }, [dataCtx]);

    useEffect(() => {
      onBackgroundClickRef.current = onBackgroundClick;
    }, [onBackgroundClick]);

    const sanitizeForSave = (cfg: PosterDesignV2Config, canvasJson: any) => {
      const bindings = cfg.bindings;
      if (!canvasJson || typeof canvasJson !== 'object') return canvasJson;

      // 关键：不要把 viewportTransform（平移/缩放）等“工作区状态”持久化到草稿里。
      // 否则切换草稿会恢复上次拖拽偏移，造成“加载后海报位置不正确”。
      const base: any = { ...canvasJson };
      delete base.viewportTransform;
      delete base.backgroundColor;
      delete base.backgroundImage;
      delete base.overlayColor;
      delete base.overlayImage;
      delete base.background;

      if (!bindings || !Array.isArray(base.objects)) return base;

      const objects = base.objects.map((obj: any) => {
        const id = obj?.id;
        if (!id) return obj;
        const rules = (bindings as any)?.[id];
        if (!rules) return obj;

        const patched = { ...obj };

        // 恢复图片占位符
        if (rules.src && rules.src.kind === 'template') {
          const source = String(rules.src.source || '');
          if (obj?.type === 'image' && source) {
            // 一律以绑定规则的模板 source 为准，保证动态图片（头像/封面等）不会在保存时写死真实 URL。
            patched.src = source;
          }
        }

        // 恢复文本占位符：避免将实际数据（如真实邀请码）保存到草稿 JSON 中，导致绑定失效
        if (
          rules.text &&
          rules.text.kind === 'template' &&
          typeof patched.text === 'string'
        ) {
          patched.text = rules.text.source;
        }

        return patched;
      });

      return { ...base, objects };
    };

    useEffect(() => {
      if (!canvasRef.current || !containerRef.current) return;

      const editor = new DDNPosterEditor({
        canvasEl: canvasRef.current,
        containerEl: containerRef.current,
        canvasSize,
      });

      editorRef.current = editor;
      // 开发期调试钩子（生产构建不保留）
      if (import.meta.env.DEV) {
        (window as any).__posterEditor = editor;
      }

      const init = async () => {
        if (stableValue?.fabricJson) {
          const cfg = valueRef.current;
          const ctx = dataCtxRef.current;
          loadingRef.current = true;
          try {
            // 使用 applyBindingsToFabricJson 统一处理数据绑定（文本替换、二维码注入等）
            const loadJson = applyBindingsToFabricJson(
              cfg.fabricJson,
              cfg.bindings,
              ctx,
            );
            await editor.loadFromFabricJson(loadJson);
            lastLoadedFabricJsonRef.current = cfg.fabricJson;
            lastAppliedDataCtxRef.current = ctx;
            if (cfg.background) {
              await editor.setBackground(cfg.background);
            }
          } finally {
            loadingRef.current = false;
          }
        }
        setReady(true);
      };

      void init();

      const onModified = () => {
        if (loadingRef.current) return;
        const currentValue = valueRef.current;
        const next: PosterDesignV2Config = {
          ...currentValue,
          engine: POSTER_ENGINE,
          schemaVersion: POSTER_V2_SCHEMA_VERSION,
          canvas: { ...currentValue.canvas },
          fabricJson: sanitizeForSave(currentValue, editor.toFabricJson()),
        };

        // 该变更由当前 editor 产生：回传给上层后会导致 value.fabricJson 更新。
        // 若此时再根据 value.fabricJson 触发 loadFromJSON，会导致 Fabric 重新实例化对象并清空选中状态。
        // 因此记录引用，在后续 effect 中跳过对同一份 JSON 的 reload。
        lastInternalFabricJsonRef.current = next.fabricJson;
        onChange(next);
      };

      (editor.canvas as any).on('ddn:object:modified', onModified as any);
      editor.canvas.on('object:modified', onModified as any);
      editor.canvas.on('object:added', onModified as any);
      editor.canvas.on('object:removed', onModified as any);

      const onMouseDown = (opt: any) => {
        if (loadingRef.current) return;
        const cb = onBackgroundClickRef.current;
        if (!cb) return;
        if (!opt?.target) cb();
      };
      editor.canvas.on('mouse:down', onMouseDown as any);

      return () => {
        (editor.canvas as any).off('ddn:object:modified', onModified as any);
        editor.canvas.off('object:modified', onModified as any);
        editor.canvas.off('object:added', onModified as any);
        editor.canvas.off('object:removed', onModified as any);
        editor.canvas.off('mouse:down', onMouseDown as any);
        editor.destroy();
        editorRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 当 canvas 尺寸变化时同步 editor
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !ready) return;
      editor.setCanvasSize(canvasSize);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasSize.width, canvasSize.height, ready]);

    // 当外部 value.fabricJson 变化时（比如切模板/加载设计）或 dataCtx 变化时重新加载
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !ready) return;

      // 如果是本 editor 内部 onModified 刚回传的同一份 JSON，且 dataCtx 没变，则不需要 reload
      // 注意：如果 dataCtx 变了（比如二维码生成好了），即使 JSON 没变也要 reload 以应用新数据
      const isSameJson =
        stableValue.fabricJson &&
        stableValue.fabricJson === lastInternalFabricJsonRef.current;
      // 已经加载进画布的那份 JSON：父组件即使重建了 design 对象，只要 fabricJson 引用没变，
      // 也不需要整画布重载（重载会清屏并触发视口重算，造成画布闪烁/空白）。
      const isSameAsLoaded =
        !!stableValue.fabricJson &&
        stableValue.fabricJson === lastLoadedFabricJsonRef.current;
      const unchanged = isSameJson || isSameAsLoaded;
      const isSameCtx = dataCtx === lastAppliedDataCtxRef.current;

      if (unchanged && isSameCtx) return;

      // 仅 dataCtx 变了：不要整画布 reload（会触发 applyViewport 导致视觉跳动/错位）。
      // 改为就地更新绑定对象（文本/图片），保证“改动-保存-重新渲染”稳定。
      if (unchanged && !isSameCtx) {
        let cancelled = false;
        const runInPlace = async () => {
          try {
            const cfg = stableValue;
            const ctx = dataCtx;
            loadingRef.current = true;
            try {
              const renderJson: any = applyBindingsToFabricJson(
                cfg.fabricJson,
                cfg.bindings,
                ctx,
              );
              const byId = new Map<string, any>();
              if (renderJson && Array.isArray(renderJson.objects)) {
                for (const o of renderJson.objects) {
                  const id = String(o?.id || '');
                  if (id) byId.set(id, o);
                }
              }

              const canvas: any = editor.canvas;
              const objects: any[] = canvas?.getObjects?.() || [];
              for (const obj of objects) {
                if (cancelled) return;
                const id = String((obj as any)?.id || '');
                if (!id) continue;
                const patched = byId.get(id);
                if (!patched) continue;

                if (
                  (obj as any).type === 'textbox' ||
                  (obj as any).type === 'text'
                ) {
                  const nextText =
                    typeof patched.text === 'string' ? patched.text : undefined;
                  if (
                    typeof nextText === 'string' &&
                    nextText !== (obj as any).text
                  ) {
                    (obj as any).set?.({ text: nextText });
                    (obj as any).setCoords?.();
                  }
                }

                if ((obj as any).type === 'image') {
                  const nextSrc =
                    typeof patched.src === 'string' ? patched.src : '';
                  // 避免无意义替换：透明 1px 兜底不强制覆盖已显示的图片
                  if (nextSrc && nextSrc !== TRANSPARENT_PNG_1PX) {
                    const prevSrc = String((obj as any).src || '');
                    if (nextSrc !== prevSrc) {
                      await editor.replaceImageById(id, nextSrc);
                      (obj as any).src = nextSrc;
                    }
                  }
                }
              }

              lastAppliedDataCtxRef.current = ctx;
            } finally {
              loadingRef.current = false;
            }

            if (!cancelled) editor.canvas.requestRenderAll();
          } catch {
            // ignore
          }
        };

        void runInPlace();
        return () => {
          cancelled = true;
        };
      }

      let cancelled = false;
      const run = async () => {
        try {
          const cfg = stableValue; // 使用最新的 stableValue
          const ctx = dataCtx; // 直接使用最新的 dataCtx
          loadingRef.current = true;
          try {
            // 使用 applyBindingsToFabricJson 统一处理数据绑定（文本替换、二维码注入等）
            const loadJson = applyBindingsToFabricJson(
              cfg.fabricJson,
              cfg.bindings,
              ctx,
            );
            await editor.loadFromFabricJson(loadJson);
            lastLoadedFabricJsonRef.current = cfg.fabricJson;
            lastAppliedDataCtxRef.current = ctx;
            if (cfg.background) {
              await editor.setBackground(cfg.background);
            }
          } finally {
            loadingRef.current = false;
          }
        } finally {
          if (!cancelled) editor.canvas.requestRenderAll();
        }
      };

      void run();
      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stableValue.fabricJson, ready, dataCtx]);

    // 网格开关（仅编辑态显示，不影响导出/保存）
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !ready) return;
      editor.setGridEnabled(!!showGrid);
    }, [showGrid, ready]);

    // 当二维码 dataURL 就绪时，仅替换二维码图片 src（不 reload 整画布，避免打断选中/连续操作）。
    useEffect(() => {
      const editor = editorRef.current;
      if (!editor || !ready) return;

      const qr = (dataCtx as any)?.qrCodeDataUrl;
      if (typeof qr !== 'string' || !qr.startsWith('data:image/')) return;

      let cancelled = false;
      const run = async () => {
        try {
          const cfg = valueRef.current;
          const bindings = (cfg as any)?.bindings || {};

          const idsFromBindings = Object.keys(bindings).filter((id) => {
            const rule = bindings?.[id]?.src;
            if (!rule || rule.kind !== 'template') return false;
            const source = String(rule.source || '');
            return (
              source.includes('qrCodeDataUrl') ||
              source.includes('qrCodeUrl') ||
              source.includes('qrCodeCode')
            );
          });

          const idsFromCanvas = (editor.canvas.getObjects?.() || [])
            .filter(
              (o: any) =>
                o?.type === 'image' &&
                (o?.ddnRole === 'qrImage' ||
                  String(o?.id || '').includes('qr')),
            )
            .map((o: any) => String(o?.id || ''))
            .filter(Boolean);

          const ids = Array.from(
            new Set([...idsFromBindings, ...idsFromCanvas]),
          ).filter(Boolean);
          if (ids.length === 0) return;

          for (const id of ids) {
            if (cancelled) return;
            await editor.replaceImageById(id, qr);
          }
        } catch {
          // ignore
        } finally {
          if (!cancelled) editor.canvas.requestRenderAll();
        }
      };
      void run();
      return () => {
        cancelled = true;
      };
      // 仅关注二维码就绪，不在 dataCtx 其他字段变化时重跑，避免打断编辑。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [(dataCtx as any)?.qrCodeDataUrl, ready]);

    useImperativeHandle(ref, () => ({
      getDesignV2: () => {
        const editor = editorRef.current;
        const fabricJson = editor
          ? editor.toFabricJson()
          : stableValue.fabricJson;
        return {
          ...stableValue,
          engine: POSTER_ENGINE,
          schemaVersion: POSTER_V2_SCHEMA_VERSION,
          fabricJson,
        };
      },
      loadDesignV2: async (cfg: PosterDesignV2Config) => {
        const editor = editorRef.current;
        if (!editor) return;
        const ctx = dataCtxRef.current;
        loadingRef.current = true;
        try {
          const loadJson = applyBindingsToFabricJson(
            cfg.fabricJson,
            cfg.bindings,
            ctx,
          );
          await editor.loadFromFabricJson(loadJson);
          if (cfg.background) {
            await editor.setBackground(cfg.background);
          }
        } finally {
          loadingRef.current = false;
        }
      },
      exportPng: async (
        ctx: DataContext,
        options?: {
          width?: number;
          multiplier?: number;
          background?: PosterBackground;
        },
      ) => {
        const editor = editorRef.current;
        if (!editor) return '';

        const templateJson = editor.toFabricJson();
        const renderJson = applyBindingsToFabricJson(
          templateJson,
          stableValue.bindings,
          ctx,
        );

        // 临时导出：不污染当前画布
        const tmpCanvas = document.createElement('canvas');
        const tmpContainer = document.createElement('div');
        tmpContainer.style.width = `${stableValue.canvas.width}px`;
        tmpContainer.style.height = `${stableValue.canvas.height}px`;

        const tmpEditor = new DDNPosterEditor({
          canvasEl: tmpCanvas,
          containerEl: tmpContainer,
          canvasSize: stableValue.canvas,
        });

        await tmpEditor.loadFromFabricJson(renderJson);
        if (options?.background) {
          await tmpEditor.setBackground(options.background);
        }
        const url = await tmpEditor.exportPng(options);
        tmpEditor.destroy();
        return url;
      },
      applyOperations: async (ops: PosterOperation[]) => {
        const valid = validateOperations(ops);
        if (!valid.ok) return { ok: false, error: valid.error };

        const editor = editorRef.current;
        if (!editor) return { ok: false, error: '编辑器未就绪' };

        editor.history.beginBatch();
        await applyOperations({
          canvas: editor.canvas,
          sketch: editor.sketch,
          canvasSize: stableValue.canvas,
          ops,
          createTextbox: (cfg) => editor.createTextbox(cfg),
          addImage: async (cfg) => editor.addImage(cfg as any),
          replaceImageById: async (id, src) => editor.replaceImageById(id, src),
          setBackground: async (bg) => editor.setBackground(bg),
        });
        editor.history.endBatch();
        return { ok: true };
      },
      undo: async () => {
        const editor = editorRef.current;
        if (!editor) return;
        await editor.history.undo(async (json) =>
          editor.loadFromFabricJson(json),
        );
      },
      redo: async () => {
        const editor = editorRef.current;
        if (!editor) return;
        await editor.history.redo(async (json) =>
          editor.loadFromFabricJson(json),
        );
      },
      canUndo: () => editorRef.current?.history.canUndo() ?? false,
      canRedo: () => editorRef.current?.history.canRedo() ?? false,
      getCanvas: () => editorRef.current?.canvas ?? null,
      suspendViewport: (ms?: number) => editorRef.current?.suspendViewport(ms),
    }));

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'hidden',
          background: 'var(--ant-color-bg-layout)',
          borderRadius: 8,
          border: '1px solid var(--ant-color-border)',
          position: 'relative',
        }}
      >
        <canvas
          ref={canvasRef as any}
          style={{
            display: 'block',
            // 避免用 CSS 缩放 canvas（会导致 fabric 指针坐标映射异常，从而无法选中/拖拽）
            touchAction: 'none',
          }}
        />
      </div>
    );
  },
);

PosterEditor.displayName = 'PosterEditor';

export default PosterEditor;
