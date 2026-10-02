/**
 * image-source.ts — 参考图格式识别与规范化
 *
 * 历史版本只保存纯 base64，并在调用 MiniMax 时统一标记为 image/jpeg。
 * 这里根据文件头识别真实格式，同时兼容 Data URL、HTTP(S) URL、Buffer/Blob。
 */

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DATA_URL_RE = /^data:([^;,]+);base64,([\s\S]+)$/i;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export type SupportedImageMediaType = 'image/jpeg' | 'image/png';

export interface ImageDataPayload {
  mediaType: SupportedImageMediaType;
  base64: string;
  dataUrl: string;
}

function cleanBase64(value: string): string {
  return value.replace(/\s/g, '');
}

function decodeBase64(value: string): Buffer {
  const base64 = cleanBase64(value);
  if (!base64 || !BASE64_RE.test(base64)) {
    throw new Error('参考图不是有效的 Base64 数据');
  }
  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) {
    throw new Error('参考图数据为空');
  }
  if (bytes.length >= MAX_IMAGE_BYTES) {
    throw new Error('参考图超过 10MB 限制');
  }
  return bytes;
}

function detectMediaType(bytes: Uint8Array): SupportedImageMediaType | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  return undefined;
}

function buildImageDataPayload(bytes: Uint8Array): ImageDataPayload {
  const mediaType = detectMediaType(bytes);
  if (!mediaType) {
    throw new Error('参考图格式不受支持，仅支持 PNG / JPG');
  }
  const base64 = Buffer.from(bytes).toString('base64');
  return {
    mediaType,
    base64,
    dataUrl: `data:${mediaType};base64,${base64}`,
  };
}

function buildImageDataPayloadFromBase64(base64Value: string): ImageDataPayload {
  return buildImageDataPayload(decodeBase64(base64Value));
}

function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') return true;

  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export function assertAllowedImageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('参考图 URL 格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('参考图 URL 仅支持 HTTP / HTTPS');
  }
  if (isPrivateHostname(url.hostname)) {
    throw new Error('参考图 URL 不能使用 localhost 或私网地址');
  }
  return url.toString();
}

export async function readImageAsBase64(file: File | Blob | Buffer): Promise<string> {
  if (typeof Buffer !== 'undefined' && file instanceof Buffer) {
    return file.toString('base64');
  }
  if (typeof Blob !== 'undefined' && file instanceof Blob) {
    return Buffer.from(await file.arrayBuffer()).toString('base64');
  }
  throw new Error('Unsupported image input type');
}

/** 统一解析为可传给 Anthropic 兼容多模态端点的 base64 图片块。 */
export async function toImageDataPayload(
  source: string | Buffer | Blob,
  fetchImpl: typeof fetch = fetch,
): Promise<ImageDataPayload> {
  if (typeof source === 'string') {
    const value = source.trim();
    const dataUrlMatch = value.match(DATA_URL_RE);
    if (dataUrlMatch) {
      return buildImageDataPayloadFromBase64(dataUrlMatch[2]);
    }
    if (/^https?:\/\//i.test(value)) {
      const safeUrl = assertAllowedImageUrl(value);
      const res = await fetchImpl(safeUrl);
      if (!res.ok) {
        throw new Error(`参考图下载失败：HTTP ${res.status}`);
      }
      return buildImageDataPayload(new Uint8Array(await res.arrayBuffer()));
    }
    return buildImageDataPayloadFromBase64(value);
  }

  return buildImageDataPayloadFromBase64(await readImageAsBase64(source));
}

/** MiniMax image_generation 所需的 image_file：公网 URL 或正确 MIME 的 Data URL。 */
export async function normalizeImageReference(
  source: string | Buffer | Blob,
): Promise<string> {
  if (typeof source === 'string' && /^https?:\/\//i.test(source.trim())) {
    return assertAllowedImageUrl(source.trim());
  }
  return (await toImageDataPayload(source)).dataUrl;
}
