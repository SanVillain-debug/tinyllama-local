import { useEffect, useMemo, useReducer, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Action,
  AppState,
  AppStore,
  ChatMessage,
  InstalledModel,
  Settings,
} from './types';
import { DEFAULT_SETTINGS } from './models';
import { EMOTIONS, PERSONALITIES } from './personality';

const KEY_INSTALLED = 'tinyllama:installed';
const KEY_SETTINGS = 'tinyllama:settings';
const KEY_MESSAGES = 'tinyllama:messages';
const MAX_STORED_MESSAGES = 200;
const MESSAGE_SAVE_DELAY = 400;

const initialState: AppState = {
  installed: [],
  settings: DEFAULT_SETTINGS,
  messages: [],
  engine: { status: 'idle' },
  hydrated: false,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function sanitizeSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const ctx = r.nCtx === 512 || r.nCtx === 1024 || r.nCtx === 2048 ? r.nCtx : DEFAULT_SETTINGS.nCtx;
  const threadsRaw = typeof r.nThreads === 'number' ? Math.round(r.nThreads) : DEFAULT_SETTINGS.nThreads;
  const threads = clamp(threadsRaw, 1, 4) as Settings['nThreads'];
  const maxTokens =
    typeof r.maxTokens === 'number' && isFinite(r.maxTokens)
      ? clamp(Math.round(r.maxTokens), 16, 1024)
      : DEFAULT_SETTINGS.maxTokens;
  const temperature =
    typeof r.temperature === 'number' && isFinite(r.temperature)
      ? clamp(r.temperature, 0, 1.5)
      : DEFAULT_SETTINGS.temperature;
  const personality =
    typeof r.personality === 'string' && PERSONALITIES.some((p) => p.id === r.personality)
      ? r.personality
      : PERSONALITIES[0]
        ? PERSONALITIES[0].id
        : DEFAULT_SETTINGS.personality;
  const autonomy = typeof r.autonomy === 'boolean' ? r.autonomy : DEFAULT_SETTINGS.autonomy;
  return { nCtx: ctx, nThreads: threads, maxTokens, temperature, personality, autonomy };
}

function sanitizeInstalled(raw: unknown): InstalledModel[] {
  if (!Array.isArray(raw)) return [];
  const out: InstalledModel[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as InstalledModel).id === 'string' &&
      typeof (item as InstalledModel).localPath === 'string' &&
      typeof (item as InstalledModel).sizeMB === 'number'
    ) {
      const m = item as InstalledModel;
      out.push({
        id: m.id,
        localPath: m.localPath,
        sizeMB: m.sizeMB,
        installedAt: typeof m.installedAt === 'number' ? m.installedAt : Date.now(),
      });
    }
  }
  return out;
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as ChatMessage).id === 'string' &&
      typeof (item as ChatMessage).text === 'string' &&
      ((item as ChatMessage).role === 'user' || (item as ChatMessage).role === 'assistant')
    ) {
      const m = item as ChatMessage;
      out.push({
        id: m.id,
        role: m.role,
        text: m.text,
        createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
        emotion: m.emotion && EMOTIONS.includes(m.emotion) ? m.emotion : undefined,
      });
    }
  }
  // An interrupted generation can leave an empty assistant bubble at the end.
  while (out.length > 0 && out[out.length - 1].role === 'assistant' && out[out.length - 1].text === '') {
    out.pop();
  }
  return out;
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'hydrate':
      return {
        ...state,
        installed: action.installed,
        settings: action.settings,
        messages: action.messages,
        // Android may have killed the app: the engine always starts unloaded.
        engine: { status: 'idle' },
        hydrated: true,
      };
    case 'addInstalled':
      return {
        ...state,
        installed: [...state.installed.filter((m) => m.id !== action.model.id), action.model],
      };
    case 'removeInstalled':
      return { ...state, installed: state.installed.filter((m) => m.id !== action.id) };
    case 'setSettings':
      return { ...state, settings: sanitizeSettings(action.settings) };
    case 'addMessage':
      return { ...state, messages: [...state.messages, action.message] };
    case 'appendToLast': {
      if (state.messages.length === 0) return state;
      const last = state.messages[state.messages.length - 1];
      if (last.role !== 'assistant') return state;
      const messages = state.messages.slice(0, -1);
      messages.push({ ...last, text: last.text + action.text });
      return { ...state, messages };
    }
    case 'clearMessages':
      return { ...state, messages: [] };
    case 'setEngine':
      return { ...state, engine: action.engine };
    default:
      return state;
  }
}

async function readJson(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function useAppStore(): AppStore {
  const [state, dispatch] = useReducer(reducer, initialState);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load everything once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [installed, settings, messages] = await Promise.all([
        readJson(KEY_INSTALLED),
        readJson(KEY_SETTINGS),
        readJson(KEY_MESSAGES),
      ]);
      if (cancelled) return;
      dispatch({
        type: 'hydrate',
        installed: sanitizeInstalled(installed),
        settings: sanitizeSettings(settings),
        messages: sanitizeMessages(messages),
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist installed models and settings right away (small, rare writes).
  useEffect(() => {
    if (!state.hydrated) return;
    AsyncStorage.setItem(KEY_INSTALLED, JSON.stringify(state.installed)).catch(() => undefined);
  }, [state.installed, state.hydrated]);

  useEffect(() => {
    if (!state.hydrated) return;
    AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(state.settings)).catch(() => undefined);
  }, [state.settings, state.hydrated]);

  // Conversation changes on every streamed token: debounce the writes.
  useEffect(() => {
    if (!state.hydrated) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const messages = state.messages;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      AsyncStorage.setItem(KEY_MESSAGES, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))).catch(
        () => undefined,
      );
    }, MESSAGE_SAVE_DELAY);
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        // Flush the pending write so nothing is lost when the effect re-runs or unmounts.
        AsyncStorage.setItem(KEY_MESSAGES, JSON.stringify(messages.slice(-MAX_STORED_MESSAGES))).catch(
          () => undefined,
        );
      }
    };
  }, [state.messages, state.hydrated]);

  return useMemo(() => ({ state, dispatch }), [state]);
}
