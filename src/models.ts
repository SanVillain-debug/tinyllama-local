import type { ModelOption, Settings } from './types';

const BASE =
  'https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.';

/* Tamaños en MB (1 MB = 1024 × 1024 bytes) y RAM estimada con contexto 512
   (pesos + caché KV + motor WebAssembly). Todos quedan muy por debajo de 2,8 GB.
   El recomendado para 3 GB va primero. */
export const MODELS: ModelOption[] = [
  {
    id: 'q3_k_s',
    label: 'TinyLlama 1.1B Chat · Q3_K_S',
    fileName: 'tinyllama-1.1b-chat-v1.0.Q3_K_S.gguf',
    url: BASE + 'Q3_K_S.gguf',
    sizeMB: 477,
    ramMB: 650,
    quality: 'media',
    note: 'Cabe con holgura en 3 GB de RAM.',
    badge: 'Recomendado para 3 GB',
  },
  {
    id: 'q2_k',
    label: 'TinyLlama 1.1B Chat · Q2_K',
    fileName: 'tinyllama-1.1b-chat-v1.0.Q2_K.gguf',
    url: BASE + 'Q2_K.gguf',
    sizeMB: 460,
    ramMB: 620,
    quality: 'baja',
    note: 'El más ligero. Respuestas menos precisas.',
  },
  {
    id: 'q4_k_m',
    label: 'TinyLlama 1.1B Chat · Q4_K_M',
    fileName: 'tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf',
    url: BASE + 'Q4_K_M.gguf',
    sizeMB: 638,
    ramMB: 800,
    quality: 'buena',
    note: 'Buena calidad con un tamaño razonable.',
    badge: 'Mejor equilibrio',
  },
  {
    id: 'q5_k_m',
    label: 'TinyLlama 1.1B Chat · Q5_K_M',
    fileName: 'tinyllama-1.1b-chat-v1.0.Q5_K_M.gguf',
    url: BASE + 'Q5_K_M.gguf',
    sizeMB: 747,
    ramMB: 920,
    quality: 'muy buena',
    note: 'Más preciso, pero deja poca RAM libre.',
  },
  {
    id: 'q6_k',
    label: 'TinyLlama 1.1B Chat · Q6_K',
    fileName: 'tinyllama-1.1b-chat-v1.0.Q6_K.gguf',
    url: BASE + 'Q6_K.gguf',
    sizeMB: 862,
    ramMB: 1050,
    quality: 'muy buena',
    note: 'Casi sin pérdida. Puede ir justo en 3 GB.',
  },
];

/** Margen de seguridad de espacio libre, en MB. */
export const SAFETY_MARGIN_MB = 300;

/** Comprueba si el modelo cabe: tamaño + 300 MB de margen frente al espacio libre. */
export function fitFor(m: ModelOption, freeMB: number): { ok: boolean; missingMB: number } {
  const need = m.sizeMB + SAFETY_MARGIN_MB;
  const missing = Math.max(0, Math.ceil(need - freeMB));
  return { ok: missing === 0, missingMB: missing };
}

export const DEFAULT_SETTINGS: Settings = {
  nCtx: 512,
  nThreads: 2,
  maxTokens: 128,
  temperature: 0.7,
  personality: 'curiosa',
  autonomy: true,
};
