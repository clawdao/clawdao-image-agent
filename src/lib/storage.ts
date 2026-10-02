/**
 * storage.ts — 任务持久化抽象层
 *
 * 默认实现：SQLiteStorage（基于 bun:sqlite，零依赖）
 * 降级实现：MemoryStorage（USE_MEMORY_STORE=1 启用，便于开发调试）
 *
 * 使用：
 *   import {createStorage} from './storage';
 *   const storage = createStorage('./outputs/clawdao.db');
 *   await storage.init();
 *   await storage.save(task);
 *   const t = await storage.get(id);
 */

import {existsSync, readFileSync} from 'node:fs';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';

// ============ 抽象接口 ============
export interface StorageTask {
  id: string;
  userId: string;
  category: string;
  refImages: string[];
  theme: Record<string, unknown>;
  ratio: string;
  status: string;
  progress: number;
  variantConfig?: {
    count: number;
    strategy: 'parallel' | 'diverse';
  };
  result?: {
    imageUrl: string;
    thumbUrl?: string;
    variants?: Array<{url: string; width: number; height: number; bytes: number}>;
    params: Record<string, unknown>;
  };
  error?: string;
  scene?: string;
  customPrompt?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Storage {
  init(): Promise<void>;
  save(task: StorageTask): Promise<void>;
  get(id: string): Promise<StorageTask | null>;
  list(opts?: {limit?: number; offset?: number}): Promise<StorageTask[]>;
  delete(id: string): Promise<boolean>;
  close(): void;
}

// ============ 内存实现（降级） ============
export class MemoryStorage implements Storage {
  private store = new Map<string, StorageTask>();

  async init(): Promise<void> {/* no-op */}

  async save(task: StorageTask): Promise<void> {
    this.store.set(task.id, {...task});
  }

  async get(id: string): Promise<StorageTask | null> {
    return this.store.get(id) ?? null;
  }

  async list(opts: {limit?: number; offset?: number} = {}): Promise<StorageTask[]> {
    const {limit = 100, offset = 0} = opts;
    const all = [...this.store.values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    return all.slice(offset, offset + limit);
  }

  async delete(id: string): Promise<boolean> {
    return this.store.delete(id);
  }

  close(): void {/* no-op */}
}

// ============ SQLite 实现（默认，bun:sqlite 零依赖） ============
export class SqliteStorage implements Storage {
  private db: unknown;  // bun:sqlite Database

  constructor(private dbPath: string) {}

  async init(): Promise<void> {
    // bun:sqlite 是 Bun 内置 API；动态 import 以兼容非 Bun 运行环境
    const {Database} = await import('bun:sqlite');
    mkdirSync(dirname(this.dbPath), {recursive: true});
    this.db = new Database(this.dbPath, {create: true});

    // 启用 WAL 模式（并发读 + 串行写，Bun 默认不开）
    (this.db as {exec: (sql: string) => void}).exec('PRAGMA journal_mode = WAL;');
    (this.db as {exec: (sql: string) => void}).exec('PRAGMA synchronous = NORMAL;');

    // 建表（幂等）
    (this.db as {exec: (sql: string) => void}).exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL DEFAULT 'local',
        category      TEXT NOT NULL,
        ref_images    TEXT NOT NULL DEFAULT '[]',
        theme         TEXT NOT NULL,
        ratio         TEXT NOT NULL,
        status        TEXT NOT NULL,
        progress      REAL NOT NULL DEFAULT 0,
        result        TEXT,
        variant_config TEXT,
        scene         TEXT,
        custom_prompt TEXT,
        error         TEXT,
        created_at    TEXT NOT NULL,
        completed_at  TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at DESC);
    `);

    // 兼容已有数据库：为 v0.2 变体配置补充列。
    const columns = (this.db as {
      query: (sql: string) => {all: () => Array<{name: string}>};
    }).query('PRAGMA table_info(tasks)').all();
    if (!columns.some((column) => column.name === 'variant_config')) {
      (this.db as {exec: (sql: string) => void}).exec(
        'ALTER TABLE tasks ADD COLUMN variant_config TEXT;'
      );
    }
  }

  async save(task: StorageTask): Promise<void> {
    const db = this.db as {
      query: (sql: string) => {
        run: (...args: unknown[]) => unknown;
      };
    };
    db.query(`
      INSERT INTO tasks (id, user_id, category, ref_images, theme, ratio, status, progress, result, error, variant_config, scene, custom_prompt, created_at, completed_at)
      VALUES ($id, $user_id, $category, $ref_images, $theme, $ratio, $status, $progress, $result, $error, $variant_config, $scene, $custom_prompt, $created_at, $completed_at)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        progress = excluded.progress,
        result = excluded.result,
        error = excluded.error,
        variant_config = excluded.variant_config,
        completed_at = excluded.completed_at
    `).run({
      $id: task.id,
      $user_id: task.userId,
      $category: task.category,
      $ref_images: JSON.stringify(task.refImages ?? []),
      $theme: JSON.stringify(task.theme),
      $ratio: task.ratio,
      $status: task.status,
      $progress: task.progress,
      $result: task.result ? JSON.stringify(task.result) : null,
      $error: task.error ?? null,
      $variant_config: task.variantConfig ? JSON.stringify(task.variantConfig) : null,
      $scene: task.scene ?? null,
      $custom_prompt: task.customPrompt ?? null,
      $created_at: task.createdAt,
      $completed_at: task.completedAt ?? null,
    });
  }

  async get(id: string): Promise<StorageTask | null> {
    const db = this.db as {
      query: (sql: string) => {
        get: (...args: unknown[]) => unknown;
      };
    };
    const row = db.query(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | null;
    if (!row) return null;
    return this.rowToTask(row);
  }

  async list(opts: {limit?: number; offset?: number} = {}): Promise<StorageTask[]> {
    const {limit = 100, offset = 0} = opts;
    const db = this.db as {
      query: (sql: string) => {
        all: (...args: unknown[]) => unknown[];
      };
    };
    const rows = db.query(
      `SELECT * FROM tasks ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).all(limit, offset) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  async delete(id: string): Promise<boolean> {
    const db = this.db as {
      query: (sql: string) => {
        run: (...args: unknown[]) => {changes: number};
      };
    };
    const r = db.query(`DELETE FROM tasks WHERE id = ?`).run(id);
    return r.changes > 0;
  }

