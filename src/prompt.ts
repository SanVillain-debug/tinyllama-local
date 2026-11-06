import type { ChatMessage } from './types';

/* TinyLlama-1.1B-Chat-v1.0 was trained on the Zephyr-style turn format:
   <|system|>\n…</s>\n<|user|>\n…</s>\n<|assistant|>\n
   The prompt ends with the open assistant turn so the model continues from there. */

const SYSTEM_PROMPT =
  'Eres un asistente útil, claro y conciso. Responde siempre en el idioma del usuario.';

/* Conservative estimate for Spanish text on the Llama tokenizer (~3 chars per token). */
const CHARS_PER_TOKEN = 3;
const TURN_OVERHEAD_TOKENS = 6;
const SAFETY_TOKENS = 16;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN) + TURN_OVERHEAD_TOKENS;
}

/* Remove anything that could be read as a control tag so a message cannot break the template. */
function clean(text: string): string {
  return text
    .replace(/<\/?s>/gi, '')
    .replace(/<\|[a-z_]*\|>/gi, '')
    .trim();
}

function turn(role: 'user' | 'assistant', text: string): string {
  return `<|${role}|>\n${text}</s>\n`;
}

/**
 * Builds the prompt from the on-screen conversation. When the context would overflow,
 * the OLDEST messages are left out of the prompt (never removed from the screen).
 * Room is always kept for the answer (maxTokens) and the system message.
 */
export function buildPrompt(messages: ChatMessage[], nCtx: number, maxTokens: number): string {
  const system = turn('system' as 'user', SYSTEM_PROMPT);
  const systemPart = system.replace('<|user|>', '<|system|>');
  const budget = Math.max(
    64,
    nCtx - maxTokens - estimateTokens(SYSTEM_PROMPT) - SAFETY_TOKENS,
  );

  const usable = messages
    .map((m) => ({ role: m.role, text: clean(m.text) }))
    .filter((m) => m.text.length > 0);

  const picked: { role: 'user' | 'assistant'; text: string }[] = [];
  let used = 0;

  for (let i = usable.length - 1; i >= 0; i--) {
    const m = usable[i];
    const cost = estimateTokens(m.text);
    if (used + cost > budget) {
      if (picked.length === 0) {
        /* The newest message alone is too long: keep its tail so the question still fits. */
        const maxChars = Math.max(1, (budget - TURN_OVERHEAD_TOKENS) * CHARS_PER_TOKEN);
        picked.unshift({ role: m.role, text: m.text.slice(-maxChars) });
        used = budget;
      }
      break;
    }
    picked.unshift(m);
    used += cost;
  }

  /* The history must start with a user turn. */
  while (picked.length > 0 && picked[0].role === 'assistant') picked.shift();

  return systemPart + picked.map((m) => turn(m.role, m.text)).join('') + '<|assistant|>\n';
}
