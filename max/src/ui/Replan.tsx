import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import type { ID, ReplanFacts } from '../core/types';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { fmtDuration, fmtRange, fmtTime, localDate } from '../core/time';
import { Sheet, useAct, Field, useNow } from './common';
import type { Change } from '../core/engine/planner';

const KIND_LABEL: Record<Change['kind'], string> = {
  keep: 'Inchangé', move: 'Déplacé', create: 'Ajouté aujourd’hui', later: 'Plus tard', to_list: 'Remis dans la liste',
  block_extend: 'Prolongé', block_cancel: 'Annulé', missed: 'Créneau manqué',
};

export function ReplanSheet({ initial, captureId, onClose }: { initial?: ReplanFacts; captureId?: ID; onClose: () => void }) {
  const s = useStore();
  const act = useAct();
  const now = useNow();
  const [facts, setFacts] = useState<ReplanFacts>(initial ?? {});
  const [stale, setStale] = useState(false);
  const [tick, setTick] = useState(0);
  const today = localDate(now);
  const preview = useMemo(() => A.computePlan(s, facts), [s.getVersion(), facts, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const actionable = preview.changes.filter((c) => c.kind !== 'keep');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set(actionable.map((c) => c.key))), [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  const todayBlocks = A.allBlocks(s, today, today).filter((b) => b.kind !== 'planned' && DateTime.fromISO(b.end) > now.minus({ hours: 3 }) && b.start.slice(0, 10) === today).sort((a, b) => a.start.localeCompare(b.start));
  const upcoming = todayBlocks.filter((b) => DateTime.fromISO(b.start) > now);
  const tasks = live(s.state.tasks).filter((t) => t.status === 'open' || t.status === 'in_progress');
  const planToday = preview.chunks.filter((c) => c.start.toISODate() === today);

  async function apply(all: boolean) {
    const sel = all ? new Set(actionable.map((c) => c.key)) : selected;
    try {
      await act(() => A.applyPlan(s, preview, sel, facts, captureId));
      onClose();
    } catch (e) {
      if (e instanceof A.StalePreviewError) { setStale(true); setTick((x) => x + 1); }
    }
  }
  const set = (p: Partial<ReplanFacts>) => setFacts((f) => ({ ...f, ...p }));
  const label = (c: Change) => {
    const t = c.taskId ? s.state.tasks.get(c.taskId) : undefined;
    return c.stepTitle ? `${c.stepTitle} (${t?.title ?? c.title})` : t?.title ?? c.title;
  };
  const range = (r?: { start: DateTime; end: DateTime }) => (r ? `${r.start.toISODate() !== today ? r.start.setLocale('fr').toFormat('ccc d') + ' ' : ''}${fmtRange(r.start, r.end)}` : '');

  return (
    <Sheet title="Recaler la journée" onClose={onClose} wide>
      <details open={!initial || Object.keys(initial).length === 0}>
        <summary>Ce qui change</summary>
        <div className="stack" style={{ marginTop: 8 }}>
          <div className="grid2">
            <Field label="Un bloc déborde">
              <select value={facts.overrun?.blockId ?? ''} onChange={(e) => set({ overrun: e.target.value ? { blockId: e.target.value, until: facts.overrun?.until ?? now.plus({ minutes: 30 }).toFormat('HH:mm') } : undefined })}>
                <option value="">— aucun —</option>
                {todayBlocks.map((b) => <option key={b.id} value={b.id}>{b.private ? 'Temps privé' : b.title} ({fmtRange(DateTime.fromISO(b.start).setZone(s.state.prefs.tz), DateTime.fromISO(b.end).setZone(s.state.prefs.tz))})</option>)}
              </select>
            </Field>
            <Field label="… jusqu’à">
              <input type="time" value={facts.overrun?.until ?? ''} disabled={!facts.overrun} onChange={(e) => facts.overrun && set({ overrun: { ...facts.overrun, until: e.target.value } })} />
            </Field>
            <Field label="Disponible jusqu’à" hint="Laisse vide si rien ne change">
              <input type="time" value={facts.availableUntil ?? ''} onChange={(e) => set({ availableUntil: e.target.value || undefined, minutesLeft: undefined })} />
            </Field>
            <Field label="Ou : il me reste (min)">
              <input type="number" min={0} step={5} inputMode="numeric" value={facts.minutesLeft ?? ''} onChange={(e) => set({ minutesLeft: e.target.value ? +e.target.value : undefined, availableUntil: undefined })} />
            </Field>
          </div>
          {upcoming.length > 0 && (
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="small muted">Annulé aujourd’hui</legend>
              {upcoming.map((b) => (
                <label key={b.id} className="check">
                  <input type="checkbox" checked={facts.cancelledBlockIds?.includes(b.id) ?? false} onChange={(e) => set({ cancelledBlockIds: e.target.checked ? [...(facts.cancelledBlockIds ?? []), b.id] : facts.cancelledBlockIds?.filter((x) => x !== b.id) })} />
                  <span>{b.private ? 'Temps privé' : b.title} · {fmtTime(DateTime.fromISO(b.start).setZone(s.state.prefs.tz))}</span>
                </label>
              ))}
            </fieldset>
          )}
          <div className="row">
            <span className="small muted">Énergie :</span>
            <button className="chip" aria-pressed={facts.energy !== 'basse'} onClick={() => set({ energy: 'normale' })}>Normale</button>
            <button className="chip" aria-pressed={facts.energy === 'basse'} onClick={() => set({ energy: 'basse' })}>Peu d’énergie</button>
          </div>
          <div className="grid2">
            <Field label="Épingler une tâche à une heure">
              <select value={facts.pins?.[0]?.taskId ?? ''} onChange={(e) => set({ pins: e.target.value ? [{ taskId: e.target.value, start: facts.pins?.[0]?.start ?? now.plus({ minutes: 15 }).startOf('hour').plus({ hours: 1 }).toFormat('HH:mm') }] : [] })}>
                <option value="">— aucune —</option>
                {tasks.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
            <Field label="… à">
              <input type="time" value={facts.pins?.[0]?.start ?? ''} disabled={!facts.pins?.length} onChange={(e) => facts.pins?.[0] && set({ pins: [{ ...facts.pins[0], start: e.target.value }] })} />
            </Field>
          </div>
        </div>
      </details>

      {stale && <p className="notice warn" role="status">Les données ont changé pendant l’aperçu : il a été recalculé. Vérifie avant d’appliquer.</p>}

      <section aria-live="polite" style={{ marginTop: 12 }}>
        {preview.tradeoffs[0] && (
          <div className="card question-card">
            <div className="kicker">Décision à prendre</div>
            <p style={{ margin: '4px 0 8px' }}>{preview.tradeoffs[0].message}</p>
            <div className="btn-row">
              {preview.tradeoffs[0].options.map((o) => <button key={o.label} className="btn small" onClick={() => setFacts(o.facts)}>{o.label}</button>)}
              {preview.outcomes.filter((o) => o.outcome === 'arbitrage').length > 1 && <span className="small muted">+ {preview.outcomes.filter((o) => o.outcome === 'arbitrage').length - 1} autre(s) échéance(s) à risque dans le détail</span>}
            </div>
          </div>
        )}
        <div className="card">
          <div className="kicker">Résultat</div>
          {preview.summary.filter((x) => x !== preview.tradeoffs[0]?.message).map((x, i) => <p key={i} style={{ margin: '4px 0', fontWeight: i === 0 ? 650 : 400 }}>{x}</p>)}
          {preview.nextAction.kind === 'task' && <p className="small" style={{ margin: '6px 0 0' }}>Maintenant : <strong>{preview.nextAction.title}</strong>, {fmtDuration(preview.nextAction.minutes ?? 0)}{preview.nextAction.until ? ` · avant ${preview.nextAction.untilLabel} (${fmtTime(preview.nextAction.until)})` : ''}</p>}
          <p className="small muted" style={{ margin: '6px 0 0' }}>
            {fmtDuration(preview.capacity.activeTodayMin)} de travail actif placées aujourd’hui sur {fmtDuration(preview.capacity.freeTodayMin)} libres.
            {preview.capacity.shortfallMin > 0 && <> Il manque <strong>{fmtDuration(preview.capacity.shortfallMin)}</strong> avant une échéance.</>}
          </p>
        </div>
        {preview.warnings.map((w, i) => <p key={i} className={'notice ' + (w.kind === 'conflict' || w.kind === 'pin_conflict' ? 'danger' : 'warn')} style={{ marginTop: 8 }}>{w.message}</p>)}

        <details style={{ marginTop: 10 }}>
          <summary>Détail ({actionable.length} changement{actionable.length > 1 ? 's' : ''}) — refuser une ligne la laisse telle quelle</summary>
          {actionable.length === 0 && <p className="muted">Aucun changement : le plan actuel tient.</p>}
          {actionable.map((c) => (
            <label key={c.key} className="change">
              <input type="checkbox" checked={selected.has(c.key)} onChange={(e) => setSelected((x) => { const n = new Set(x); e.target.checked ? n.add(c.key) : n.delete(c.key); return n; })} />
              <span>
                <span className="badge">{KIND_LABEL[c.kind]}</span> <strong>{label(c)}</strong>
                <br />
                <span className="small">
                  {c.from && <span className="diff-from">{range(c.from)}</span>} {c.from && c.to && '→ '} {c.to && range(c.to)}
                </span>
                <br />
                <span className="small muted">{c.reason}</span>
              </span>
            </label>
          ))}
          {preview.outcomes.filter((o) => o.outcome === 'unplanned' || o.outcome === 'arbitrage').length > 0 && (
            <>
              <h3>Non planifié ou à arbitrer</h3>
              <ul className="small">
                {preview.outcomes.filter((o) => o.outcome === 'unplanned' || o.outcome === 'arbitrage').map((o) => <li key={o.taskId}><strong>{o.title}</strong> — {o.reason}</li>)}
              </ul>
            </>
          )}
          {planToday.length > 0 && <p className="small muted">Plan du jour après application : {planToday.map((c) => `${fmtTime(c.start)} ${s.state.tasks.get(c.taskId)?.title ?? ''}`).join(' · ')}</p>}
        </details>
      </section>

      <div className="btn-row" style={{ marginTop: 14, position: 'sticky', bottom: -24, background: 'var(--bg)', padding: '10px 0' }}>
        <button className="btn primary" onClick={() => apply(true)} disabled={actionable.length === 0 && !facts.energy && !facts.availableUntil && facts.minutesLeft == null}>Tout appliquer</button>
        {selected.size !== actionable.length && <button className="btn" onClick={() => apply(false)}>Appliquer la sélection ({selected.size})</button>}
        <button className="btn ghost" onClick={onClose}>Ne rien changer</button>
      </div>
    </Sheet>
  );
}
