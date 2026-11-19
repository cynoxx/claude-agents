import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { addDays, fmtDay, fmtRange, localDate, resolveLocal } from '../core/time';
import { makeRecurrence } from '../core/factory';
import type { Block, BlockCategory } from '../core/types';
import { Field, Sheet, useAct, useNow, useUI, CATEGORY_LABEL } from './common';
import { BlockSheet } from './Sheets';
import { effectiveDeadlineStatus, DEADLINE_STATUS_LABEL } from '../core/derive';

export function Agenda() {
  const s = useStore();
  const ui = useUI();
  const now = useNow();
  const today = localDate(now);
  const tz = s.state.prefs.tz;
  const wide = typeof window !== 'undefined' && window.matchMedia('(min-width: 860px)').matches;
  const [mode, setMode] = useState<'day' | 'week'>(wide ? 'week' : 'day');
  const [anchor, setAnchor] = useState(today);
  const [open, setOpen] = useState<Block | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const weekStart = DateTime.fromISO(anchor).startOf('week').toISODate()!;
  const days = mode === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)) : [anchor];
  const from = days[0], to = days[days.length - 1];
  const plan = useMemo(() => A.computePlan(s), [s.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocks = A.allBlocks(s, from, to).filter((b) => b.status !== 'cancelled');
  const conflictIds = new Set(plan.warnings.filter((w) => w.kind === 'conflict').flatMap((w) => w.refIds));
  const deadlines = live(s.state.deadlines).filter((d) => d.date >= from && d.date <= to && d.status !== 'history');
  const proposedChunks = plan.chunks.filter((c) => !c.keptBlockId);
  const nextExams = live(s.state.deadlines).filter((d) => d.date >= today && ['announced', 'to_confirm'].includes(d.status)).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);

  const itemsFor = (date: string) => {
    const bs = blocks.filter((b) => DateTime.fromISO(b.start).setZone(tz).toISODate() === date).map((b) => ({ b, st: DateTime.fromISO(b.start).setZone(tz), en: DateTime.fromISO(b.actualEnd ?? b.end).setZone(tz) }));
    const ps = proposedChunks.filter((c) => c.start.toISODate() === date);
    return { bs: bs.sort((a, b) => +a.st - +b.st), ps };
  };
  const cls = (b: Block) => (b.kind === 'planned' ? 'planned accepted' : b.kind === 'external' ? 'external' : 'fixed') + (conflictIds.has(b.id) ? ' conflict' : '');
  const tag = (b: Block) => (b.kind === 'planned' ? (b.status === 'done' ? 'fait' : b.status === 'missed' ? 'manqué' : 'validé') : b.kind === 'external' ? `externe · ${b.source ?? ''}` : b.kind === 'protected' ? 'protégé' : b.recurrenceId ? 'récurrent' : 'fixe');

  return (
    <div>
      <div className="row" style={{ margin: '4px 0 10px' }}>
        <h1 style={{ margin: 0 }} className="grow">Agenda</h1>
        <div className="row" role="group" aria-label="Vue">
          <button className="chip" aria-pressed={mode === 'day'} onClick={() => setMode('day')}>Jour</button>
          <button className="chip" aria-pressed={mode === 'week'} onClick={() => setMode('week')}>Semaine</button>
        </div>
      </div>
      <div className="row" style={{ marginBottom: 10 }}>
        <button className="btn small" aria-label="Précédent" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? -7 : -1))}>←</button>
        <button className="btn small" onClick={() => setAnchor(today)}>Aujourd’hui</button>
        <button className="btn small" aria-label="Suivant" onClick={() => setAnchor(addDays(anchor, mode === 'week' ? 7 : 1))}>→</button>
        <span className="grow small muted">{mode === 'week' ? `Semaine du ${DateTime.fromISO(from).setLocale('fr').toFormat('d LLLL')}` : fmtDay(anchor, today) + ' · ' + DateTime.fromISO(anchor).setLocale('fr').toFormat('d LLLL')}</span>
        <button className="btn small primary" onClick={() => setAdding(mode === 'day' ? anchor : today)}>+ Ajouter</button>
      </div>
      <p className="small muted" style={{ marginTop: -4 }}>
        <span className="badge fixed">fixe</span> engagement · <span className="badge accepted">validé</span> créneau que tu as accepté · <span className="badge proposed">proposé</span> suggestion de Max · <span className="badge external">externe</span> importé
      </p>
      {plan.warnings.filter((w) => w.kind === 'conflict').map((w, i) => <p key={i} className="notice danger">{w.message}</p>)}

      {mode === 'week' && wide ? (
        <div className="week">
          {days.map((d) => {
            const { bs, ps } = itemsFor(d);
            return (
              <div key={d} className={'day' + (d === today ? ' today' : '')}>
                <h3><button className="btn small ghost" style={{ padding: 0, minHeight: 0 }} onClick={() => { setAnchor(d); setMode('day'); }}>{DateTime.fromISO(d).setLocale('fr').toFormat('ccc d')}</button></h3>
                {deadlines.filter((x) => x.date === d).map((x) => <button key={x.id} className="dl-chip ev" onClick={() => ui.openDeadline(x.id)}>{x.time ? x.time + ' ' : ''}{x.title}{!x.time ? ' · heure ?' : ''}</button>)}
                {bs.map(({ b, st, en }) => <button key={b.id} className={'ev ' + cls(b)} onClick={() => setOpen(b)}><span className="tm">{fmtRange(st, en)}</span>{b.private ? 'Temps privé' : b.stepTitle ?? b.title}</button>)}
                {ps.map((c) => <div key={c.taskId + c.start.toISO()} className="ev planned"><span className="tm">{fmtRange(c.start, c.end)} · proposé</span>{c.stepTitle ?? s.state.tasks.get(c.taskId)?.title}</div>)}
                <button className="btn small ghost" style={{ width: '100%' }} aria-label={`Ajouter le ${d}`} onClick={() => setAdding(d)}>+</button>
              </div>
            );
          })}
        </div>
      ) : (
        days.map((d) => {
          const { bs, ps } = itemsFor(d);
          const rows = [
            ...bs.map(({ b, st, en }) => ({ key: b.id, st, en, node: <button className="open" onClick={() => setOpen(b)} style={{ background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer', minHeight: 44 }}>{b.private ? 'Temps privé' : b.stepTitle ?? b.title} <span className={'badge ' + (b.kind === 'planned' ? 'accepted' : b.kind === 'external' ? 'external' : 'fixed')}>{tag(b)}</span>{conflictIds.has(b.id) && <span className="badge danger">conflit</span>}{b.actualEnd && <span className="small muted"> · déborde</span>}</button>, c: cls(b) })),
            ...ps.map((c) => ({ key: c.taskId + c.start.toISO(), st: c.start, en: c.end, node: <span>{c.stepTitle ?? s.state.tasks.get(c.taskId)?.title} <span className="badge proposed">proposé</span></span>, c: 'planned' })),
          ].sort((a, b) => +a.st - +b.st);
          return (
            <section key={d}>
              {mode === 'week' && <h2>{fmtDay(d, today)} {DateTime.fromISO(d).setLocale('fr').toFormat('d LLL')}</h2>}
              {deadlines.filter((x) => x.date === d).map((x) => (
                <p key={x.id} className="notice warn small" style={{ margin: '6px 0' }}>
                  <button className="btn small ghost" onClick={() => ui.openDeadline(x.id)}>{x.title} · {x.time ? x.time.replace(':', ' h ') : 'heure inconnue (aucun créneau bloqué)'} · {DEADLINE_STATUS_LABEL[effectiveDeadlineStatus(x, now)]}</button>
                </p>
              ))}
              {rows.length === 0 ? <p className="muted small">Rien de prévu.</p> : (
                <ul className="timeline">{rows.map((r) => <li key={r.key} className={r.c + (r.en <= now ? ' past' : '')}><span className="t">{fmtRange(r.st, r.en)}</span><span className="what">{r.node}</span></li>)}</ul>
              )}
            </section>
          );
        })
      )}
      {proposedChunks.length > 0 && (
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => ui.openReplan({})}>Revoir le plan proposé ({proposedChunks.length} bloc{proposedChunks.length > 1 ? 's' : ''})</button>
        </div>
      )}

      <h2>Prochains contrôles et échéances</h2>
      {nextExams.length === 0 ? <p className="muted small">Aucun.</p> : (
        <ul className="tasklist">{nextExams.map((d) => <li key={d.id}><button className="open" onClick={() => ui.openDeadline(d.id)}><span className="t">{d.title}</span><span className="small muted">{fmtDay(d.date, today)} {d.date} · {d.time ?? 'heure inconnue'}{!d.dateConfirmed ? ' · date à confirmer' : ''}</span></button></li>)}</ul>
      )}
      {open && <BlockSheet block={open} onClose={() => setOpen(null)} />}
      {adding && <AddEvent date={adding} onClose={() => setAdding(null)} />}
    </div>
  );
}

const WD = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
export function AddEvent({ date, onClose }: { date: string; onClose: () => void }) {
  const s = useStore();
  const act = useAct();
  const tz = s.state.prefs.tz;
  const [f, setF] = useState({ title: '', date, time: '18:00', end: '19:30', category: 'rdv' as BlockCategory, kind: 'fixed' as 'fixed' | 'protected' | 'deadline', priv: false, recurring: false, weekdays: [DateTime.fromISO(date).weekday], until: '', location: '' });
  const [offsetChoice, setOffsetChoice] = useState<number | null>(null);
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p });
  const res = resolveLocal(f.date, f.time, tz);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.title.trim() && !f.priv) return;
    const title = f.title.trim() || 'Temps privé';
    if (f.kind === 'deadline') {
      await act(() => A.createDeadline(s, { title, date: f.date, time: f.time || undefined, location: f.location || undefined }));
      onClose();
      return;
    }
    const [sh, sm] = f.time.split(':').map(Number);
    const [eh, em] = f.end.split(':').map(Number);
    let dur = eh * 60 + em - (sh * 60 + sm);
    if (dur <= 0) dur += 24 * 60;
    if (f.recurring) {
      await act(() => A.createRecurrence(s, makeRecurrence(s.nowIso(), { title, weekdays: f.weekdays, startTime: f.time, endTime: f.end, from: f.date, until: f.until || undefined, category: f.category, kind: f.kind === 'protected' ? 'protected' : 'fixed', private: f.priv, location: f.location || undefined, source: 'saisi dans Max' })));
    } else {
      const start = offsetChoice != null ? res.alternatives[offsetChoice] : res.dt;
      await act(() => A.createEvent(s, { title, date: start.toISODate()!, time: start.toFormat('HH:mm'), durationMin: dur, category: f.category, kind: f.kind as 'fixed' | 'protected', private: f.priv, location: f.location || undefined }));
    }
    onClose();
  }
  return (
    <Sheet title="Ajouter à l’agenda" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <div className="row">
          <button type="button" className="chip" aria-pressed={f.kind === 'fixed'} onClick={() => set({ kind: 'fixed' })}>Engagement fixe</button>
          <button type="button" className="chip" aria-pressed={f.kind === 'protected'} onClick={() => set({ kind: 'protected', priv: true, category: 'prive' })}>Temps protégé / privé</button>
          <button type="button" className="chip" aria-pressed={f.kind === 'deadline'} onClick={() => set({ kind: 'deadline' })}>Contrôle / échéance</button>
        </div>
        <Field label={f.priv ? 'Titre (facultatif, reste privé)' : 'Titre'}><input type="text" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === 'deadline' ? 'Contrôle de maths' : 'Boxe, cours, rendez-vous…'} /></Field>
        <div className="grid2">
          <Field label="Date"><input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label={f.kind === 'deadline' ? 'Heure (vide si inconnue)' : 'Début'}><input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></Field>
          {f.kind !== 'deadline' && <Field label="Fin"><input type="time" value={f.end} onChange={(e) => set({ end: e.target.value })} /></Field>}
          {f.kind !== 'deadline' && <Field label="Catégorie"><select value={f.category} onChange={(e) => set({ category: e.target.value as BlockCategory })}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>}
          <Field label="Lieu (facultatif)"><input type="text" value={f.location} onChange={(e) => set({ location: e.target.value })} /></Field>
        </div>
        {res.gap && <p className="notice warn">Cette heure n’existe pas ce jour-là (passage à l’heure d’été) : elle sera enregistrée à {res.dt.toFormat('HH:mm')}.</p>}
        {res.ambiguous && !f.recurring && (
          <div className="notice warn">
            Cette heure existe deux fois (passage à l’heure d’hiver). Laquelle ?
            <div className="btn-row" style={{ marginTop: 6 }}>{res.alternatives.map((a, i) => <button type="button" key={i} className="chip" aria-pressed={offsetChoice === i} onClick={() => setOffsetChoice(i)}>{a.toFormat('HH:mm')} (UTC{a.toFormat('ZZ')})</button>)}</div>
          </div>
        )}
        {f.kind !== 'deadline' && (
          <>
            <label className="check"><input type="checkbox" checked={f.priv} onChange={(e) => set({ priv: e.target.checked })} /><span>Privé : seul l’horaire compte, le contenu n’est pas affiché ni exporté sans ton accord</span></label>
            <label className="check"><input type="checkbox" checked={f.recurring} onChange={(e) => set({ recurring: e.target.checked })} /><span>Se répète chaque semaine (cours, entraînement…)</span></label>
            {f.recurring && (
              <div className="row">
                {WD.map((w, i) => <button type="button" key={w} className="chip" aria-pressed={f.weekdays.includes(i + 1)} onClick={() => set({ weekdays: f.weekdays.includes(i + 1) ? f.weekdays.filter((x) => x !== i + 1) : [...f.weekdays, i + 1] })}>{w}</button>)}
                <Field label="Jusqu’au (facultatif)"><input type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} /></Field>
              </div>
            )}
          </>
        )}
        <div className="btn-row">
          <button className="btn primary" type="submit" disabled={(!f.title.trim() && !f.priv) || (res.ambiguous && !f.recurring && offsetChoice == null)}>Ajouter</button>
          <button className="btn ghost" type="button" onClick={onClose}>Annuler</button>
        </div>
        <p className="small muted">Fuseau : {tz}. Les heures locales sont conservées lors des changements d’heure.</p>
      </form>
    </Sheet>
  );
}
