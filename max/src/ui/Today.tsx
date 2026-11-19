import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { absenceReview, effectiveDeadlineStatus, DEADLINE_STATUS_LABEL } from '../core/derive';
import { fmtDateLong, fmtDay, fmtDuration, fmtRange, fmtTime, localDate, daysBetween } from '../core/time';
import { remainingMinutes } from '../core/engine/planner';
import { useAct, useNow, useUI, Sheet, CATEGORY_LABEL } from './common';
import type { Block, Deadline } from '../core/types';

export function Today() {
  const s = useStore();
  const ui = useUI();
  const act = useAct();
  const now = useNow();
  const today = localDate(now);
  const tz = s.state.prefs.tz;
  const plan = useMemo(() => A.computePlan(s), [s.getVersion(), now.toFormat('yyyyMMddHHmm')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [thirty, setThirty] = useState<ReturnType<typeof A.suggest30> | null>(null);
  const [review, setReview] = useState(false);
  const [doneMin, setDoneMin] = useState<string>('');

  const na = plan.nextAction;
  const task = na.taskId ? s.state.tasks.get(na.taskId) : undefined;
  const deadlines = live(s.state.deadlines);
  const absence = absenceReview((window as any).__maxLastOpenAt ?? s.state.prefs.lastOpenAt, now, deadlines, live(s.state.blocks), live(s.state.tasks));
  const nextFixed = plan.busy.filter((b) => (b.kind === 'fixed' || b.kind === 'deadline' || b.kind === 'protected') && b.start > now).sort((a, b) => +a.start - +b.start)[0];

  // Une seule question ouverte, quand sa réponse change quelque chose : l'heure d'une échéance imminente.
  const question = deadlines
    .filter((d) => !d.time && (d.status === 'announced' || d.status === 'to_confirm') && d.date >= today && daysBetween(today, d.date) <= 2 && !s.state.prefs.dismissedQuestions.includes('time:' + d.id))
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  // Échéances proches (3 priorités visibles max).
  const upcoming = deadlines
    .filter((d) => ['announced', 'to_confirm'].includes(d.status) && d.date >= today && daysBetween(today, d.date) <= 10)
    .sort((a, b) => (a.date + (a.time ?? '99')).localeCompare(b.date + (b.time ?? '99')));
  const toFill = deadlines.filter((d) => effectiveDeadlineStatus(d, now) === 'to_fill');
  const pendingCaptures = live(s.state.captures).filter((c) => ['needs_input', 'failed', 'new', 'partial'].includes(c.status));
  const inboxTasks = live(s.state.tasks).filter((t) => t.status === 'inbox');

  // Reste du jour : agenda + plan (accepté ou proposé).
  const dayBlocks = A.allBlocks(s, today, today).filter((b) => b.start.slice(0, 10) === today || b.end.slice(0, 10) === today);
  const acceptedTaskBlocks = new Set(dayBlocks.filter((b) => b.kind === 'planned').map((b) => b.id));
  const proposed = plan.chunks.filter((c) => localDate(c.start) === today && !(c.keptBlockId && acceptedTaskBlocks.has(c.keptBlockId)));
  type Row = { key: string; start: DateTime; end: DateTime; title: string; cls: string; badge: string; sub?: string; block?: Block };
  const rows: Row[] = [
    ...dayBlocks.filter((b) => b.status !== 'cancelled' && b.status !== 'missed').map((b) => {
      const st = DateTime.fromISO(b.start).setZone(tz), en = DateTime.fromISO(b.actualEnd ?? b.end).setZone(tz);
      const t = b.taskId ? s.state.tasks.get(b.taskId) : undefined;
      const planned = b.kind === 'planned';
      return {
        key: b.id, start: st, end: en, block: b,
        title: b.private ? 'Temps privé' : planned ? b.stepTitle ?? t?.title ?? b.title : b.title,
        cls: (planned ? 'accepted' : 'fixed') + (en <= now ? ' past' : ''),
        badge: planned ? (b.status === 'done' ? 'fait' : 'validé') : b.kind === 'external' ? 'externe' : b.kind === 'protected' ? 'protégé' : CATEGORY_LABEL[b.category] ?? 'fixe',
        sub: b.actualEnd ? `déborde jusqu’à ${fmtTime(en)}` : b.source && b.kind === 'external' ? b.source : undefined,
      };
    }),
    ...proposed.map((c) => ({ key: 'p' + c.taskId + c.start.toISO(), start: c.start, end: c.end, title: c.stepTitle ?? s.state.tasks.get(c.taskId)?.title ?? '', cls: 'planned', badge: 'proposé' })),
  ].filter((r) => r.end > now.minus({ hours: 1 })).sort((a, b) => +a.start - +b.start);
  const conflictIds = new Set(plan.warnings.filter((w) => w.kind === 'conflict').flatMap((w) => w.refIds));
  const proposalChanges = plan.changes.filter((c) => c.kind !== 'keep');
  const energyLow = s.state.prefs.energy?.date === today && s.state.prefs.energy.level === 'basse';
  const capped = s.state.prefs.availableUntil?.date === today;

  async function acceptDayPlan() {
    await act(() => A.applyPlan(s, plan, new Set(proposalChanges.map((c) => c.key)), {}), 'Plan du jour validé');
  }

  return (
    <div>
      <h1 className="sr-only">Aujourd’hui</h1>
      <p className="muted small" style={{ margin: '4px 0 10px' }}>{fmtDateLong(today)} · {fmtTime(now)}</p>

      {absence.daysAway >= 2 && (absence.deadlinesToFill.length > 0 || absence.missedBlocks.length > 0) && (
        <div className="notice" style={{ marginBottom: 10 }}>
          Content de te revoir. Tes engagements sont là, le passé reste passé.{' '}
          <button className="btn small" onClick={() => setReview(true)}>Revue du retard ({absence.deadlinesToFill.length + absence.missedBlocks.length})</button>
        </div>
      )}

      {question && <TimeQuestion d={question} />}

      {plan.currentBlock && (
        <p className="card" style={{ margin: '0 0 10px', padding: '10px 14px' }}>
          <span className="kicker">En cours</span><br />
          <strong>{plan.currentBlock.title}</strong> · jusqu’à {fmtTime(plan.currentBlock.end)}
        </p>
      )}
      <section className="card now-card" aria-labelledby="now-h">
        <div className="kicker" id="now-h">{na.kind === 'current' ? 'En cours' : na.kind === 'task' ? (na.start && na.start > now.plus({ minutes: 10 }) ? `Prochaine action · à ${fmtTime(na.start)}` : 'Maintenant') : 'Maintenant'}</div>
        <div className="title">{na.title}</div>
        <div className="meta">
          {na.kind === 'task' && <>{fmtDuration(na.minutes ?? 0)}{task && remainingMinutes(task) > (na.minutes ?? 0) ? ` · étape de « ${task.title} »` : ''}</>}
          {na.kind === 'current' && na.end && <>jusqu’à {fmtTime(na.end)}</>}
          {(na.kind === 'free' || na.kind === 'rest') && <>Rien d’urgent ne réclame ce temps.</>}
          {na.until && <> · tu as jusqu’à <strong>{fmtTime(na.until)}</strong> ({na.untilLabel})</>}
        </div>
        {task && (
          <div className="btn-row" style={{ marginTop: 10 }}>
            {task.status !== 'in_progress' ? (
              <button className="btn primary" onClick={() => act(() => A.startTask(s, task.id))}>Commencer</button>
            ) : (
              <button className="btn primary" onClick={() => act(() => A.stopTask(s, task.id, { done: true }))}>Terminer</button>
            )}
            {task.status === 'in_progress' && <button className="btn" onClick={() => act(() => A.stopTask(s, task.id, { done: false }))}>Interrompre</button>}
            {task.status !== 'in_progress' && (
              <span className="row nowrap">
                <button className="btn" onClick={() => act(() => A.markDone(s, task.id, doneMin ? +doneMin : undefined))}>Déjà fait</button>
                <input aria-label="Durée réelle en minutes (facultatif)" placeholder="min" type="number" inputMode="numeric" style={{ width: 72 }} value={doneMin} onChange={(e) => setDoneMin(e.target.value)} />
              </span>
            )}
            <button className="btn ghost" onClick={() => act(() => A.deferTask(s, task.id))}>Pas aujourd’hui</button>
            <button className="btn ghost" onClick={() => ui.openTask(task.id)}>Fiche</button>
          </div>
        )}
        {nextFixed && <p className="small" style={{ margin: '10px 0 0' }}>Prochain engagement fixe : <strong>{nextFixed.label}</strong> à {fmtTime(nextFixed.start)}{nextFixed.start.toISODate() !== today ? ` (${fmtDay(nextFixed.start.toISODate()!, today)})` : ''}</p>}
      </section>

      <div className="btn-row" style={{ margin: '12px 0' }}>
        <button className="btn primary" onClick={() => ui.openReplan()}>Recaler</button>
        <button className="btn" onClick={() => setThirty(A.suggest30(s, 30))}>J’ai 30 min</button>
        {(energyLow || capped) && <button className="btn ghost" onClick={() => act(() => A.resetDay(s))}>Rétablir le plan normal</button>}
      </div>
      {energyLow && <p className="notice small">Mode « peu d’énergie » : séances courtes, journée allégée, engagements verrouillés gardés.</p>}
      {thirty && (
        <div className="card" role="status">
          <div className="kicker">Pour tes 30 minutes</div>
          <p style={{ margin: '4px 0' }}><strong>{thirty.title}</strong>{thirty.minutes ? ` · ${fmtDuration(thirty.minutes)}` : ''}</p>
          <p className="small muted" style={{ margin: 0 }}>{thirty.reason}</p>
          <div className="btn-row" style={{ marginTop: 8 }}>
            {thirty.taskId && <button className="btn primary small" onClick={() => { act(() => A.startTask(s, thirty.taskId!)); setThirty(null); }}>Commencer</button>}
            <button className="btn small ghost" onClick={() => setThirty(null)}>Fermer</button>
          </div>
        </div>
      )}

      {proposalChanges.length > 0 && (
        <div className="notice" style={{ marginTop: 10 }}>
          Max propose {proposed.length > 0 ? `${proposed.length} bloc${proposed.length > 1 ? 's' : ''} pour aujourd’hui` : 'des ajustements'} (en pointillés).{' '}
          <span className="btn-row" style={{ display: 'inline-flex', marginTop: 6 }}>
            <button className="btn small primary" onClick={acceptDayPlan}>Valider</button>
            <button className="btn small" onClick={() => ui.openReplan({})}>Revoir</button>
          </span>
        </div>
      )}

      {plan.warnings.filter((w) => w.kind === 'conflict').map((w, i) => <p key={i} className="notice danger">{w.message}</p>)}

      <h2>Reste de la journée</h2>
      {rows.length === 0 ? <p className="muted">Journée libre. Ce temps peut rester vide.</p> : (
        <ul className="timeline">
          {rows.map((r) => (
            <li key={r.key} className={r.cls + (r.block && conflictIds.has(r.block.id) ? ' conflict' : '')}>
              <span className="t">{fmtRange(r.start, r.end)}</span>
              <span className="what">
                {r.title} <span className={'badge ' + (r.badge === 'proposé' ? 'proposed' : r.badge === 'validé' || r.badge === 'fait' ? 'accepted' : r.badge === 'externe' ? 'external' : 'fixed')}>{r.badge}</span>
                {r.sub && <><br /><span className="small muted">{r.sub}</span></>}
              </span>
            </li>
          ))}
        </ul>
      )}

      <h2>Échéances proches</h2>
      {upcoming.length === 0 && toFill.length === 0 && <p className="muted">Aucune échéance dans les 10 prochains jours.</p>}
      <ul className="tasklist">
        {upcoming.slice(0, s.state.prefs.maxPriorities).map((d) => <DeadlineRow key={d.id} d={d} today={today} />)}
      </ul>
      {upcoming.length > s.state.prefs.maxPriorities && <a href="#/liste/echeances" className="small">Voir les {upcoming.length} échéances</a>}
      {toFill.length > 0 && <p className="small">À renseigner : {toFill.map((d) => <button key={d.id} className="btn small ghost" onClick={() => ui.openDeadline(d.id)}>{d.title}</button>)}</p>}

      {(pendingCaptures.length > 0 || inboxTasks.length > 0) && (
        <p className="small muted" style={{ marginTop: 18 }}>
          Boîte de réception : <a href="#/liste/inbox">{pendingCaptures.length + inboxTasks.length} élément{pendingCaptures.length + inboxTasks.length > 1 ? 's' : ''} à classer</a>
        </p>
      )}

      {review && (
        <Sheet title="Revue du retard" onClose={() => setReview(false)}>
          <p className="muted">Rien n’a été effacé. Les tâches des créneaux manqués sont toujours ouvertes dans la liste.</p>
          <h3>Échéances passées à renseigner</h3>
          {absence.deadlinesToFill.length === 0 ? <p className="muted">Aucune.</p> : absence.deadlinesToFill.map((d) => (
            <div key={d.id} className="row" style={{ padding: '6px 0' }}>
              <span className="grow">{d.title} · {d.date}</span>
              <button className="btn small" onClick={() => { setReview(false); ui.openDeadline(d.id); }}>Renseigner</button>
            </div>
          ))}
          <h3>Créneaux manqués</h3>
          {absence.missedBlocks.length === 0 ? <p className="muted">Aucun.</p> : <ul className="small">{absence.missedBlocks.map((b) => <li key={b.id}>{s.state.tasks.get(b.taskId!)?.title ?? b.title} — {b.start.slice(0, 10)}</li>)}</ul>}
          <div className="btn-row"><button className="btn primary" onClick={() => { setReview(false); ui.openReplan({}); }}>Recaler à partir de maintenant</button></div>
        </Sheet>
      )}
    </div>
  );
}

function DeadlineRow({ d, today }: { d: Deadline; today: string }) {
  const ui = useUI();
  return (
    <li>
      <button className="open" onClick={() => ui.openDeadline(d.id)}>
        <span className="t"><strong>{d.title}</strong></span>
        <span className="small muted">
          {fmtDay(d.date, today)}{d.time ? ` à ${d.time.replace(':', ' h ')}` : ''} {!d.time && <span className="badge warn">heure à confirmer</span>} {!d.dateConfirmed && <span className="badge warn">date à confirmer</span>} <span className="badge">{DEADLINE_STATUS_LABEL[d.status]}</span>
        </span>
      </button>
    </li>
  );
}

function TimeQuestion({ d }: { d: Deadline }) {
  const s = useStore();
  const act = useAct();
  const [t, setT] = useState('');
  return (
    <section className="card question-card" aria-labelledby="q-h" style={{ marginBottom: 10 }}>
      <div className="kicker" id="q-h">Une question</div>
      <p style={{ margin: '4px 0 8px' }}>À quelle heure est « <strong>{d.title}</strong> » ({fmtDay(d.date, localDate(s.clock().setZone(s.state.prefs.tz)))}) ? Ça change ce que je te propose.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); if (t) act(() => A.updateDeadline(s, d.id, { time: t, dateConfirmed: true }, 'Heure confirmée')); }}>
        <input type="time" aria-label="Heure" value={t} onChange={(e) => setT(e.target.value)} style={{ width: 130 }} />
        <button className="btn primary" type="submit" disabled={!t}>Enregistrer</button>
        <button className="btn ghost" type="button" onClick={() => act(() => A.updatePrefs(s, { dismissedQuestions: [...s.state.prefs.dismissedQuestions, 'time:' + d.id] }, 'Question reportée'))}>Je ne sais pas encore</button>
        <button className="btn ghost" type="button" onClick={() => act(() => A.updateDeadline(s, d.id, { status: 'cancelled' }, 'Échéance annulée'))}>N’a pas lieu</button>
      </form>
    </section>
  );
}
