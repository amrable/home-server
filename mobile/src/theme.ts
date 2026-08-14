export const colors = {
  bgApp: '#FAFAFA',
  bgSurface: '#FFFFFF',
  borderSubtle: '#E5E5E5',
  bgIcon: '#F4F4F5',
  icon: '#52525B',
  scrim: 'rgba(10, 10, 10, 0.4)',
  textMain: '#0A0A0A',
  textMuted: '#737373',
  income: '#0D9488',
  expense: '#E11D48',
};

export const type = {
  balance: { fontSize: 30, fontWeight: '600' as const, letterSpacing: -0.6 },
  section: { fontSize: 14, fontWeight: '500' as const, letterSpacing: 0.7 },
  rowTitle: { fontSize: 15, fontWeight: '400' as const },
  rowAmount: { fontSize: 16, fontWeight: '500' as const },
  meta: { fontSize: 12, fontWeight: '400' as const },
};

export const tabular = { fontVariant: ['tabular-nums' as const] };

export const CURRENCY_SYMBOL: Record<string, string> = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CHF: 'CHF ',
  PLN: 'zł',
  CZK: 'Kč',
};

export function money(v: number | null | undefined, cur?: string | null): string {
  if (v == null || isNaN(v)) return '—';
  const sym = CURRENCY_SYMBOL[cur || ''] || (cur ? `${cur} ` : '€');
  const fixed = Math.round(v * 100) / 100;
  const [int, dec] = fixed.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sym}${grouped}.${dec}`;
}