import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import Storage from 'expo-sqlite/kv-store';
import { getFreeMB } from './downloader';
import { SAFETY_MARGIN_MB } from './models';
import type { Memory } from './types';

export const DEFAULT_LIMIT_MB = 100;
export const PRUNE_CHUNK_MB = 200;

const MB = 1024 * 1024;
const FILE_NAME = 'companion-memories.json';
const STORAGE_KEY = 'companion:memories';
const MAX_TEXT = 4000;
// The newest old memories are never pruned.
const RECENT_KEEP = 30;
const ENTRY_OVERHEAD = 64;

let cache: Memory[] | null = null;
let queue: Promise<unknown> = Promise.resolve();

function serial<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.catch(() => undefined);
  return run;
}

function utf8Size(text: string): number {
  try {
    return encodeURIComponent(text).replace(/%[0-9A-F]{2}/gi, 'x').length;
  } catch {
    return text.length * 2;
  }
}

function isMemory(x: unknown): x is Memory {
  if (!x || typeof x !== 'object') return false;
  const m = x as Record<string, unknown>;
  return (
    typeof m.id === 'string' &&
    (m.kind === 'chat' || m.kind === 'research') &&
    typeof m.text === 'string' &&
    (m.lang === 'es' || m.lang === 'en') &&
    typeof m.createdAt === 'number' &&
    typeof m.bytes === 'number' &&
    (m.tier === 'default' || m.tier === 'old')
  );
}

function parse(raw: string | null): Memory[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data.filter(isMemory).sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

function memFile(): File | null {
  if (Platform.OS === 'web') return null;
  try {
    return new File(Paths.document, FILE_NAME);
  } catch {
    return null;
  }
}

async function readRaw(): Promise<string | null> {
  const f = memFile();
  if (f) {
    try {
      if (f.exists) return await f.text();
      return null;
    } catch {
      // fall through to the key-value store
    }
  }
  try {
    return await Storage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

async function writeRaw(raw: string): Promise<void> {
  const f = memFile();
  if (f) {
    try {
      if (!f.exists) f.create();
      f.write(raw);
      return;
    } catch {
      // fall through to the key-value store
    }
  }
  try {
    await Storage.setItem(STORAGE_KEY, raw);
  } catch {
    // storage full or unavailable: keep the in-memory copy
  }
}

async function ensureLoaded(): Promise<Memory[]> {
  if (cache) return cache;
  cache = parse(await readRaw());
  return cache;
}

async function persist(list: Memory[]): Promise<void> {
  cache = list;
  await writeRaw(JSON.stringify(list));
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function loadMemories(): Promise<Memory[]> {
  return serial(async () => (await ensureLoaded()).slice());
}

export async function addMemory(kind: Memory['kind'], text: string, lang: 'es' | 'en'): Promise<Memory[]> {
  return serial(async () => {
    const list = await ensureLoaded();
    const clean = text.trim().slice(0, MAX_TEXT);
    if (!clean) return list.slice();
    const bytes = utf8Size(clean) + ENTRY_OVERHEAD;
    const defaultBytes = list.reduce((s, m) => (m.tier === 'default' ? s + m.bytes : s), 0);
    const tier: Memory['tier'] = defaultBytes + bytes <= DEFAULT_LIMIT_MB * MB ? 'default' : 'old';
    const entry: Memory = { id: newId(), kind, text: clean, lang, createdAt: Date.now(), bytes, tier };
    const next = [...list, entry];
    await persist(next);
    return next.slice();
  });
}

async function lowOnSpace(): Promise<boolean> {
  try {
    const free: unknown = await getFreeMB();
    if (typeof free !== 'number' || !isFinite(free)) return false;
    return free < SAFETY_MARGIN_MB;
  } catch {
    return false;
  }
}

/** If the phone is short on space, delete the oldest 'old' memories in 200 MB blocks (never default, never the most recent). */
export async function pruneIfNeeded(): Promise<Memory[]> {
  const low = await lowOnSpace();
  return serial(async () => {
    let list = (await ensureLoaded()).slice();
    if (!low) return list;
    const olds = list.filter((m) => m.tier === 'old').sort((a, b) => a.createdAt - b.createdAt);
    const prunable = olds.slice(0, Math.max(0, olds.length - RECENT_KEEP));
    if (prunable.length === 0) return list;
    const target = PRUNE_CHUNK_MB * MB;
    let freed = 0;
    const removeIds = new Set<string>();
    for (const m of prunable) {
      if (freed >= target) break;
      removeIds.add(m.id);
      freed += m.bytes;
    }
    list = list.filter((m) => !removeIds.has(m.id));
    await persist(list);
    return list;
  });
}

/** Deletes every 'old' memory; default memories stay. */
export async function clearOldMemories(): Promise<Memory[]> {
  return serial(async () => {
    const list = (await ensureLoaded()).filter((m) => m.tier === 'default');
    await persist(list);
    return list.slice();
  });
}

export function memoryStats(m: Memory[]): { defaultMB: number; oldMB: number } {
  let d = 0;
  let o = 0;
  for (const x of m) {
    if (x.tier === 'default') d += x.bytes;
    else o += x.bytes;
  }
  return { defaultMB: d / MB, oldMB: o / MB };
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length > 2);
}

export function pickRelevant(m: Memory[], query: string, n: number): Memory[] {
  if (n <= 0 || m.length === 0) return [];
  const q = new Set(tokens(query));
  const now = Date.now();
  const scored = m.map((mem, idx) => {
    let overlap = 0;
    if (q.size > 0) {
      const seen = new Set(tokens(mem.text));
      q.forEach((w) => {
        if (seen.has(w)) overlap += 1;
      });
    }
    const ageDays = Math.max(0, (now - mem.createdAt) / 86400000);
    const recency = 1 / (1 + ageDays);
    const score = overlap * 3 + recency + (mem.tier === 'default' ? 0.2 : 0) + idx / (m.length * 1000);
    return { mem, score, overlap };
  });
  const matched = scored.filter((s) => s.overlap > 0).sort((a, b) => b.score - a.score);
  const rest = scored.filter((s) => s.overlap === 0).sort((a, b) => b.score - a.score);
  const picked = [...matched, ...rest].slice(0, n).map((s) => s.mem);
  return picked.sort((a, b) => a.createdAt - b.createdAt);
}
