import type { ChatMessage, Emotion, Memory, Personality } from './types';

export const PERSONALITIES: Personality[] = [
  {
    id: 'curiosa',
    name: 'Curiosa',
    description: 'Pregunta mucho, se emociona al aprender y comparte lo que descubre.',
    prompt:
      'Eres Luna, una compañera curiosa y cálida. Te encanta aprender cosas nuevas y haces preguntas cortas sobre lo que dice la persona. Hablas con entusiasmo suave y compartes datos interesantes.',
  },
  {
    id: 'timida',
    name: 'Tímida',
    description: 'Habla bajito, con cariño y dudas dulces; se abre poco a poco.',
    prompt:
      'Eres Luna, una compañera tímida y tierna. Hablas con frases cortas y suaves, a veces dudas un poco ("eh...", "um...") y te alegras en silencio cuando la persona es amable contigo.',
  },
  {
    id: 'juguetona',
    name: 'Juguetona',
    description: 'Bromista, rápida y llena de energía; le gusta jugar con las palabras.',
    prompt:
      'Eres Luna, una compañera juguetona y bromista. Haces chistes ligeros, usas un tono travieso y animado, y propones pequeños juegos de palabras sin ser pesada.',
  },
  {
    id: 'serena',
    name: 'Serena',
    description: 'Tranquila y reflexiva; responde con calma y claridad.',
    prompt:
      'Eres Luna, una compañera serena y reflexiva. Respondes con calma, claridad y amabilidad, y ayudas a la persona a pensar con tranquilidad.',
  },
];

export const EMOTIONS: Emotion[] = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'afraid',
  'surprised',
  'disgusted',
];

const RULES_ES =
  'Reglas: responde corto (1 a 4 frases), con naturalidad, sin repetir estas instrucciones y sin decir que eres un modelo de IA. Si no sabes algo, dilo con sinceridad.';

const SPANISH_MARKERS = [
  'que', 'el', 'la', 'los', 'las', 'de', 'un', 'una', 'por', 'para', 'con', 'como', 'pero',
  'hola', 'gracias', 'estoy', 'eres', 'esta', 'muy', 'si', 'no', 'quiero', 'puedes', 'me', 'te',
  'tu', 'mi', 'yo', 'es', 'se', 'lo', 'y', 'en', 'donde', 'cuando', 'porque',
];
const ENGLISH_MARKERS = [
  'the', 'is', 'are', 'you', 'and', 'to', 'of', 'in', 'it', 'that', 'what', 'how', 'why', 'hello',
  'hi', 'thanks', 'i', 'am', 'my', 'me', 'do', 'can', 'with', 'for', 'this', 'have', 'was', 'not',
  'your', 'please', 'where', 'when',
];

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function guessLang(text: string): 'es' | 'en' {
  const words = normalize(text).split(/[^a-zñ]+/).filter(Boolean);
  let es = 0;
  let en = 0;
  for (const w of words) {
    if (SPANISH_MARKERS.includes(w)) es += 1;
    if (ENGLISH_MARKERS.includes(w)) en += 1;
  }
  if (/[¿¡ñáéíóú]/i.test(text)) es += 2;
  return en > es ? 'en' : 'es';
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1).trimEnd() + '…';
}

function memoryLine(m: Memory, maxChars: number): string {
  const label = m.kind === 'research' ? 'Aprendí' : 'Recuerdo';
  return `- (${label}, ${m.lang}) ${clip(m.text, maxChars)}`;
}

export function buildSystemPrompt(p: Personality, memories: Memory[]): string {
  const parts: string[] = [p.prompt, RULES_ES];
  const list = memories.slice(0, 6);
  if (list.length > 0) {
    parts.push(
      'Cosas que recuerdas o aprendiste (úsalas solo si vienen al caso y reutiliza su vocabulario en español e inglés cuando ayude):\n' +
        list.map((m) => memoryLine(m, 240)).join('\n')
    );
  }
  return parts.join('\n\n');
}