  close(): void {
    if (this.db) {
      (this.db as {close: () => void}).close();
    }
  }

  private rowToTask(row: Record<string, unknown>): StorageTask {
    return {
      id: row.id as string,
      userId: row.user_id as string,
      category: row.category as string,
      refImages: JSON.parse((row.ref_images as string) ?? '[]'),
      theme: JSON.parse(row.theme as string),
      ratio: row.ratio as string,
      status: row.status as string,
      progress: row.progress as number,
      variantConfig: row.variant_config ? JSON.parse(row.variant_config as string) : undefined,
      result: row.result ? JSON.parse(row.result as string) : undefined,
      error: (row.error as string) ?? undefined,
      scene: (row.scene as string) ?? undefined,
      customPrompt: (row.custom_prompt as string) ?? undefined,
      createdAt: row.created_at as string,
      completedAt: (row.completed_at as string) ?? undefined,
    };
  }
}

// ============ 工厂 ============
let _instance: Storage | null = null;

export interface CreateStorageOptions {
  /** 强制使用内存（默认 false） */
  memory?: boolean;
  /** 数据库文件路径（默认 ./outputs/clawdao.db） */
  dbPath?: string;
}

export async function createStorage(opts: CreateStorageOptions = {}): Promise<Storage> {
  if (_instance) return _instance;

  const useMemory =
    opts.memory ||
    process.env.USE_MEMORY_STORE === '1' ||
    process.env.USE_MEMORY_STORE === 'true' ||
    typeof (globalThis as {Bun?: unknown}).Bun === 'undefined';

  if (useMemory) {
    const m = new MemoryStorage();
    await m.init();
    _instance = m;
    return m;
  }

  const dbPath = opts.dbPath ?? resolveDefaultDbPath();
  const s = new SqliteStorage(dbPath);
  await s.init();
  _instance = s;
  return s;
}

export function resetStorage(): void {
  if (_instance) {
    _instance.close();
  }
  _instance = null;
}

function resolveDefaultDbPath(): string {
  // 优先使用 OUTPUTS_DIR env；否则 cwd/outputs/clawdao.db
  const dir = process.env.OUTPUTS_DIR ?? './outputs';
  return `${dir.replace(/\/$/, '')}/clawdao.db`;
}

// ============ 兼容层：旧 Map 风格接口（不破坏现有 task-manager） ============
export interface LegacyTaskStoreLike {
  get(id: string): unknown;
  set(id: string, value: unknown): void;
  delete(id: string): boolean;
  values(): IterableIterator<unknown>;
}

/** 把 Storage 适配成旧 Map 风格 API（task-manager.ts 用） */
export function asLegacyMap(storage: Storage): LegacyTaskStoreLike & {
  ready: Promise<void>;
  listAll: () => unknown[];
} {
  const cache = new Map<string, unknown>();
  // 启动时拉一次所有任务到内存（轻量，task 数远小于 image 数）
  const ready = storage.list({limit: 1000}).then((all) => {
    for (const t of all) cache.set(t.id, t);
  });

  return {
    ready,
    get(id: string): unknown {
      return cache.get(id);
    },
    set(id: string, value: unknown): void {
      cache.set(id, value);
      // 异步持久化（不 await，避免阻塞）
      void storage.save(value as StorageTask).catch((e) => {
        console.error(`[storage] save ${id} failed:`, (e as Error).message);
      });
    },
    delete(id: string): boolean {
      const ok = cache.delete(id);
      void storage.delete(id).catch((e) => {
        console.error(`[storage] delete ${id} failed:`, (e as Error).message);
      });
      return ok;
    },
    values(): IterableIterator<unknown> {
      return cache.values();
    },
    listAll(): unknown[] {
      return [...cache.values()].sort((a, b) => {
        const ta = (a as StorageTask).createdAt;
        const tb = (b as StorageTask).createdAt;
        return tb.localeCompare(ta);
      });
    },
  };
}
