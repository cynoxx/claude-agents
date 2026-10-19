const eurFormatter = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export const eur = (n: number) => eurFormatter.format(n);

/** "2026-10-19" → "19 oct. 2026" */
export function formatDate(d: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }) {
  return new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString('fr-FR', { ...opts, timeZone: 'UTC' });
}

/** "2026-10" → "oct. 2026" */
export function formatMonth(ym: string, long = false) {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString('fr-FR', { month: long ? 'long' : 'short', year: 'numeric', timeZone: 'UTC' });
}
