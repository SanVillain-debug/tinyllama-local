/* Numbers in the app's language (Spanish), following the device's Spanish locale when it has one. */
function pickLocale(): string {
  try {
    const device = new Intl.NumberFormat().resolvedOptions().locale;
    if (typeof device === 'string' && device.toLowerCase().startsWith('es')) return device;
  } catch {
    /* Intl not available */
  }
  return 'es-ES';
}

const LOCALE = pickLocale();
const cache = new Map<number, Intl.NumberFormat | null>();

function formatterFor(digits: number): Intl.NumberFormat | null {
  if (cache.has(digits)) return cache.get(digits) ?? null;
  let nf: Intl.NumberFormat | null = null;
  try {
    nf = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  } catch {
    nf = null;
  }
  cache.set(digits, nf);
  return nf;
}

export function formatNumber(n: number, digits = 0): string {
  const nf = formatterFor(digits);
  return nf ? nf.format(n) : n.toFixed(digits);
}
