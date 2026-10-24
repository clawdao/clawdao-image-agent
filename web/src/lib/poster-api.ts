/**
 * lib/poster-api.ts — 海报工作室后端接口客户端
 *
 * 对应 src/app-server/poster-api.ts：
 *   POST /api/poster/generate   文生图 / 图生图
 *   POST /api/poster/ai-ops     自然语言指令 → 受控操作
 *   POST /api/poster/save       保存草稿
 *   GET  /api/poster/drafts     草稿列表
 */
import axios from 'axios';
import type {PosterDesignV2Config, PosterOperation} from '../modules/poster/types';

const http = axios.create({
  baseURL: '/api',
  timeout: 180_000,
  headers: {'Content-Type': 'application/json'},
});

http.interceptors.response.use(
  (r) => r,
  (e) => {
    const msg =
      e?.response?.data?.msg ||
      e?.response?.data?.message ||
      e?.message ||
      '请求失败';
    return Promise.reject(new Error(msg));
  },
);

export interface GeneratedImage {
  url: string;
  file?: string;
  width?: number;
  height?: number;
  bytes?: number;
}

export interface PosterGenerateResult {
  images: GeneratedImage[];
  aspectRatio: string;
  mode: 't2i' | 'i2i';
}

export interface PosterAiOpsResult {
  operations: PosterOperation[];
  explanation?: string;
  suggestions: string[];
  rejected: string[];
}

export interface PosterDraftItem {
  id: string;
  name: string;
  updatedAt: string;
  bytes: number;
}

export interface PosterGenerateInput {
  prompt: string;
  aspectRatio?: string;
  n?: number;
  refImages?: string[];
  noText?: boolean;
}

export const posterApi = {
  async generate(input: PosterGenerateInput): Promise<PosterGenerateResult> {
    const {data} = await http.post<{code: number; data: PosterGenerateResult}>(
      '/poster/generate',
      input,
    );
    return data.data;
  },

  async aiOps(
    design: PosterDesignV2Config,
    instruction: string,
  ): Promise<PosterAiOpsResult> {
    const {data} = await http.post<{code: number; data: PosterAiOpsResult}>(
      '/poster/ai-ops',
      {design, instruction},
    );
    return data.data;
  },

  async save(design: PosterDesignV2Config, name: string) {
    const {data} = await http.post<{
      code: number;
      data: {id: string; url: string; updatedAt: string};
    }>('/poster/save', {design, name});
    return data.data;
  },

  async listDrafts(): Promise<PosterDraftItem[]> {
    const {data} = await http.get<{code: number; data: PosterDraftItem[]}>('/poster/drafts');
    return data.data;
  },

  async loadDraft(id: string): Promise<{id: string; name: string; design: PosterDesignV2Config}> {
    const {data} = await http.get<{code: number; data: any}>('/poster/draft', {
      params: {id},
    });
    return data.data;
  },

  async deleteDraft(id: string): Promise<boolean> {
    const {data} = await http.delete<{code: number; data: {deleted: boolean}}>('/poster/draft', {
      params: {id},
    });
    return data.data.deleted;
  },
};
