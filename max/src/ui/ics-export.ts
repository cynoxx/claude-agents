import { DateTime } from 'luxon';
import type { Deadline } from '../core/types';
import { atLocal } from '../core/time';

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

/** Fichier .ics à ajouter à l'agenda habituel (rappel la veille), avec ton accord : rien n'est envoyé. */
export function deadlineIcs(ds: Deadline[], tz: string, nowIso: string): string {
  const stamp = DateTime.fromISO(nowIso).toUTC().toFormat("yyyyMMdd'T'HHmmss'Z'");
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Max//FR', 'CALSCALE:GREGORIAN'];
  for (const d of ds) {
    lines.push('BEGIN:VEVENT', `UID:max-${d.id}@max.local`, `DTSTAMP:${stamp}`, `SUMMARY:${esc(d.title)}`);
    if (d.time) {
      const s = atLocal(d.date, d.time, d.tz || tz).toUTC();
      lines.push(`DTSTART:${s.toFormat("yyyyMMdd'T'HHmmss'Z'")}`, `DTEND:${s.plus({ minutes: d.durationMin ?? 60 }).toFormat("yyyyMMdd'T'HHmmss'Z'")}`);
    } else {
      const day = DateTime.fromISO(d.date);
      lines.push(`DTSTART;VALUE=DATE:${day.toFormat('yyyyMMdd')}`, `DTEND;VALUE=DATE:${day.plus({ days: 1 }).toFormat('yyyyMMdd')}`, 'DESCRIPTION:Heure à confirmer');
    }
    if (d.location) lines.push(`LOCATION:${esc(d.location)}`);
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(d.title)}`, 'TRIGGER:-PT18H', 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
