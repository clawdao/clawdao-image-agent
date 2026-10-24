import QRCode from 'qrcode';
import type { DataContext, PosterDesignV2Config } from '../types';
import { DDNPosterEditor } from './DDNPosterEditor';
import { applyBindingsToFabricJson } from './bindings';

export async function renderPosterV2ToDataUrl(
  design: PosterDesignV2Config,
  dataCtx: DataContext,
  options?: { width?: number; multiplier?: number },
): Promise<string> {
  let safeCtx: DataContext = dataCtx;

  // 兜底：如果模板用到了 qrCodeDataUrl，但调用方没提供，则尝试用 qrCodeUrl 生成
  const qrCodeDataUrl = (dataCtx as any)?.qrCodeDataUrl;
  const qrCodeUrl = (dataCtx as any)?.qrCodeUrl;
  if (
    (!qrCodeDataUrl || typeof qrCodeDataUrl !== 'string') &&
    typeof qrCodeUrl === 'string' &&
    qrCodeUrl
  ) {
    try {
      const url = qrCodeUrl.trim();
      const generated = url.startsWith('data:image/')
        ? url
        : await QRCode.toDataURL(url, { margin: 0, width: 512 });
      safeCtx = { ...(dataCtx as any), qrCodeDataUrl: generated } as any;
    } catch {
      // ignore：生成失败时继续走原始 dataCtx（可能导致二维码缺失或导出失败，由上层处理）
    }
  }

  const templateJson = design.fabricJson;
  const renderJson = applyBindingsToFabricJson(
    templateJson,
    design.bindings,
    safeCtx,
  );

  const tmpCanvas = document.createElement('canvas');
  const tmpContainer = document.createElement('div');
  tmpContainer.style.width = `${design.canvas.width}px`;
  tmpContainer.style.height = `${design.canvas.height}px`;

  const tmpEditor = new DDNPosterEditor({
    canvasEl: tmpCanvas,
    containerEl: tmpContainer,
    canvasSize: design.canvas,
  });

  await tmpEditor.loadFromFabricJson(renderJson);
  const url = await tmpEditor.exportPng(options);
  tmpEditor.destroy();
  return url;
}
