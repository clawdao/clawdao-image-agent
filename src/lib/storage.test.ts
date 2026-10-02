import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import {unlinkSync, mkdtempSync, existsSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

import {
  MemoryStorage,
  SqliteStorage,
  createStorage,
  resetStorage,
  type StorageTask,
} from './storage';

const sampleTask = (id: string, overrides: Partial<StorageTask> = {}): StorageTask => ({
  id,
  userId: 'local',
  category: 'cover',
  refImages: [],
  theme: {title: '测试', subtitle: '端到端'},
  ratio: '9:16',
  status: 'pending',
  progress: 0,
  scene: 'holiday',
  createdAt: new Date().toISOString(),
  ...overrides,
});

describe('MemoryStorage', () => {
  let s: MemoryStorage;

  beforeEach(() => {
    s = new MemoryStorage();
  });

  it('save + get 往返一致', async () => {
    await s.init();
    const t = sampleTask('t1', {theme: {title: 'Test', subtitle: 'end2end'}, ratio: '9:16'});
    await s.save(t);
    const got = await s.get('t1');
    expect(got?.id).toBe('t1');
    expect((got?.theme as any).title).toBe('Test');
  });

  it('不存在的 id 返回 null', async () => {
    await s.init();
    expect(await s.get('missing')).toBeNull();
  });

  it('list 按 createdAt DESC 排序', async () => {
    await s.init();
    await s.save(sampleTask('a', {createdAt: '2026-01-01T00:00:00Z'}));
    await s.save(sampleTask('b', {createdAt: '2026-01-02T00:00:00Z'}));
    await s.save(sampleTask('c', {createdAt: '2026-01-03T00:00:00Z'}));
    const list = await s.list();
    expect(list.map((t) => t.id)).toEqual(['c', 'b', 'a']);
  });

  it('list 支持 limit + offset', async () => {
    await s.init();
    for (let i = 0; i < 5; i++) {
      await s.save(sampleTask(`t${i}`, {createdAt: `2026-01-0${i+1}T00:00:00Z`}));
    }
    const page1 = await s.list({limit: 2, offset: 0});
    expect(page1.map((t) => t.id)).toEqual(['t4', 't3']);
    const page2 = await s.list({limit: 2, offset: 2});
    expect(page2.map((t) => t.id)).toEqual(['t2', 't1']);
  });

  it('delete 返回 true/false', async () => {
    await s.init();
    await s.save(sampleTask('t1'));
    expect(await s.delete('t1')).toBe(true);
    expect(await s.delete('t1')).toBe(false);
  });
});

const IS_BUN = typeof process !== 'undefined' && process.versions?.bun !== undefined;
const sqliteDescribe = IS_BUN ? describe : describe.skip;

sqliteDescribe('SqliteStorage（bun:sqlite）', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'clawdao-test-'));
    dbPath = join(tmpDir, 'clawdao.db');
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      // 清理临时目录
      try {
        const fs = require('node:fs');
        fs.rmSync(tmpDir, {recursive: true, force: true});
      } catch {}
    }
  });

  it('init 创建库文件 + 表', async () => {
    const s = new SqliteStorage(dbPath);
    await s.init();
    expect(existsSync(dbPath)).toBe(true);
    s.close();
  });

  it('save 后 get 往返一致（含 JSON 字段）', async () => {
    const s = new SqliteStorage(dbPath);
    await s.init();
    await s.save(sampleTask('t1', {
      refImages: ['data:image/png;base64,AAAA'],
      theme: {title: 'SQLite 测试', tags: ['a', 'b']},
      result: {imageUrl: '/outputs/x.jpeg', params: {foo: 'bar'}},
    }));
    const got = await s.get('t1');
    expect(got?.refImages).toEqual(['data:image/png;base64,AAAA']);
    expect((got?.theme as any).title).toBe('SQLite 测试');
    expect(got?.result?.imageUrl).toBe('/outputs/x.jpeg');
    s.close();
  });

  it('持久化到磁盘：关 store 后重开仍能读', async () => {
    const s1 = new SqliteStorage(dbPath);
    await s1.init();
    await s1.save(sampleTask('persist'));
    s1.close();

    const s2 = new SqliteStorage(dbPath);
    await s2.init();
    const got = await s2.get('persist');
    expect(got?.id).toBe('persist');
    s2.close();
  });

  it('upsert 同 id 二次 save 会更新 status/progress', async () => {
    const s = new SqliteStorage(dbPath);
    await s.init();
    await s.save(sampleTask('u1', {status: 'pending', progress: 0}));
    await s.save(sampleTask('u1', {status: 'completed', progress: 1}));
    const got = await s.get('u1');
    expect(got?.status).toBe('completed');
    expect(got?.progress).toBe(1);
    s.close();
  });

  it('list 按 created_at DESC 排序', async () => {
    const s = new SqliteStorage(dbPath);
    await s.init();
    await s.save(sampleTask('a', {createdAt: '2026-01-01T00:00:00Z'}));
    await s.save(sampleTask('b', {createdAt: '2026-01-02T00:00:00Z'}));
    await s.save(sampleTask('c', {createdAt: '2026-01-03T00:00:00Z'}));
    const list = await s.list();
    expect(list.map((t) => t.id)).toEqual(['c', 'b', 'a']);
    s.close();
  });
});

describe('createStorage 工厂', () => {
  afterEach(() => {
    resetStorage();
  });

  it('默认返回 SqliteStorage（或 MemoryStorage if no Bun）', async () => {
    const s = await createStorage();
    expect(s).toBeDefined();
    expect(typeof s.init).toBe('function');
    expect(typeof s.save).toBe('function');
    s.close();
  });

  it('memory: true 强制用 MemoryStorage', async () => {
    resetStorage();
    const s = await createStorage({memory: true});
    expect(s).toBeInstanceOf(MemoryStorage);
  });

  it('env USE_MEMORY_STORE=1 时降级到内存', async () => {
    resetStorage();
    process.env.USE_MEMORY_STORE = '1';
    const s = await createStorage();
    expect(s).toBeInstanceOf(MemoryStorage);
    delete process.env.USE_MEMORY_STORE;
  });
});
