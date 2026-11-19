import { DateTime } from 'luxon';
import type { Block, LocalDate, Recurrence } from './types';
import { atLocal, iso } from './time';

/** Identifiant stable d'une occurrence : rec:<idRécurrence>:<date d'origine>. */
export function occurrenceId(recId: string, date: LocalDate): string {
  return `rec:${recId}:${date}`;
}
export function parseOccurrenceId(id: string): { recId: string; date: LocalDate } | null {
  const m = /^rec:(.+):(\d{4}-\d{2}-\d{2})$/.exec(id);
  return m ? { recId: m[1], date: m[2] } : null;
}

/**
 * Développe une récurrence en blocs entre deux dates locales incluses.
 * Les heures locales sont conservées à travers les changements d'heure (le cours de 8 h reste à 8 h).
 */
export function expandRecurrence(rec: Recurrence, from: LocalDate, to: LocalDate): Block[] {
  if (rec.deletedAt) return [];
  const out: Block[] = [];
  let d = DateTime.fromISO(from < rec.from ? rec.from : from);
  const end = DateTime.fromISO(rec.until && rec.until < to ? rec.until : to);
  const exByDate = new Map(rec.exceptions.map((e) => [e.date, e]));
  // Occurrences déplacées vers une date de la fenêtre depuis une date hors fenêtre
  for (const ex of rec.exceptions) {
    if (ex.action === 'move' && ex.dateTo && ex.dateTo >= from && ex.dateTo <= to && (ex.date < from || ex.date > to)) {
      out.push(makeOcc(rec, ex.date, ex.dateTo, ex.start ?? rec.startTime, ex.end ?? rec.endTime, true));
    }
  }
  while (d <= end) {
    const date = d.toISODate()!;
    if (rec.weekdays.includes(d.weekday)) {
      const ex = exByDate.get(date);
      if (!ex) out.push(makeOcc(rec, date, date, rec.startTime, rec.endTime, false));
      else if (ex.action === 'move') {
        const target = ex.dateTo ?? date;
        if (target >= from && target <= to) out.push(makeOcc(rec, date, target, ex.start ?? rec.startTime, ex.end ?? rec.endTime, true));
      }
    }
    d = d.plus({ days: 1 });
  }
  return out;
}

function makeOcc(rec: Recurrence, origDate: LocalDate, date: LocalDate, start: string, end: string, moved: boolean): Block {
  const s = atLocal(date, start, rec.tz);
  let e = atLocal(date, end, rec.tz);
  if (e <= s) e = e.plus({ days: 1 }); // passe minuit
  return {
    id: occurrenceId(rec.id, origDate),
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    version: rec.version,
    origin: rec.origin,
    source: moved ? `${rec.source ?? 'récurrence'} · occurrence déplacée` : rec.source ?? 'récurrence',
    title: rec.title,
    start: iso(s),
    end: iso(e),
    tz: rec.tz,
    kind: rec.kind,
    category: rec.category,
    protection: rec.protection,
    status: 'accepted',
    recurrenceId: rec.id,
    location: rec.location,
    private: rec.private,
    externalUid: rec.externalUid,
  };
}
