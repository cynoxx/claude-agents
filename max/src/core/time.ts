import { DateTime, Interval } from 'luxon';
import type { Instant, LocalDate, LocalTime } from './types';

export const DEFAULT_TZ = 'Europe/Paris';

export type Clock = () => DateTime;
/** Horloge réelle ; les tests injectent une horloge contrôlée. */
export const realClock: Clock = () => DateTime.now();

export function toDT(i: Instant, tz: string = DEFAULT_TZ): DateTime {
  return DateTime.fromISO(i, { setZone: false }).setZone(tz);
}
export function iso(dt: DateTime): Instant {
  return dt.toISO({ suppressMilliseconds: true })!;
}
export function localDate(dt: DateTime): LocalDate {
  return dt.toISODate()!;
}
export function localTime(dt: DateTime): LocalTime {
  return dt.toFormat('HH:mm');
}
export function parseLocalTime(t: LocalTime): { hour: number; minute: number } {
  const [h, m] = t.split(':').map(Number);
  return { hour: h, minute: m || 0 };
}

export interface LocalResolution {
  dt: DateTime;
  /** L'heure tombe dans le trou du passage à l'heure d'été (n'existe pas). */
  gap: boolean;
  /** L'heure existe deux fois (passage à l'heure d'hiver) : deux décalages possibles. */
  ambiguous: boolean;
  alternatives: DateTime[];
}

/** Combine date + heure locales dans un fuseau, en détectant les heures ambiguës ou inexistantes. */
export function resolveLocal(date: LocalDate, time: LocalTime, tz: string): LocalResolution {
  const { hour, minute } = parseLocalTime(time);
  const [y, mo, d] = date.split('-').map(Number);
  const dt = DateTime.fromObject({ year: y, month: mo, day: d, hour, minute }, { zone: tz });
  const gap = dt.hour !== hour || dt.minute !== minute;
  // Ambiguïté : on teste si la même heure locale existe avec un autre décalage une heure plus tard.
  const later = dt.plus({ hours: 1 });
  const earlier = dt.minus({ hours: 1 });
  const alternatives: DateTime[] = [dt];
  let ambiguous = false;
  for (const cand of [later, earlier]) {
    if (cand.hour === hour && cand.minute === minute && cand.offset !== dt.offset) {
      ambiguous = true;
      alternatives.push(cand);
    }
  }
  return { dt, gap, ambiguous, alternatives };
}

export function atLocal(date: LocalDate, time: LocalTime, tz: string): DateTime {
  return resolveLocal(date, time, tz).dt;
}

export function startOfLocalDay(date: LocalDate, tz: string): DateTime {
  return DateTime.fromISO(date, { zone: tz }).startOf('day');
}

export function minutesBetween(a: DateTime, b: DateTime): number {
  return Math.round(b.diff(a, 'minutes').minutes);
}

export function overlaps(aStart: DateTime, aEnd: DateTime, bStart: DateTime, bEnd: DateTime): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export function fmtTime(dt: DateTime): string {
  const m = dt.minute;
  return m === 0 ? `${dt.hour} h` : `${dt.hour} h ${String(m).padStart(2, '0')}`;
}
export function fmtRange(a: DateTime, b: DateTime): string {
  return `${fmtTime(a)}–${fmtTime(b)}`;
}
export function fmtDuration(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
export function fmtDay(date: LocalDate, today: LocalDate): string {
  const d = DateTime.fromISO(date);
  const t = DateTime.fromISO(today);
  const diff = Math.round(d.diff(t, 'days').days);
  if (diff === 0) return "aujourd'hui";
  if (diff === 1) return 'demain';
  if (diff === -1) return 'hier';
  if (diff > 1 && diff < 7) return d.setLocale('fr').toFormat('cccc');
  return d.setLocale('fr').toFormat('cccc d LLL');
}
export function fmtDateLong(date: LocalDate): string {
  return DateTime.fromISO(date).setLocale('fr').toFormat('cccc d LLLL');
}

export function daysBetween(a: LocalDate, b: LocalDate): number {
  return Math.round(DateTime.fromISO(b).diff(DateTime.fromISO(a), 'days').days);
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return DateTime.fromISO(date).plus({ days: n }).toISODate()!;
}

export { DateTime, Interval };
