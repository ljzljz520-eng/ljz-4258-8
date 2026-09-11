import type { LabState } from '../domain/types';
import { SEED_METHOD_ID, seedCylinders, seedMethods } from '../domain/seed';

/**
 * 本机 IndexedDB 持久化。无网络、无服务端：样品/方法版本/测次全部留在实验员本机浏览器。
 */

const DB_NAME = 'mps-physical-lab';
const DB_VERSION = 1;
const STORE = 'kv';
const STATE_KEY = 'lab-state-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前环境不支持 IndexedDB'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function createInitialState(): LabState {
  return {
    samples: [],
    aliquots: [],
    runs: [],
    methods: seedMethods,
    cylinders: seedCylinders,
    exposureSessions: [],
    subSamples: [],
    funnel: {
      lastProductName: null,
      lastSampleRef: null,
      lastUsedAt: null,
      cleanedSinceLastUse: true,
    },
    wizard: {
      step: 'sample',
      kind: 'bulk',
      sampleId: null,
      methodId: SEED_METHOD_ID,
      cylinderId: 'cyl-100',
      draft: null,
      provenance: null,
      uiError: null,
    },
  };
}

export async function loadState(): Promise<LabState> {
  try {
    const db = await openDb();
    const saved = await tx<LabState | undefined>(db, 'readonly', (s) =>
      s.get(STATE_KEY),
    );
    db.close();
    if (saved && Array.isArray(saved.samples) && Array.isArray(saved.methods)) {
      // 合并随版本更新新增的受控方法/量筒（保留已存数据）
      const methodIds = new Set(saved.methods.map((m) => m.id));
      for (const m of seedMethods) if (!methodIds.has(m.id)) saved.methods.push(m);
      const cylIds = new Set(saved.cylinders.map((c) => c.id));
      for (const c of seedCylinders) if (!cylIds.has(c.id)) saved.cylinders.push(c);
      // 兼容旧版本本机数据：补齐高湿暴露分支与漏斗清洁状态字段
      if (!Array.isArray(saved.exposureSessions)) saved.exposureSessions = [];
      if (!Array.isArray(saved.subSamples)) saved.subSamples = [];
      if (!saved.funnel) {
        saved.funnel = {
          lastProductName: null,
          lastSampleRef: null,
          lastUsedAt: null,
          cleanedSinceLastUse: true,
        };
      }
      if (saved.wizard && saved.wizard.provenance === undefined) {
        saved.wizard.provenance = null;
      }
      return saved;
    }
  } catch (e) {
    console.warn('IndexedDB 读取失败，使用初始数据', e);
  }
  return createInitialState();
}

let saveQueue: Promise<void> = Promise.resolve();
export function saveState(state: LabState): Promise<void> {
  // 结构化克隆可直接序列化（无函数/定时器）
  const snapshot = structuredClone(state);
  saveQueue = saveQueue.then(async () => {
    const db = await openDb();
    await tx(db, 'readwrite', (s) => s.put(snapshot, STATE_KEY));
    db.close();
  });
  return saveQueue.catch((e) => {
    console.error('IndexedDB 保存失败', e);
  });
}

export async function clearLocalData(): Promise<void> {
  const db = await openDb();
  await tx(db, 'readwrite', (s) => s.delete(STATE_KEY));
  db.close();
}
