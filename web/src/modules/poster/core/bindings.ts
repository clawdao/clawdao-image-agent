import type { DataContext, PosterBindings } from '../types';

// 透明 1x1 PNG：用于兜底替换无效图片 src，避免 fabric 在 loadFromJSON 时因图片加载失败而 reject（导致整张画布不渲染）。
const TRANSPARENT_PNG_1PX =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO9Wn7cAAAAASUVORK5CYII=';

const getByPath = (obj: any, path: string) => {
  if (!path) return undefined;
  const parts = path.split('.').filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
};

const applyTemplate = (tpl: string, data: DataContext) => {
  // 关键：当数据缺失时保留原始占位符（{{...}}），避免加载草稿时把文本替换成空字符串导致“内容消失”。
  return String(tpl || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (match, raw) => {
    const v = getByPath(data, String(raw).trim());
    return v === null || v === undefined ? match : String(v);
  });
};

export const applyBindingsToFabricJson = (
  fabricJson: any,
  bindings: PosterBindings | undefined,
  dataCtx: DataContext,
) => {
  if (!fabricJson || !Array.isArray(fabricJson.objects)) return fabricJson;

  const next = { ...fabricJson, objects: [...fabricJson.objects] };
  next.objects = next.objects.map((obj: any) => {
    if (!obj) return obj;

    const patched = { ...obj };
    const id = obj?.id;
    const rules = id ? (bindings?.[id] || {}) : {};

    // 1. 应用显式绑定规则
    for (const [prop, rule] of Object.entries(rules)) {
      if (!rule || typeof rule.source !== 'string') continue;

      // 兼容：旧模板可能用 {{qrCodeUrl}} / {{qrCodeCode}} 作为二维码图片 src。
      // 只在 image src 场景下，优先使用 qrCodeDataUrl（data:image/...），避免跨域图片污染 canvas。
      if (
        prop === 'src' &&
        /\{\{\s*(qrCodeUrl|qrCodeCode)\s*\}\}/.test(rule.source) &&
        typeof (dataCtx as any)?.qrCodeDataUrl === 'string' &&
        String((dataCtx as any).qrCodeDataUrl).startsWith('data:image/')
      ) {
        patched[prop] = String(rule.source)
          .replace(/\{\{\s*qrCodeUrl\s*\}\}/g, String((dataCtx as any).qrCodeDataUrl))
          .replace(/\{\{\s*qrCodeCode\s*\}\}/g, String((dataCtx as any).qrCodeDataUrl));
        continue;
      }

      patched[prop] = applyTemplate(rule.source, dataCtx);
    }

    // 2. 兜底扫描：如果文本对象包含 {{...}}，无论是否有显式绑定规则，都尝试替换（增强鲁棒性，尤其是从 v1 导入时）
    const isText = ['textbox', 'text', 'i-text'].includes(String(patched.type).toLowerCase());
    if (isText && typeof patched.text === 'string' && patched.text.includes('{{')) {
      patched.text = applyTemplate(patched.text, dataCtx);
    }

    // 3. 兜底：图像源安全性检查。image src 不能是未解析的 {{...}} / 空串，
    // 否则 fabric.util.loadImage 会尝试请求无效 URL 并在 loadFromJSON 过程中由于 Promise reject 导致整个渲染链路崩溃报“生成海报失败”。
    const isImage = ['image', 'image-element'].includes(String(patched.type).toLowerCase());
    if (isImage) {
      const src = String(patched.src || '');
      if (!src || src.includes('{{')) {
        patched.src = TRANSPARENT_PNG_1PX;
      }
    }

    return patched;
  });

  return next;
};
