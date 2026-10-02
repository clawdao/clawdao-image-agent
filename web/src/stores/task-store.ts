/**
 * stores/task-store.ts — Zustand 状态管理
 */
import {create} from 'zustand';
import {api, CreateTaskInput} from '../lib/api';
import type {Task} from '@shared/types/index';

const TERMINAL_STATUSES = new Set(['completed', 'failed']);

let activePollingId: string | null = null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface TaskState {
  currentTask: Task | null;
  history: Task[];
  loading: boolean;
  historyLoading: boolean;
  createTask: (input: CreateTaskInput) => Promise<Task>;
  loadTask: (id: string) => Promise<Task>;
  pollTask: (id: string) => Promise<Task>;
  cancelTask: (id: string) => Promise<Task>;
  deleteTask: (id: string) => Promise<void>;
  loadHistory: () => Promise<void>;
  clearCurrent: () => void;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  currentTask: null,
  history: [],
  loading: false,
  historyLoading: false,

  async createTask(input) {
    set({loading: true});
    try {
      const {taskId} = await api.createTask(input);
      const pendingTask = {
        id: taskId,
        userId: 'local',
        category: input.category,
        refImages: input.refImages ?? [],
        theme: input.theme,
        ratio: '9:16',
        variantConfig: {
          count: input.variantCount ?? 1,
          strategy: input.variantStrategy ?? 'parallel',
        },
        status: 'pending',
        progress: 0,
        createdAt: new Date().toISOString(),
      } as Task;

      set({currentTask: pendingTask});
      activePollingId = taskId;
      void get().pollTask(taskId);
      void get().loadHistory();
      return pendingTask;
    } finally {
      set({loading: false});
    }
  },

  async loadTask(id) {
    const task = await api.getTask(id);
    set({currentTask: task});
    activePollingId = TERMINAL_STATUSES.has(task.status) ? null : id;
    if (activePollingId === id) void get().pollTask(id);
    return task;
  },

  async pollTask(id) {
    let failures = 0;
    while (activePollingId === id) {
      await sleep(1500);
      if (activePollingId !== id) break;

      try {
        const task = await api.getTask(id);
        failures = 0;
        set({currentTask: task});
        if (TERMINAL_STATUSES.has(task.status)) {
          activePollingId = null;
          void get().loadHistory();
          return task;
        }
      } catch (error) {
        failures += 1;
        console.error('[task-poll]', error);
        if (failures >= 5) {
          activePollingId = null;
          set((state) => ({
            currentTask: state.currentTask && state.currentTask.id === id
              ? {...state.currentTask, status: 'failed', error: '轮询失败，请刷新任务状态'}
              : state.currentTask,
          }));
          throw error;
        }
      }
    }

    const task = get().currentTask;
    if (!task || task.id !== id) throw new Error('任务已切换');
    return task;
  },

  async cancelTask(id) {
    await api.cancelTask(id);
    const task = await api.getTask(id);
    activePollingId = null;
    set({currentTask: task});
    void get().loadHistory();
    return task;
  },

  async deleteTask(id) {
    await api.deleteTask(id);
    set((state) => ({history: state.history.filter((task) => task.id !== id)}));
    if (get().currentTask?.id === id) {
      activePollingId = null;
      set({currentTask: null});
    }
  },

  async loadHistory() {
    set({historyLoading: true});
    try {
      const list = await api.listTasks();
      set({history: list});
    } finally {
      set({historyLoading: false});
    }
  },

  clearCurrent() {
    activePollingId = null;
    set({currentTask: null});
  },
}));
