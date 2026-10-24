/**
 * qr-svg.ts —— 本地二维码生成（矢量 SVG，不依赖任何图片素材）
 *
 * 为什么不用「贴一张二维码图片」：
 *   1. 贴图要用户自己准备素材，配置里就会出现一个失效路径；
 *   2. 贴进来的 PNG 往往带自己的白底和圆角，叠到海报上会出现两层白框；
 *   3. 二维码内容写死在配置里（qr.content），改文案不用换图。
 *
 * 为什么不用 AI 画二维码：
 *   image-01 画不出可扫的码，模块边界糊了就没法扫。
 *
 * 实现：qrcode 库负责编码（字节模式 + Reed-Solomon 纠错 + 掩码择优），
 * 本文件只负责把模块矩阵画成 SVG（按行做游程合并，rect 数量可控）。
 */

import QRCode from 'qrcode';

export type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrSvgOptions {
  /** 二维码整体边长（像素，含静区） */
  size: number;
  /** 模块颜色 */
  dark?: string;
  /** 背景色；null = 不画背景（透明白框由上层提供） */
  light?: string | null;
  /** 静区模块数（标准 4） */
  margin?: number;
  /** 纠错等级，默认 M（约 15% 容错） */
  errorCorrectionLevel?: QrErrorLevel;
}

/** 编码后的模块矩阵 */
export interface QrMatrix {
  /** 矩阵边长（模块数，不含静区） */
  size: number;
  /** 读某模块是否为黑 */
  get(row: number, col: number): boolean;
}

/**
 * 把文本编码成二维码矩阵。
 * 内容为空或编码失败时返回 null（调用方决定怎么兜底）。
 */
export function qrMatrix(content: string, errorCorrectionLevel: QrErrorLevel = 'M'): QrMatrix | null {
  const text = String(content ?? '').trim();
  if (!text) return null;
  try {
    const qr = QRCode.create(text, { errorCorrectionLevel });
    const size = qr.modules.size;
    return {
      size,
      get: (row: number, col: number) => qr.modules.get(row, col) === 1,
    };
  } catch {
    return null;
  }
}

/**
 * 生成二维码 SVG 片段（不含 <svg> 外壳，直接嵌进别的 SVG 里）。
 * 静区用「背景色矩形」实现，方便与白框卡片对齐。
 */
export function qrSvg(content: string, options: QrSvgOptions): string {
  const { size, dark = '#000000', light = '#FFFFFF', margin = 4 } = options;
  const matrix = qrMatrix(content, options.errorCorrectionLevel);
  if (!matrix) return '';

  const total = matrix.size + margin * 2;
  const unit = size / total;

  const parts: string[] = [];
  if (light) {
    parts.push(`<rect x="0" y="0" width="${size.toFixed(2)}" height="${size.toFixed(2)}" fill="${light}"/>`);
  }

  // 按行做游程合并：连续的黑色模块合成一个矩形，rect 数量从 O(n²) 降到 O(n)
  const rects: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    let col = 0;
    while (col < matrix.size) {
      if (!matrix.get(row, col)) {
        col += 1;
        continue;
      }
      let end = col;
      while (end < matrix.size && matrix.get(row, end)) end += 1;
      const x = (margin + col) * unit;
      const w = (end - col) * unit;
      const y = (margin + row) * unit;
      rects.push(
        `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${unit.toFixed(2)}"/>`,
      );
      col = end;
    }
  }

  parts.push(`<g fill="${dark}">${rects.join('')}</g>`);
  return parts.join('');
}

/** 估算某个内容在该纠错等级下的二维码边长（模块数，含静区） */
export function qrModuleCount(content: string, errorCorrectionLevel: QrErrorLevel = 'M'): number {
  const matrix = qrMatrix(content, errorCorrectionLevel);
  return matrix ? matrix.size + 8 : 0;
}
