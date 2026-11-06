import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState, BackHandler, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import type {
  AppState,
  ChatMessage,
  EngineApi,
  FromEngine,
  InstalledModel,
  Settings,
  Tab,
} from './src/types';
import { makeStyles, useColors } from './src/theme';
import { useAppStore } from './src/store';
import { EngineHost } from './src/components/EngineHost';
import ChatScreen from './src/screens/ChatScreen';
import ModelsScreen from './src/screens/ModelsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { MODELS } from './src/models';
import type { AgentStatus, Emotion, Memory } from './src/types';
import { PERSONALITIES, composeAgentPrompt, detectEmotion } from './src/personality';
import { addMemory, clearOldMemories, loadMemories, pickRelevant, pruneIfNeeded } from './src/memory';
import { fetchRandomPage } from './src/research';
import { useAutonomy } from './src/autonomy';

type ResearchPhase = 'searching' | 'reading' | 'learning';
type GenKind = 'user' | 'bored';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function detectLang(text: string): 'es' | 'en' {
  return /[áéíóúñ¿¡]|\b(el|la|los|las|de|que|y|en|un|una|por|con|para|hola|es|muy|pero)\b/i.test(text)
    ? 'es'
    : 'en';
}

function summarize(extract: string): string {
  const clean = extract.replace(/\s+/g, ' ').trim();
  if (clean.length <= 600) return clean;
  const cut = clean.slice(0, 600);
  const dot = cut.lastIndexOf('. ');
  return dot > 200 ? cut.slice(0, dot + 1) : cut;
}

type IconName = React.ComponentProps<typeof Feather>['name'];

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: 'chat', label: 'Chat', icon: 'message-circle' },
  { key: 'models', label: 'Modelos', icon: 'cpu' },
  { key: 'settings', label: 'Ajustes', icon: 'sliders' },
];

const ENGINE_READY_TIMEOUT_MS = 60000;
const TOAST_MS = 3500;
const KEEP_AWAKE_TAG = 'tinyllama-busy';

const SYSTEM_PROMPT =
  '<|system|>\nEres un asistente útil y breve. Responde en el mismo idioma que el usuario.</s>\n';

function estimateTokens(s: string): number {
  return Math.ceil(s.length / 3) + 4;
}

/* TinyLlama-Chat template; the oldest messages are dropped so the prompt fits the context
   (the messages on screen are never touched). */
function composePrompt(messages: ChatMessage[], nCtx: number, maxTokens: number): string {
  const reserve = Math.min(maxTokens, Math.floor(nCtx / 2));
  const budget = Math.max(64, nCtx - reserve - estimateTokens(SYSTEM_PROMPT) - 8);
  const usable = messages.filter((m) => m.text.trim().length > 0);
  const chunks: { role: ChatMessage['role']; text: string }[] = [];
  let used = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    let text = m.text.trim();
    let cost = estimateTokens(text) + 6;
    if (chunks.length === 0 && cost > budget) {
      text = text.slice(-Math.max(16, (budget - 10) * 3));
      cost = estimateTokens(text) + 6;
    }
    if (chunks.length > 0 && used + cost > budget) break;
    chunks.unshift({ role: m.role, text });
    used += cost;
  }
  while (chunks.length > 1 && chunks[0].role !== 'user') chunks.shift();
  let out = SYSTEM_PROMPT;
  for (const c of chunks) {
    out += (c.role === 'user' ? '<|user|>\n' : '<|assistant|>\n') + c.text + '</s>\n';
  }
  return out + '<|assistant|>\n';
}

function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

interface PendingLoad {
  url: string;
  settings: Settings;
}

export default function App(): JSX.Element {
  return (
    <SafeAreaProvider>
      <Root />
    </SafeAreaProvider>
  );
}

