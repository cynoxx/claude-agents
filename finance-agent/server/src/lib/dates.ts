// Les échéances sont des dates "calendrier" (sans heure), stockées à minuit UTC.
// Toute la logique de rappel compare donc des chaînes YYYY-MM-DD.

const DAY_MS = 86_400_000;

/** Date du jour (YYYY-MM-DD) dans le fuseau donné. */
export function todayIn(tz: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Convertit une Date (minuit UTC) ou une chaîne en YYYY-MM-DD. */
export function toDateString(d: Date | string): string {
  return typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
}

/** Convertit YYYY-MM-DD en Date à minuit UTC. */
export function fromDateString(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

/** Nombre de jours calendaires de `from` à `to` (positif si `to` est après). */
export function daysBetween(from: string, to: string): number {
  return Math.round((fromDateString(to).getTime() - fromDateString(from).getTime()) / DAY_MS);
}

export function addDays(date: string, days: number): string {
  return toDateString(new Date(fromDateString(date).getTime() + days * DAY_MS));
}

/** Ajoute des mois en gardant le jour quand c'est possible (31 janv. + 1 mois = 28/29 févr.). */
export function addMonths(date: string, months: number): string {
  const d = fromDateString(date);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return toDateString(target);
}

/** Premier et dernier jour (YYYY-MM-DD) du mois donné (month 1-12). */
export function monthBounds(year: number, month: number): { start: string; end: string } {
  const start = toDateString(new Date(Date.UTC(year, month - 1, 1)));
  const end = toDateString(new Date(Date.UTC(year, month, 0)));
  return { start, end };
}
