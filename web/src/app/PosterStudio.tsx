/**
 * app/PosterStudio.tsx — 海报工作室（Fabric 可视化编辑 + 文生图/图生图 + AI 指令）
 *
 * 与 ddn-hub 的关系：
 *   - 画布内核、图层/撤销/导出：直接用迁移过来的 Fabric 编辑器；
 *   - 模板：不搬它的 MySQL 模板表，改成内置几套；
 *   - 图像生成：接本项目的 MiniMax image-01；
 *   - AI 指令：接本项目的 LLM 网关（ddn-hub 那边是随机 mock）。
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  App as AntApp,
  Button,
  Card,
  ColorPicker,
  Divider,
  Empty,
  Input,
  Select,
  Space,
  Tooltip,
  Typography,
} from 'antd';
import {
  DownloadOutlined,
  RedoOutlined,
  SaveOutlined,
  UndoOutlined,
} from '@ant-design/icons';

import PosterEditor, {type PosterEditorHandle} from '../modules/poster/ui/PosterEditor';
import LayerPanel, {type LayerItem} from '../modules/poster/ui/LayerPanel';
import PropertyPanel from '../modules/poster/ui/PropertyPanel';
import GeneratePanel from '../modules/poster/ui/GeneratePanel';
import AiOpsPanel from '../modules/poster/ui/AiOpsPanel';
import {
  POSTER_TEMPLATES,
  getTemplate,
  templateToDesign,
} from '../modules/poster/templates';
import type {
  PosterBackground,
  PosterDesignV2Config,
  PosterOperation,
} from '../modules/poster/types';
import {posterApi, type PosterDraftItem} from '../lib/poster-api';

const GRADIENT_PRESETS: Array<{name: string; colors: string[]}> = [
  {name: '深蓝夜色', colors: ['#0A2455', '#050F28']},
  {name: '琥珀暖色', colors: ['#FFF9F0', '#FFD9A0']},
  {name: '清新绿', colors: ['#FDFCF0', '#CDE9A8']},
  {name: '珊瑚渐变', colors: ['#FF6B5C', '#F08A24']},
];

function layerLabel(obj: any): string {
  const type = String(obj?.type ?? '');
  if (type === 'textbox' || type === 'text' || type === 'i-text') {
    const text = String(obj?.text ?? '').replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, 18) : '（空文字）';
  }
  if (type === 'image') {
    const src = String(obj?.src ?? '');
    const name = src.split('/').pop() || '图片';
    return name.length > 18 ? `${name.slice(0, 16)}…` : name;
  }
  if (obj?.ddnRole) return String(obj.ddnRole);
  return type || '对象';
}

export default function PosterStudio() {
  const {message} = AntApp.useApp();

  const editorRef = useRef<PosterEditorHandle | null>(null);
  const [design, setDesign] = useState<PosterDesignV2Config>(() =>
    templateToDesign(getTemplate('card-3x4')),
  );
  const [templateId, setTemplateId] = useState('card-3x4');
  const [layers, setLayers] = useState<LayerItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [activeObject, setActiveObject] = useState<any | null>(null);
  // 背景同时存在于 design.background（随草稿保存）和画布（Fabric backgroundColor）
  const [background, setBackground] = useState<PosterBackground | undefined>(
    () => getTemplate('card-3x4').background,
  );
  const [drafts, setDrafts] = useState<PosterDraftItem[]>([]);
  const [draftId, setDraftId] = useState<string | undefined>();
  const [draftName, setDraftName] = useState('未命名海报');

  // dataCtx 必须是稳定引用：PosterEditor 的重载 effect 依赖它，
  // 每次渲染都传新的对象字面量会导致 effect 反复重载画布（清屏 → 渲染 循环）。
  const dataCtx = useMemo(() => ({}), []);

  const refreshLayers = useCallback(() => {
    const canvas = editorRef.current?.getCanvas();
    if (!canvas) return;
    const objects = canvas.getObjects() as any[];
    setLayers(
      objects.map((obj) => ({
        id: String(obj?.id ?? ''),
        type: String(obj?.type ?? 'object'),
        label: layerLabel(obj),
        visible: obj?.visible !== false,
        locked: !!obj?.locked,
      })),
    );
  }, []);

  // 画布事件 → 图层列表 / 选中态
  useEffect(() => {
    let raf = 0;
    let attached = false;

    const attach = () => {
      if (attached) return;
      const canvas = editorRef.current?.getCanvas();
      if (!canvas) {
        raf = requestAnimationFrame(attach);
        return;
      }
      attached = true;

      const syncSelection = () => {
        const active = canvas.getActiveObject() as any;
        setSelectedId(active?.id ? String(active.id) : undefined);
        setActiveObject(active ?? null);
        refreshLayers();
      };
      canvas.on('selection:created', syncSelection);
      canvas.on('selection:updated', syncSelection);
      canvas.on('selection:cleared', syncSelection);
      canvas.on('object:added', refreshLayers);
      canvas.on('object:removed', refreshLayers);
      canvas.on('object:modified', refreshLayers);
      refreshLayers();
    };

    raf = requestAnimationFrame(attach);
    return () => {
      cancelAnimationFrame(raf);
      const canvas = editorRef.current?.getCanvas();
      if (canvas && attached) {
        canvas.off('selection:created');
        canvas.off('selection:updated');
        canvas.off('selection:cleared');
      }
    };
  }, [refreshLayers]);

  // 开发期调试钩子（生产构建里不会保留）：可在浏览器控制台直接拿到编辑器实例
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as any).__posterStudio = {
      editorRef,
      getDesign: () => editorRef.current?.getDesignV2(),
      getCanvas: () => editorRef.current?.getCanvas(),
    };
  }, []);

  const fireChange = useCallback(() => {
    const canvas = editorRef.current?.getCanvas();
    canvas?.fire('ddn:object:modified' as any);
    canvas?.requestRenderAll();
    refreshLayers();
  }, [refreshLayers]);

  const findObject = (id: string) => {
    const canvas = editorRef.current?.getCanvas();
    if (!canvas) return null;
    return (canvas.getObjects() as any[]).find((o) => String(o?.id) === id) ?? null;
  };

  /* ---------------- 模板 / 草稿 ---------------- */

  const handleTemplateChange = async (id: string) => {
    const template = getTemplate(id);
    setTemplateId(id);
    const next = templateToDesign(template);
    setDesign(next);
    setBackground(template.background);
    // 背景随 design 走：<PosterEditor> 载入时会自动 setBackground
    message.success(`已切换到模板「${template.name}」`);
  };

  const loadDrafts = useCallback(async () => {
    try {
      const list = await posterApi.listDrafts();
      setDrafts(list);
    } catch {
      /* 忽略：草稿列表失败不影响编辑 */
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleLoadDraft = async (id: string) => {
    try {
      const draft = await posterApi.loadDraft(id);
      setDesign(draft.design);
      setBackground(draft.design.background);
      setDraftName(draft.name);
      setDraftId(draft.id);
      message.success(`已载入草稿「${draft.name}」`);
    } catch (e) {
      message.error((e as Error).message || '载入失败');
    }
  };

  const handleSaveDraft = async () => {
    try {
      const current = editorRef.current?.getDesignV2() ?? design;
      const out = await posterApi.save(current, draftName);
      message.success(`已保存草稿：${out.id}`);
      void loadDrafts();
    } catch (e) {
      message.error((e as Error).message || '保存失败');
    }
  };

  /* ---------------- 画布操作 ---------------- */

  const handleUseAsBackground = async (src: string) => {
    const bg: PosterBackground = {type: 'image', src};
    setBackground(bg);
    setDesign((d) => ({...d, background: bg}));
    const res = await editorRef.current?.applyOperations([
      {op: 'setBackground', background: bg},
    ]);
    if (res && !res.ok) message.error(res.error || '设置背景失败');
    else message.success('已设为背景（可在画布上继续叠字）');
  };

  const handleInsertAsLayer = async (
    src: string,
    width?: number,
    height?: number,
  ) => {
    const canvasSize = design.canvas;
    const w = Math.min(width ?? canvasSize.width, canvasSize.width * 0.8);
    const h = height ? Math.round((w / (width || 1)) * height) : undefined;
    const op: PosterOperation = {
      op: 'addImage',
      src,
      left: Math.round((canvasSize.width - w) / 2),
      top: Math.round((canvasSize.height - (h ?? w)) / 2),
      width: Math.round(w),
      height: h,
    };
    const res = await editorRef.current?.applyOperations([op]);
    if (res && !res.ok) message.error(res.error || '插入失败');
    else message.success('已插入为可拖动的图层');
  };

  const handleApplyOperations = async (
    ops: PosterOperation[],
    explanation?: string,
  ) => {
    const res = await editorRef.current?.applyOperations(ops);
    if (res && !res.ok) {
      message.error(res.error || '操作未通过校验');
      return;
    }
    refreshLayers();
    if (explanation) message.success(explanation);
  };

  const handleExport = async () => {
    const dataUrl = await editorRef.current?.exportPng(
      {},
      {multiplier: 1, background},
    );
    if (!dataUrl) {
      message.error('导出失败');
      return;
    }
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${draftName || 'poster'}-${Date.now()}.png`;
    a.click();
    message.success('已导出 PNG');
  };

  const handleAddText = async () => {
    const op: PosterOperation = {
      op: 'addText',
      text: '双击编辑文字',
      left: Math.round(design.canvas.width * 0.1),
      top: Math.round(design.canvas.height * 0.45),
      width: Math.round(design.canvas.width * 0.8),
      fontSize: 48,
      fill: '#1F2937',
    };
    await editorRef.current?.applyOperations([op]);
    refreshLayers();
  };

  const handleBackground = async (bg: PosterBackground) => {
    setBackground(bg);
    setDesign((d) => ({...d, background: bg}));
    const res = await editorRef.current?.applyOperations([
      {op: 'setBackground', background: bg},
    ]);
    if (res && !res.ok) message.error(res.error || '设置背景失败');
  };

  const layerActions = useMemo(
    () => ({
      onSelect: (id: string) => {
        const canvas = editorRef.current?.getCanvas();
        const obj = findObject(id);
        if (!canvas || !obj) return;
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
      },
      onToggleVisible: (id: string) => {
        const obj = findObject(id);
        if (!obj) return;
        obj.visible = obj.visible === false;
        fireChange();
      },
      onToggleLock: (id: string) => {
        const obj = findObject(id);
        if (!obj) return;
        const locked = !obj.locked;
        obj.set({
          locked,
          selectable: !locked,
          evented: !locked,
          hasControls: !locked,
        });
        fireChange();
      },
      onDelete: (id: string) => {
        const canvas = editorRef.current?.getCanvas();
        const obj = findObject(id);
        if (!canvas || !obj) return;
        canvas.remove(obj);
        fireChange();
      },
      onMove: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
        const canvas = editorRef.current?.getCanvas();
        const obj = findObject(id);
        if (!canvas || !obj) return;
        if (dir === 'up') canvas.bringObjectForward(obj);
        else if (dir === 'down') canvas.sendObjectBackwards(obj);
        else if (dir === 'top') canvas.bringObjectToFront(obj);
        else canvas.sendObjectToBack(obj);
        fireChange();
      },
    }),
    [fireChange],
  );

  return (
    <div style={{display: 'flex', flexDirection: 'column', height: '100%', gap: 8}}>
      {/* 工具栏 */}
      <Card size="small" styles={{body: {padding: 8}}}>
        <Space size={8} wrap>
          <Select
            size="small"
            value={templateId}
            style={{width: 150}}
            onChange={(v) => void handleTemplateChange(v)}
            options={POSTER_TEMPLATES.map((t) => ({
              value: t.id,
              label: t.name,
            }))}
          />
          <Tooltip title="撤销">
            <Button
              size="small"
              aria-label="撤销"
              icon={<UndoOutlined />}
              onClick={() => void editorRef.current?.undo()}
            />
          </Tooltip>
          <Tooltip title="重做">
            <Button
              size="small"
              aria-label="重做"
              icon={<RedoOutlined />}
              onClick={() => void editorRef.current?.redo()}
            />
          </Tooltip>
          <Button size="small" onClick={() => void handleAddText()}>
            加文字
          </Button>
          <Divider type="vertical" />
          <Space size={4}>
            <ColorPicker
              size="small"
              value="#FFFFFF"
              onChange={(c) =>
                void handleBackground({type: 'solid', color: c.toHexString()})
              }
              showText
            />
            {GRADIENT_PRESETS.map((g) => (
              <Tooltip key={g.name} title={g.name}>
                <span
                  onClick={() =>
                    void handleBackground({
                      type: 'gradient',
                      gradient: {type: 'linear', colors: g.colors},
                    })
                  }
                  style={{
                    display: 'inline-block',
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    cursor: 'pointer',
                    border: '1px solid rgba(0,0,0,0.12)',
                    background: `linear-gradient(135deg, ${g.colors[0]}, ${g.colors[1]})`,
                  }}
                />
              </Tooltip>
            ))}
          </Space>
          <Divider type="vertical" />
          <Select
            size="small"
            placeholder="载入草稿"
            style={{width: 160}}
            value={draftId}
            onChange={(v) => {
              setDraftId(v);
              void handleLoadDraft(v);
            }}
            options={drafts.map((d) => ({
              value: d.id,
              label: `${d.name} · ${new Date(d.updatedAt).toLocaleString('zh-CN', {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}`,
            }))}
          />
          <Input
            size="small"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            style={{width: 140}}
            placeholder="草稿名"
          />
          <Button
            size="small"
            icon={<SaveOutlined />}
            onClick={() => void handleSaveDraft()}
          >
            保存
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={() => void handleExport()}
          >
            导出 PNG
          </Button>
        </Space>
      </Card>

      {/* 三栏 */}
      <div style={{display: 'flex', gap: 8, flex: 1, minHeight: 0}}>
        <div style={{width: 300, overflowY: 'auto', flexShrink: 0}}>
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            <GeneratePanel
              onUseAsBackground={(src) => void handleUseAsBackground(src)}
              onInsertAsLayer={(src, w, h) => void handleInsertAsLayer(src, w, h)}
            />
            <AiOpsPanel
              getDesign={() => editorRef.current?.getDesignV2() ?? design}
              onOperations={handleApplyOperations}
            />
          </Space>
        </div>

        <div
          style={{
            flex: 1,
            minWidth: 0,
            borderRadius: 8,
            border: '1px solid var(--ant-color-border)',
            overflow: 'hidden',
          }}
        >
          <PosterEditor
            ref={editorRef}
            value={design}
            onChange={setDesign}
            dataCtx={dataCtx}
          />
        </div>

        <div style={{width: 280, overflowY: 'auto', flexShrink: 0}}>
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            <Card size="small" title="图层">
              {layers.length ? (
                <LayerPanel
                  layers={layers}
                  selectedId={selectedId}
                  {...layerActions}
                />
              ) : (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="画布还没有图层"
                />
              )}
            </Card>
            <Card size="small" title="属性">
              <PropertyPanel object={activeObject} onChanged={fireChange} />
            </Card>
            <Card size="small" title="提示">
              <Typography.Paragraph type="secondary" style={{fontSize: 11, marginBottom: 4}}>
                画布内：拖动改位置、滚轮缩放、双击文字直接改字。
              </Typography.Paragraph>
              <Typography.Paragraph type="secondary" style={{fontSize: 11, marginBottom: 0}}>
                文案由本地排版层叠加，AI 只负责出质感与构图。
              </Typography.Paragraph>
            </Card>
          </Space>
        </div>
      </div>
    </div>
  );
}
