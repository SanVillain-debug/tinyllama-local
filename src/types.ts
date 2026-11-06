import type { StyleProp, ViewStyle } from 'react-native';

export type Tab = 'chat' | 'models' | 'settings';

export type Emotion = 'neutral' | 'happy' | 'sad' | 'angry' | 'afraid' | 'surprised' | 'disgusted';

export type AgentStatus = 'idle' | 'thinking' | 'talking' | 'bored' | 'searching' | 'reading' | 'learning';

export interface Personality {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

export interface Memory {
  id: string;
  kind: 'chat' | 'research';
  text: string;
  lang: 'es' | 'en';
  createdAt: number;
  bytes: number;
  tier: 'default' | 'old';
}

export interface ModelOption {
  id: string;
  label: string;
  fileName: string;
  url: string;
  sizeMB: number;
  ramMB: number;
  quality: 'baja' | 'media' | 'buena' | 'muy buena';
  note?: string;
  badge?: 'Recomendado para 3 GB' | 'Mejor equilibrio';
}

export interface InstalledModel {
  id: string;
  localPath: string;
  sizeMB: number;
  installedAt: number;
}

export interface DownloadState {
  modelId: string;
  status: 'idle' | 'downloading' | 'error' | 'done';
  progress: number;
  receivedMB: number;
  error?: string;
}

export interface DownloadHandle {
  cancel(): Promise<void>;
  done: Promise<InstalledModel | null>;
}

export interface Settings {
  nCtx: 512 | 1024 | 2048;
  nThreads: 1 | 2 | 3 | 4;
  maxTokens: number;
  temperature: number;
  personality: string;
  autonomy: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  emotion?: Emotion;
}

export interface EngineState {
  status: 'idle' | 'loading' | 'ready' | 'generating' | 'error';
  modelId?: string;
  error?: string;
}

export type ToEngine =
  | { type: 'load'; modelUrl: string; nCtx: number; nThreads: number }
  | { type: 'generate'; prompt: string; maxTokens: number; temperature: number }
  | { type: 'stop' }
  | { type: 'unload' };

export type FromEngine =
  | { type: 'ready' }
  | { type: 'loadProgress'; progress: number }
  | { type: 'loaded' }
  | { type: 'token'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface EngineApi {
  load(modelUrl: string, s: Settings): void;
  generate(prompt: string, s: Settings): void;
  stop(): void;
  unload(): void;
}

export interface EngineHostProps {
  onEvent: (e: FromEngine) => void;
}

export interface AppState {
  installed: InstalledModel[];
  settings: Settings;
  messages: ChatMessage[];
  engine: EngineState;
  hydrated: boolean;
}

export type Action =
  | { type: 'hydrate'; installed: InstalledModel[]; settings: Settings; messages: ChatMessage[] }
  | { type: 'addInstalled'; model: InstalledModel }
  | { type: 'removeInstalled'; id: string }
  | { type: 'setSettings'; settings: Settings }
  | { type: 'addMessage'; message: ChatMessage }
  | { type: 'appendToLast'; text: string }
  | { type: 'clearMessages' }
  | { type: 'setEngine'; engine: EngineState };

export interface AppStore {
  state: AppState;
  dispatch: (a: Action) => void;
}

export interface ChatScreenProps {
  state: AppState;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  goToModels: () => void;
  onRetry: () => void;
  agentStatus: AgentStatus;
  emotion: Emotion;
}

export interface ModelsScreenProps {
  state: AppState;
  models: ModelOption[];
  onInstalled: (m: InstalledModel) => void;
  onDelete: (id: string) => void;
  onLoad: (id: string) => void;
  engineProgress?: number;
}

export interface SettingsScreenProps {
  settings: Settings;
  onChange: (s: Settings) => void;
  onClearHistory: () => void;
  memories: Memory[];
  onClearOldMemories: () => void;
}

export interface CardStyleProps { style?: StyleProp<ViewStyle> }
