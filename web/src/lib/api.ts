/**
 * lib/api.ts — 后端 API 客户端
 */
import axios from 'axios';
import type {Category, ColorTone, Task} from '@shared/types/index';

const http = axios.create({
  baseURL: '/api',
  timeout: 90_000,
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

export interface CreateTaskInput {
  category: Category;
  refImages?: string[];
  theme: {
    title: string;
    subtitle?: string;
    tags?: string[];
    gifts?: Array<{name: string; value: string}>;
  };
  colorTone?: ColorTone;
  useLobster?: boolean;
  customPrompt?: string;
  scene?: string;
  variantCount?: number;
  variantStrategy?: 'parallel' | 'diverse';
}

export interface HealthData {
  status: string;
  time: string;
  model: string;
  keyConfigured: boolean;
}

export const api = {
  async health() {
    const {data} = await http.get<{code: number; data: HealthData}>('/health');
    return data.data;
  },

  async createTask(input: CreateTaskInput) {
    const {data} = await http.post<{code: number; data: {taskId: string; status: string}}>(
      '/task/create',
      input,
    );
    return data.data;
  },

  async getTask(id: string) {
    const {data} = await http.get<{code: number; data: Task}>(`/task/${id}`);
    return data.data;
  },

  async listTasks() {
    const {data} = await http.get<{code: number; data: Task[]}>('/task/list');
    return data.data;
  },

  async cancelTask(id: string) {
    const {data} = await http.post<{code: number; data: {cancelled: boolean}}>(
      `/task/${id}/cancel`,
    );
    return data.data;
  },

  async deleteTask(id: string) {
    const {data} = await http.delete<{code: number; data: {deleted: boolean}}>(
      `/task/${id}`,
    );
    return data.data;
  },

  downloadUrl(id: string, variantIndex = 0) {
    return `/api/task/${encodeURIComponent(id)}/download?variant=${variantIndex}`;
  },
};
