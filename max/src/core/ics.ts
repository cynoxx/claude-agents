// Import d'agenda standard (.ics) : sous-ensemble documenté, avec aperçu.
// Pris en charge : VEVENT, DTSTART/DTEND (UTC, TZID, flottant, journée entière), DURATION, SUMMARY, LOCATION,
// UID, RRULE FREQ=WEEKLY (BYDAY, UNTIL, COUNT, INTERVAL=1), EXDATE, RECURRENCE-ID (occurrence modifiée).
// Le reste est signalé « à vérifier » plutôt qu'ignoré silencieusement.
import { DateTime } from 'luxon';
import type { Block, Recurrence } from './types';
import { makeBlock, makeRecurrence } from './factory';
import { iso } from './time';

export interface IcsPreview {
  blocks: Block[];
  recurrences: Recurrence[];
  skipped: { summary: string; reason: string }[];
  warnings: string[];
}

function unfold(text: string): string[] {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
function unescape(v: string): string {
  return v.replace(/\\n/gi, ' ').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}
interface Prop { name: string; params: Record<string, string>; value: string }
function parseLine(line: string): Prop | null {
  const i = line.indexOf(':');
  if (i < 0) return null;
  const head = line.slice(0, i);
  const value = line.slice(i + 1);
  const [name, ...ps] = head.split(';');
  const params: Record<string, string> = {};
  for (const p of ps) { const [k, v] = p.split('='); params[k.toUpperCase()] = (v ?? '').replace(/"/g, ''); }
  return { name: name.toUpperCase(), params, value };
}
function parseDT(p: Prop, defaultTz: string): { dt: DateTime; allDay: boolean; tz: string } | null {
  const v = p.value.trim();
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    const dt = DateTime.fromFormat(v, 'yyyyMMdd', { zone: defaultTz });
    return dt.isValid ? { dt, allDay: true, tz: defaultTz } : null;
  }
  if (v.endsWith('Z')) {
    const dt = DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss'Z'", { zone: 'utc' });
    return dt.isValid ? { dt: dt.setZone(defaultTz), allDay: false, tz: defaultTz } : null;
  }
  const tz = p.params.TZID && DateTime.local().setZone(p.params.TZID).isValid ? p.params.TZID : defaultTz;
  const dt = DateTime.fromFormat(v, "yyyyMMdd'T'HHmmss", { zone: tz });
  return dt.isValid ? { dt, allDay: false, tz } : null;
}
const BYDAY: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };

function category(summary: string): Block['category'] {
  const s = summary.toLowerCase();
  if (/\btp\b/.test(s)) return 'tp';
  if (/\b(cm|td|cours|amphi)\b/.test(s)) return 'cours';
  if (/(contr[oô]le|examen|partiel|ds)\b/.test(s)) return 'controle';
  return 'rdv';
}

export function parseIcs(text: string, opts: { nowIso: string; tz: string; sourceLabel: string }): IcsPreview {
  const lines = unfold(text);
  const out: IcsPreview = { blocks: [], recurrences: [], skipped: [], warnings: [] };
  if (!lines.some((l) => l.startsWith('BEGIN:VCALENDAR'))) {
    out.warnings.push('Ce fichier ne ressemble pas à un agenda .ics.');
    return out;
  }
  const events: Prop[][] = [];
  let cur: Prop[] | null = null;
  for (const l of lines) {
    if (l === 'BEGIN:VEVENT') cur = [];
    else if (l === 'END:VEVENT') { if (cur) events.push(cur); cur = null; }
    else if (cur) { const p = parseLine(l); if (p) cur.push(p); }
  }
  const overrides: { uid: string; recId: DateTime; block: Block }[] = [];
  for (const ev of events) {
    const get = (n: string) => ev.find((p) => p.name === n);
    const summary = unescape(get('SUMMARY')?.value ?? 'Sans titre');
    const uid = get('UID')?.value;
    const ds = get('DTSTART');
    if (!ds) { out.skipped.push({ summary, reason: 'pas de date de début' }); continue; }
    const start = parseDT(ds, opts.tz);
    if (!start) { out.skipped.push({ summary, reason: 'date de début illisible' }); continue; }
    if ((get('STATUS')?.value ?? '').toUpperCase() === 'CANCELLED') { out.skipped.push({ summary, reason: 'annulé dans la source' }); continue; }
    let end: DateTime | undefined;
    const de = get('DTEND');
    if (de) end = parseDT(de, opts.tz)?.dt;
    const dur = get('DURATION')?.value;
    if (!end && dur) {
      const m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?/.exec(dur);
      if (m) end = start.dt.plus({ days: +(m[1] ?? 0), hours: +(m[2] ?? 0), minutes: +(m[3] ?? 0) });
    }
    if (start.allDay) { out.skipped.push({ summary, reason: 'événement sur la journée entière (ajoute-le comme échéance si besoin)' }); continue; }
    if (!end) end = start.dt.plus({ hours: 1 });
    const location = get('LOCATION') ? unescape(get('LOCATION')!.value) : undefined;
    const rrule = get('RRULE')?.value;
    const recIdProp = get('RECURRENCE-ID');
    if (rrule) {
      const r = Object.fromEntries(rrule.split(';').map((kv) => kv.split('=')));
      if (r.FREQ !== 'WEEKLY' || (r.INTERVAL && r.INTERVAL !== '1') || r.BYSETPOS || r.BYMONTH) {
        out.skipped.push({ summary, reason: `récurrence non prise en charge (${rrule}) : à vérifier` });
        continue;
      }
      const weekdays = r.BYDAY ? r.BYDAY.split(',').map((d: string) => BYDAY[d.slice(-2)]).filter(Boolean) : [start.dt.weekday];
      let until: string | undefined;
      if (r.UNTIL) {
        const u = parseDT({ name: 'UNTIL', params: {}, value: r.UNTIL }, opts.tz);
        until = u?.dt.toISODate() ?? undefined;
      } else if (r.COUNT) {
        until = start.dt.plus({ weeks: Math.ceil(+r.COUNT / weekdays.length) }).toISODate()!;
        out.warnings.push(`« ${summary} » : COUNT converti en date de fin approximative (${until}).`);
      }
      const exdates = ev.filter((p) => p.name === 'EXDATE').flatMap((p) => p.value.split(',').map((v) => parseDT({ ...p, value: v }, opts.tz)?.dt.toISODate()).filter(Boolean) as string[]);
      out.recurrences.push(makeRecurrence(opts.nowIso, {
        id: `ics-${hash(uid ?? summary + ds.value)}`, title: summary, weekdays, startTime: start.dt.toFormat('HH:mm'), endTime: end.toFormat('HH:mm'), tz: start.tz,
        from: start.dt.toISODate()!, until, exceptions: exdates.map((d) => ({ date: d, action: 'skip' as const })), category: category(summary), kind: 'fixed', protection: 'locked',
        origin: 'ics', source: opts.sourceLabel, externalUid: uid, location,
      }));
      continue;
    }
    const block = makeBlock(opts.nowIso, {
      id: `ics-${hash((uid ?? summary) + (recIdProp?.value ?? ds.value))}`, title: summary, start: iso(start.dt), end: iso(end), tz: start.tz,
      kind: 'external', category: category(summary), protection: 'locked', origin: 'ics', source: opts.sourceLabel, externalUid: uid, location,
    });
    if (recIdProp) {
      const rid = parseDT(recIdProp, opts.tz);
      if (rid && uid) overrides.push({ uid, recId: rid.dt, block });
      else out.blocks.push(block);
      continue;
    }
    out.blocks.push(block);
  }
  // Occurrences modifiées d'une série : exception « move » sur la récurrence correspondante.
  for (const o of overrides) {
    const rec = out.recurrences.find((r) => r.externalUid === o.uid);
    if (!rec) { out.blocks.push(o.block); continue; }
    const s = DateTime.fromISO(o.block.start).setZone(rec.tz);
    const e = DateTime.fromISO(o.block.end).setZone(rec.tz);
    rec.exceptions.push({ date: o.recId.toISODate()!, action: 'move', dateTo: s.toISODate()!, start: s.toFormat('HH:mm'), end: e.toFormat('HH:mm') });
  }
  return out;
}

/** Hachage court et stable (FNV-1a) pour dériver des identifiants depuis les UID externes. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(36);
}