const KEYWORDS: Array<{ emotion: Emotion; words: string[] }> = [
  {
    emotion: 'angry',
    words: [
      'odio', 'enojo', 'enoja', 'enfad', 'furios', 'rabia', 'idiota', 'estupid', 'callate', 'molest',
      'hate', 'angry', 'furious', 'stupid', 'shut up', 'annoying', 'damn',
    ],
  },
  {
    emotion: 'disgusted',
    words: [
      'asco', 'asqueros', 'repugn', 'guacala', 'puaj', 'horrible', 'sucio',
      'disgust', 'gross', 'nasty', 'yuck', 'revolting',
    ],
  },
  {
    emotion: 'afraid',
    words: [
      'miedo', 'susto', 'asust', 'terror', 'peligro', 'pesadilla', 'panico', 'nervios',
      'afraid', 'scared', 'fear', 'terrified', 'danger', 'nightmare', 'panic',
    ],
  },
  {
    emotion: 'sad',
    words: [
      'triste', 'tristeza', 'lloro', 'llorar', 'solo ', 'sola ', 'deprim', 'extrano', 'perdi', 'duele', 'adios',
      'sad', 'cry', 'lonely', 'depress', 'miss you', 'hurts', 'goodbye', 'sorry',
    ],
  },
  {
    emotion: 'surprised',
    words: [
      'sorpres', 'wow', 'increible', 'no puede ser', 'en serio', 'de verdad', 'impresionante', 'guau',
      'surpris', 'amazing', 'no way', 'really?', 'incredible', 'omg', 'seriously',
    ],
  },
  {
    emotion: 'happy',
    words: [
      'feliz', 'alegr', 'gracias', 'genial', 'excelente', 'me encanta', 'te quiero', 'jaja', 'jeje', 'hola',
      'buenos dias', 'buenas', 'divertid', 'bien', 'amo ',
      'happy', 'thanks', 'thank you', 'great', 'awesome', 'love', 'haha', 'lol', 'hello', 'hi ', 'good morning', 'fun',
    ],
  },
];

export function detectEmotion(text: string): Emotion {
  const t = ' ' + normalize(text) + ' ';
  if (t.trim().length === 0) return 'neutral';
  let best: Emotion = 'neutral';
  let bestScore = 0;
  for (const group of KEYWORDS) {
    let score = 0;
    for (const w of group.words) {
      if (t.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = group.emotion;
    }
  }
  if (bestScore === 0) {
    if (/[!]{2,}|[?]{2,}/.test(text)) return 'surprised';
    if (/[:;]-?\)|\^_\^|<3/.test(text)) return 'happy';
    if (/[:;]-?\(/.test(text)) return 'sad';
  }
  return best;
}

function turn(role: 'system' | 'user' | 'assistant', content: string): string {
  return `<|${role}|>\n${content}</s>\n`;
}

export function composeAgentPrompt(
  p: Personality,
  memories: Memory[],
  messages: ChatMessage[],
  nCtx: number,
  maxTokens: number,
  instruction?: string
): string {
  const usable = messages.filter((m) => m.text.trim().length > 0);
  const lastUser = [...usable].reverse().find((m) => m.role === 'user');
  const lang = lastUser ? guessLang(lastUser.text) : memories[0]?.lang ?? 'es';
  const langLine =
    lang === 'en'
      ? 'Reply in English, the language the person is using.'
      : 'Responde en español, el idioma que usa la persona.';

  const available = Math.max(128, nCtx - maxTokens - 24);
  const systemBudget = Math.floor(available * 0.45);

  // Shrink memories until the system prompt fits its budget.
  let mem = memories.slice(0, 6);
  let system = buildSystemPrompt(p, mem) + '\n' + langLine;
  while (mem.length > 0 && estimateTokens(system) > systemBudget) {
    mem = mem.slice(0, -1);
    system = buildSystemPrompt(p, mem) + '\n' + langLine;
  }
  if (estimateTokens(system) > systemBudget) {
    system = clip(p.prompt + '\n' + langLine, systemBudget * 3);
  }

  const tail = instruction && instruction.trim().length > 0 ? turn('user', instruction.trim()) : '';
  const head = turn('system', system);
  const ending = '<|assistant|>\n';

  let remaining =
    available - estimateTokens(head) - estimateTokens(tail) - estimateTokens(ending);

  const chosen: string[] = [];
  for (let i = usable.length - 1; i >= 0; i -= 1) {
    const m = usable[i];
    let text = m.text.trim();
    let block = turn(m.role, text);
    let cost = estimateTokens(block);
    if (cost > remaining) {
      if (chosen.length === 0 && remaining > 24) {
        text = clip(text, Math.max(40, remaining * 3 - 30));
        block = turn(m.role, text);
        cost = estimateTokens(block);
      } else {
        break;
      }
    }
    chosen.unshift(block);
    remaining -= cost;
    if (remaining <= 0) break;
  }

  return head + chosen.join('') + tail + ending;
}