function Root(): JSX.Element {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { state, dispatch } = useAppStore();
  const [tab, setTab] = useState<Tab>('chat');
  const [engineMounted, setEngineMounted] = useState(false);
  const [engineProgress, setEngineProgress] = useState<number | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [emotion, setEmotion] = useState<Emotion>('neutral');
  const [phase, setPhase] = useState<ResearchPhase | null>(null);
  const [activityAt, setActivityAt] = useState<number>(() => Date.now());
  const memoriesRef = useRef<Memory[]>([]);
  memoriesRef.current = memories;
  const researchRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const genKindRef = useRef<GenKind | null>(null);

  const saveMemory = useCallback(
    async (kind: Memory['kind'], text: string, lang?: 'es' | 'en') => {
      const t = text.trim();
      if (!t) return;
      try {
        await addMemory(kind, t, lang ?? detectLang(t));
        setMemories(await pruneIfNeeded());
      } catch {
        /* memory is best effort */
      }
    },
    [],
  );

  const finishReply = useCallback(
    (messages: ChatMessage[]) => {
      const last = messages[messages.length - 1];
      genKindRef.current = null;
      setActivityAt(Date.now());
      if (last && last.role === 'assistant' && last.text.trim()) {
        setEmotion(detectEmotion(last.text));
        saveMemory('chat', last.text);
      }
    },
    [saveMemory],
  );

  const engineRef = useRef<EngineApi>(null);
  const engineReadyRef = useRef(false);
  const pendingLoadRef = useRef<PendingLoad | null>(null);
  const readyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef<AppState>(state);
  stateRef.current = state;
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (readyTimerRef.current) clearTimeout(readyTimerRef.current);
    },
    [],
  );

  /* Screen stays on while loading or generating. */
  const busy = state.engine.status === 'generating' || state.engine.status === 'loading';
  useEffect(() => {
    if (!busy) return;
    try {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    } catch {
      /* not available here */
    }
    return () => {
      try {
        deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      } catch {
        /* not available here */
      }
    };
  }, [busy]);

  const clearReadyTimer = useCallback(() => {
    if (readyTimerRef.current) {
      clearTimeout(readyTimerRef.current);
      readyTimerRef.current = null;
    }
  }, []);

  const flushPendingLoad = useCallback(() => {
    const p = pendingLoadRef.current;
    if (!p || !engineRef.current) return;
    pendingLoadRef.current = null;
    engineRef.current.load(p.url, p.settings);
  }, []);

  const onEngineEvent = useCallback(
    (e: FromEngine) => {
      const s = stateRef.current;
      switch (e.type) {
        case 'ready':
          engineReadyRef.current = true;
          clearReadyTimer();
          if (pendingLoadRef.current) {
            flushPendingLoad();
          } else if (s.engine.status === 'ready' || s.engine.status === 'generating') {
            // The engine page restarted: whatever was loaded is gone.
            dispatch({ type: 'setEngine', engine: { status: 'idle' } });
          }
          break;
        case 'loadProgress':
          setEngineProgress(Math.min(1, Math.max(0, e.progress)));
          break;
        case 'loaded':
          setEngineProgress(undefined);
          dispatch({ type: 'setEngine', engine: { status: 'ready', modelId: s.engine.modelId } });
          showToast('Modelo cargado. Ya puedes chatear.');
          break;
        case 'token':
          if (s.engine.status === 'generating') dispatch({ type: 'appendToLast', text: e.text });
          break;
        case 'done':
          if (s.engine.status === 'generating') finishReply(s.messages);
          if (s.engine.status === 'generating') {
            dispatch({ type: 'setEngine', engine: { status: 'ready', modelId: s.engine.modelId } });
          }
          break;
        case 'error': {
          setEngineProgress(undefined);
          clearReadyTimer();
          if (s.engine.status === 'generating') {
            const last = s.messages[s.messages.length - 1];
            if (last && last.role === 'assistant' && last.text === '') {
              dispatch({ type: 'appendToLast', text: '(La respuesta se interrumpió.)' });
            }
            dispatch({ type: 'setEngine', engine: { status: 'ready', modelId: s.engine.modelId } });
            showToast('Error al generar: ' + e.message);
          } else {
            dispatch({
              type: 'setEngine',
              engine: { status: 'error', modelId: s.engine.modelId, error: e.message },
            });
          }
          break;
        }
        default:
          break;
      }
    },
    [clearReadyTimer, dispatch, finishReply, flushPendingLoad, showToast],
  );

  const handleLoad = useCallback(
    (id: string) => {
      const s = stateRef.current;
      const model = s.installed.find((m) => m.id === id);
      if (!model) return;
      if (s.engine.status === 'loading') return;
      const wasLoaded = s.engine.status === 'ready' || s.engine.status === 'generating';
      if (wasLoaded && engineReadyRef.current) {
        engineRef.current?.stop();
        engineRef.current?.unload();
      }
      setEngineProgress(0);
      dispatch({ type: 'setEngine', engine: { status: 'loading', modelId: id } });
      pendingLoadRef.current = { url: model.localPath, settings: s.settings };
      if (!engineMounted) {
        setEngineMounted(true);
      }
      if (engineReadyRef.current) {
        flushPendingLoad();
      } else {
        clearReadyTimer();
        readyTimerRef.current = setTimeout(() => {
          readyTimerRef.current = null;
          if (!engineReadyRef.current) {
            pendingLoadRef.current = null;
            setEngineProgress(undefined);
            dispatch({
              type: 'setEngine',
              engine: {
                status: 'error',
                modelId: id,
                error: 'No se pudo iniciar el motor. Revisa tu conexión e inténtalo de nuevo.',
              },
            });
          }
        }, ENGINE_READY_TIMEOUT_MS);
      }
    },
    [clearReadyTimer, dispatch, engineMounted, flushPendingLoad],
  );

  const handleRetry = useCallback(() => {
    const s = stateRef.current;
    const id = s.engine.modelId;
    if (id && s.installed.some((m) => m.id === id)) {
      handleLoad(id);
    } else {
      setTab('models');
    }
  }, [handleLoad]);

  const handleStop = useCallback(() => {
    const s = stateRef.current;
    if (s.engine.status !== 'generating') return;
    try {
      engineRef.current?.stop();
    } catch {
      /* engine already gone */
    }
    dispatch({ type: 'setEngine', engine: { status: 'ready', modelId: s.engine.modelId } });
  }, [dispatch]);

  const handleSend = useCallback(
    (text: string) => {
      const clean = text.trim();
      const s = stateRef.current;
      if (!clean || s.engine.status !== 'ready' || !engineRef.current || researchRef.current) return;
      const now = Date.now();
      const userMsg: ChatMessage = { id: newId(), role: 'user', text: clean, createdAt: now };
      const botMsg: ChatMessage = { id: newId(), role: 'assistant', text: '', createdAt: now + 1 };
      const persona = PERSONALITIES.find((p) => p.id === s.settings.personality) ?? PERSONALITIES[0];
      const prompt = composeAgentPrompt(
        persona,
        pickRelevant(memoriesRef.current, clean, 6),
        [...s.messages, userMsg],
        s.settings.nCtx,
        s.settings.maxTokens,
      );
      genKindRef.current = 'user';
      setEmotion(detectEmotion(clean));
      setActivityAt(now);
      saveMemory('chat', clean);
      dispatch({ type: 'addMessage', message: userMsg });
      dispatch({ type: 'addMessage', message: botMsg });
      dispatch({ type: 'setEngine', engine: { status: 'generating', modelId: s.engine.modelId } });
      engineRef.current.generate(prompt, s.settings);
    },
    [dispatch],
  );

  const handleClearHistory = useCallback(() => {
    handleStop();
    dispatch({ type: 'clearMessages' });
    showToast('Conversación vaciada.');
  }, [dispatch, handleStop, showToast]);

  const handleInstalled = useCallback(
    (m: InstalledModel) => {
      dispatch({ type: 'addInstalled', model: m });
      const label = MODELS.find((x) => x.id === m.id)?.label ?? 'Modelo';
      showToast(label + ' instalado.');
    },
    [dispatch, showToast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const s = stateRef.current;
      if (s.engine.modelId === id && s.engine.status !== 'idle') {
        try {
          engineRef.current?.stop();
          engineRef.current?.unload();
        } catch {
          /* engine already gone */
        }
        pendingLoadRef.current = null;
        clearReadyTimer();
        setEngineProgress(undefined);
        dispatch({ type: 'setEngine', engine: { status: 'idle' } });
      }
      dispatch({ type: 'removeInstalled', id });
      showToast('Modelo borrado. Espacio recuperado.');
    },
    [clearReadyTimer, dispatch, showToast],
  );

  const handleSettings = useCallback(
    (next: Settings) => {
      dispatch({ type: 'setSettings', settings: next });
    },
    [dispatch],
  );

  /* Background or Back during generation: stop cleanly. */
  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (next) => {
      if (next !== 'active') handleStop();
    });
    return () => sub.remove();
  }, [handleStop]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stateRef.current.engine.status === 'generating') {
        handleStop();
        return true;
      }
      if (tabRef.current !== 'chat') {
        setTab('chat');
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [handleStop]);

  useEffect(() => {
    loadMemories()
      .then((m) => setMemories(m))
      .catch(() => undefined);
    return () => abortRef.current?.abort();
  }, []);

  const runBored = useCallback(() => {
    const s = stateRef.current;
    if (s.engine.status !== 'ready' || researchRef.current || !engineRef.current) return;
    const now = Date.now();
    const botMsg: ChatMessage = { id: newId(), role: 'assistant', text: '', createdAt: now };
    const persona = PERSONALITIES.find((p) => p.id === s.settings.personality) ?? PERSONALITIES[0];
    const lastText = s.messages.length ? s.messages[s.messages.length - 1].text : '';
    const prompt = composeAgentPrompt(
      persona,
      pickRelevant(memoriesRef.current, lastText, 6),
      s.messages,
      s.settings.nCtx,
      s.settings.maxTokens,
      'Te aburres: escribe tú, sin que el usuario haya dicho nada, un mensaje corto que inicie o continúe la conversación.',
    );
    genKindRef.current = 'bored';
    setEmotion('neutral');
    dispatch({ type: 'addMessage', message: botMsg });
    dispatch({ type: 'setEngine', engine: { status: 'generating', modelId: s.engine.modelId } });
    engineRef.current.generate(prompt, s.settings);
  }, [dispatch]);

  const runCurious = useCallback(async () => {
    const s = stateRef.current;
    if (s.engine.status !== 'ready' || researchRef.current) return;
    researchRef.current = true;
    setPhase('searching');
    setEmotion('surprised');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const page = await fetchRandomPage(ctrl.signal);
      if (page && !ctrl.signal.aborted) {
        setPhase('reading');
        await sleep(1200);
        setPhase('learning');
        await saveMemory('research', page.title + ': ' + summarize(page.extract), page.lang);
        await sleep(1200);
        setEmotion('happy');
      } else {
        setEmotion('neutral');
      }
    } catch {
      setEmotion('neutral');
    } finally {
      researchRef.current = false;
      abortRef.current = null;
      setPhase(null);
      setActivityAt(Date.now());
    }
  }, [saveMemory]);

  const runLongAbsence = useCallback(() => {
    if (researchRef.current || stateRef.current.engine.status === 'generating') return;
    const options: Emotion[] = ['sad', 'surprised', 'afraid'];
    setEmotion(options[Math.floor(Math.random() * options.length)]);
  }, []);

  const engineActive = state.engine.status === 'ready' || state.engine.status === 'generating';
  useAutonomy({
    enabled: state.settings.autonomy && state.hydrated && engineActive,
    engineStatus: phase ? 'generating' : state.engine.status,
    lastActivityAt: activityAt,
    onBored: runBored,
    onCurious: runCurious,
    onLongAbsence: runLongAbsence,
  });

  const handleClearOld = useCallback(async () => {
    try {
      setMemories(await clearOldMemories());
      showToast('Memorias viejas borradas. Las de base se conservan.');
    } catch {
      showToast('No se pudieron borrar las memorias.');
    }
  }, [showToast]);

  const lastMsg = state.messages[state.messages.length - 1];
  let agentStatus: AgentStatus = 'idle';
  if (phase) {
    agentStatus = phase;
  } else if (state.engine.status === 'loading') {
    agentStatus = 'thinking';
  } else if (state.engine.status === 'generating') {
    const empty = !lastMsg || lastMsg.text === '';
    agentStatus = empty ? (genKindRef.current === 'bored' ? 'bored' : 'thinking') : 'talking';
  }

  const goToModels = useCallback(() => setTab('models'), []);

  if (!state.hydrated) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
        <StatusBar style="auto" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top', 'bottom']}>
      <StatusBar style="auto" />
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flex: 1, display: tab === 'chat' ? 'flex' : 'none' }}>
          <ChatScreen
            state={state}
            onSend={handleSend}
            onStop={handleStop}
            onNewChat={handleClearHistory}
            goToModels={goToModels}
            onRetry={handleRetry}
            agentStatus={agentStatus}
            emotion={emotion}
          />
        </View>
        <View style={{ flex: 1, display: tab === 'models' ? 'flex' : 'none' }}>
          <ModelsScreen
            state={state}
            models={MODELS}
            onInstalled={handleInstalled}
            onDelete={handleDelete}
            onLoad={handleLoad}
            engineProgress={engineProgress}
          />
        </View>
        <View style={{ flex: 1, display: tab === 'settings' ? 'flex' : 'none' }}>
          <SettingsScreen
            settings={state.settings}
            onChange={handleSettings}
            onClearHistory={handleClearHistory}
            memories={memories}
            onClearOldMemories={handleClearOld}
          />
        </View>

        {toast ? (
          <View
            style={styles.toast}
            pointerEvents="none"
            accessibilityLiveRegion="polite"
            accessibilityRole="alert"
          >
            <Text style={styles.toastText}>{toast}</Text>
          </View>
        ) : null}

        {engineMounted ? (
          <View
            pointerEvents="none"
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden' }}
          >
            <EngineHost ref={engineRef} onEvent={onEngineEvent} />
          </View>
        ) : null}
      </View>

      <View style={styles.tabBar} accessibilityRole="tablist">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable
              key={t.key}
              accessibilityRole="tab"
              accessibilityLabel={t.label}
              accessibilityState={{ selected: active }}
              onPress={() => setTab(t.key)}
              style={({ pressed }) => [
                styles.tabItem,
                active && styles.tabItemActive,
                pressed && styles.btnPressed,
              ]}
            >
              <Feather name={t.icon} size={22} color={active ? colors.accentStrong : colors.inkMuted} />
              <Text style={active ? styles.tabLabelActive : styles.tabLabel}>{t.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
