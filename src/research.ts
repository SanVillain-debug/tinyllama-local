export interface ResearchPage {
  title: string;
  extract: string;
  lang: 'es' | 'en';
}

const ENDPOINTS: Record<'es' | 'en', string> = {
  en: 'https://en.wikipedia.org/w/api.php',
  es: 'https://es.wikipedia.org/w/api.php',
};

const MAX_CHARS = 1400;
const TIMEOUT_MS = 15000;

interface WikiPage {
  title?: string;
  extract?: string;
}

interface WikiResponse {
  query?: { pages?: Record<string, WikiPage> };
}

function cleanExtract(raw: string): string {
  return raw
    .replace(/\[\d+\]/g, '')
    .replace(/\s*\n+\s*/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
    .slice(0, MAX_CHARS);
}

/** Reads ONE random Wikipedia page (English or Spanish). Returns null on any failure. */
export async function fetchRandomPage(
  signal?: AbortSignal,
): Promise<{ title: string; extract: string; lang: 'es' | 'en' } | null> {
  const lang: 'es' | 'en' = Math.random() < 0.5 ? 'es' : 'en';
  const params = [
    'action=query',
    'format=json',
    'generator=random',
    'grnnamespace=0',
    'grnlimit=1',
    'prop=extracts',
    'exintro=1',
    'explaintext=1',
    `exchars=${MAX_CHARS}`,
    'origin=*',
  ].join('&');
  const url = `${ENDPOINTS[lang]}?${params}`;

  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) return null;
    signal.addEventListener('abort', onAbort);
  }
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const data = (await res.json()) as WikiResponse;
    const pages = data.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    if (!first || !first.title || !first.extract) return null;
    const extract = cleanExtract(first.extract);
    if (extract.length < 40) return null;
    return { title: first.title, extract, lang };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}
