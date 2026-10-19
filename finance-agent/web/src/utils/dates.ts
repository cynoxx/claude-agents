const DAY_MS = 86_400_000;

/** Date locale du jour au format YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Grille du calendrier : semaines complètes (lundi → dimanche) couvrant le mois. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lundi = 0
  const start = addDays(first.toISOString().slice(0, 10), -offset);
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const weeks: string[][] = [];
  let cursor = start;
  while (cursor <= lastDay) {
    const week = Array.from({ length: 7 }, (_, i) => addDays(cursor, i));
    weeks.push(week);
    cursor = addDays(cursor, 7);
  }
  return weeks;
}
