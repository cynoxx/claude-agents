import { useState } from 'react';
import { DateTime } from 'luxon';
import type { AreaStatus, Block, Deadline, ID, LearnState, Platform, PlatformState, Project, Task, Video, VideoWorkState } from '../core/types';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { wouldCreateCycle, remainingMinutes } from '../core/engine/planner';
import { effectiveDeadlineStatus, DEADLINE_STATUS_LABEL } from '../core/derive';
import { addDays, atLocal, fmtDay, fmtDuration, fmtRange, fmtTime, iso, localDate, minutesBetween } from '../core/time';
import { makeTask, newId } from '../core/factory';
import { parseOccurrenceId } from '../core/recurrence';
import { Sheet, Field, useAct, useNow, useUI, download, CATEGORY_LABEL } from './common';
import { deadlineIcs } from './ics-export';

export const STATUS_LABEL: Record<string, string> = { active: 'actif', paused: 'en pause', archived: 'archivé', to_confirm: 'à confirmer', history: 'historique' };
export const LEARN_LABEL: Record<LearnState, string> = { a_decouvrir: 'à découvrir', a_pratiquer: 'à pratiquer', a_revoir: 'à revoir', acquis: 'acquis' };
export const WORK_LABEL: Record<VideoWorkState, string> = { idee: 'idée', script: 'script', tournage: 'tournage', montage: 'montage', pret: 'prête', a_retoucher: 'à retoucher' };
export const PLATFORM_LABEL: Record<Platform, string> = { tiktok: 'TikTok', youtube: 'YouTube', shorts: 'YouTube Shorts', instagram: 'Instagram' };
const PSTATE_LABEL: Record<PlatformState, string> = { non_prevu: 'non prévue', prevu: 'prévue', programme: 'programmée', publie: 'publiée' };
const APP_LABEL = { piste: 'piste', contactee: 'contactée', a_relancer: 'à relancer', entretien: 'entretien', cloturee: 'clôturée' };

// ---------------------------------------------------------------- Tâche
export function TaskSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const s = useStore();
  const act = useAct();
  const now = useNow();
  const t0 = s.state.tasks.get(id);
  const [t, setT] = useState<Task | undefined>(t0);
  const [newStep, setNewStep] = useState('');
  const [planDate, setPlanDate] = useState(localDate(now));
  const [planTime, setPlanTime] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  if (!t0 || !t) return <Sheet title="Tâche introuvable" onClose={onClose}><p>Cette tâche n’existe plus.</p></Sheet>;
  const dirty = JSON.stringify(t) !== JSON.stringify(t0);
  const set = (p: Partial<Task>) => setT({ ...t, ...p });
  const projects = live(s.state.projects);
  const deadlines = live(s.state.deadlines).filter((d) => d.status !== 'history');
  const others = live(s.state.tasks).filter((x) => x.id !== id && ['open', 'in_progress', 'inbox'].includes(x.status));
  const blocks = live(s.state.blocks).filter((b) => b.taskId === id && b.kind === 'planned' && b.status !== 'cancelled').sort((a, b) => a.start.localeCompare(b.start));
  const isSubject = t.projectId && s.state.projects.get(t.projectId)?.kind === 'subject';
  async function save() {
    const patch: Partial<Task> = { ...t };
    if (t!.estimateMin !== t0!.estimateMin) patch.estimateSource = 'user';
    if (t!.title.trim() === '') { setMsg('Le titre ne peut pas être vide.'); return; }
    await act(() => A.updateTask(s, id, patch, 'Fiche enregistrée'));
  }
  return (
    <Sheet title={t0.title} onClose={() => { if (!dirty || confirm('Fermer sans enregistrer ?')) onClose(); }}>
      <div className="stack">
        <Field label="Titre"><input type="text" value={t.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="row small">
          <span className="badge">{{ inbox: 'à classer', open: 'à faire', in_progress: 'en cours', done: 'terminée', cancelled: 'abandonnée', archived: 'archivée' }[t0.status]}</span>
          {t0.source && <span className="muted">Provenance : {t0.source}</span>}
          {t0.estimateSource && <span className="muted">· durée {t0.estimateSource === 'user' ? 'donnée par toi' : 'proposée'}</span>}
        </div>
        <Field label="Prochaine étape concrète" hint="Ex. « Refaire sans le corrigé le premier exercice »"><input type="text" value={t.nextStep ?? ''} onChange={(e) => set({ nextStep: e.target.value || undefined })} /></Field>
        <div className="grid2">
          <Field label="Projet ou matière">
            <select value={t.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined })}>
              <option value="">—</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status !== 'active' ? ` (${STATUS_LABEL[p.status]})` : ''}</option>)}
            </select>
          </Field>
          <Field label="Échéance liée (contrôle, rendu…)">
            <select value={t.deadlineId ?? ''} onChange={(e) => set({ deadlineId: e.target.value || undefined })}>
              <option value="">—</option>
              {deadlines.map((d) => <option key={d.id} value={d.id}>{d.title} · {d.date}</option>)}
            </select>
          </Field>
          <Field label="Date limite" hint="Distincte du créneau planifié"><input type="date" value={t.dueDate ?? ''} onChange={(e) => set({ dueDate: e.target.value || undefined })} /></Field>
          <Field label="Heure limite (facultatif)"><input type="time" value={t.dueTime ?? ''} onChange={(e) => set({ dueTime: e.target.value || undefined })} /></Field>
          <Field label="Durée estimée (min)"><input type="number" min={0} step={5} value={t.estimateMin ?? ''} onChange={(e) => set({ estimateMin: e.target.value ? +e.target.value : undefined })} /></Field>
          <Field label="Reste (min)" hint={`Calculé : ${fmtDuration(remainingMinutes(t))}`}><input type="number" min={0} step={5} value={t.remainingMin ?? ''} onChange={(e) => set({ remainingMin: e.target.value ? +e.target.value : undefined })} /></Field>
          <Field label="Priorité manuelle">
            <select value={t.priority} onChange={(e) => set({ priority: +e.target.value })}>
              <option value={0}>normale</option><option value={1}>haute ★</option><option value={2}>très haute ★★</option>
            </select>
          </Field>
          <Field label="Séance minimale utile (min)"><input type="number" min={5} step={5} value={t.minChunkMin ?? ''} placeholder={String(s.state.prefs.defaultChunkMin)} onChange={(e) => set({ minChunkMin: e.target.value ? +e.target.value : undefined })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={!!t.continuous} onChange={(e) => set({ continuous: e.target.checked })} /><span>Bloc continu imposé (ne pas découper)</span></label>
        <label className="check"><input type="checkbox" checked={!!t.unblocks} onChange={(e) => set({ unblocks: e.target.checked })} /><span>Action qui débloque autre chose (passe en priorité)</span></label>
        {(isSubject || t.learnState) && (
          <div className="row"><span className="small muted">État :</span>{(Object.keys(LEARN_LABEL) as LearnState[]).map((k) => <button key={k} className="chip" aria-pressed={t.learnState === k} onClick={() => set({ learnState: k })}>{LEARN_LABEL[k]}</button>)}</div>
        )}

        <h3>Étapes</h3>
        <ul className="tasklist">
          {t.steps.map((st) => (
            <li key={st.id}>
              <button className="tick" aria-pressed={st.done} aria-label={`Étape ${st.title} ${st.done ? 'faite' : 'à faire'}`} onClick={() => set({ steps: t.steps.map((x) => (x.id === st.id ? { ...x, done: !x.done } : x)) })}>{st.done ? '✓' : ''}</button>
              <span className="grow">{st.title}</span>
              <input type="number" aria-label="Durée de l’étape (min)" placeholder="min" style={{ width: 72 }} value={st.estimateMin ?? ''} onChange={(e) => set({ steps: t.steps.map((x) => (x.id === st.id ? { ...x, estimateMin: e.target.value ? +e.target.value : undefined } : x)) })} />
              <button className="btn small ghost" aria-label={`Supprimer l’étape ${st.title}`} onClick={() => set({ steps: t.steps.filter((x) => x.id !== st.id) })}>✕</button>
            </li>
          ))}
        </ul>
        <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (newStep.trim()) { set({ steps: [...t.steps, { id: newId('st'), title: newStep.trim(), done: false }] }); setNewStep(''); } }}>
          <input type="text" placeholder="Ajouter une étape" value={newStep} onChange={(e) => setNewStep(e.target.value)} />
          <button className="btn" type="submit">Ajouter</button>
        </form>

        <h3>Dépend de</h3>
        {t.dependsOn.map((d) => <div key={d} className="row small"><span className="grow">{s.state.tasks.get(d)?.title ?? 'tâche supprimée'}</span><button className="btn small ghost" onClick={() => set({ dependsOn: t.dependsOn.filter((x) => x !== d) })}>Retirer</button></div>)}
        <select aria-label="Ajouter une dépendance" value="" onChange={(e) => {
          const d = e.target.value;
          if (!d) return;
          if (wouldCreateCycle(live(s.state.tasks).map((x) => (x.id === id ? t : x)), id, d)) { setMsg('Impossible : cela créerait une dépendance circulaire.'); return; }
          set({ dependsOn: [...t.dependsOn, d] });
        }}>
          <option value="">+ Ajouter une tâche préalable</option>
          {others.filter((o) => !t.dependsOn.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
        </select>
        <Field label="Notes, consigne"><textarea value={t.notes ?? ''} onChange={(e) => set({ notes: e.target.value || undefined })} /></Field>
        {msg && <p className="notice warn" role="alert">{msg}</p>}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty} onClick={save}>Enregistrer</button>
          {dirty && <button className="btn ghost" onClick={() => setT(t0)}>Annuler les modifications</button>}
        </div>

        <h3>Créneaux</h3>
        {blocks.length === 0 ? <p className="small muted">Aucun créneau planifié : la tâche est dans la liste.</p> : (
          <ul className="small">{blocks.map((b) => <li key={b.id}>{fmtDay(b.start.slice(0, 10), localDate(now))} {fmtRange(DateTime.fromISO(b.start).setZone(s.state.prefs.tz), DateTime.fromISO(b.end).setZone(s.state.prefs.tz))} · {b.status === 'done' ? 'fait' : b.status === 'missed' ? 'manqué' : DateTime.fromISO(b.end) < now ? 'passé' : 'validé'}{b.stepTitle ? ` · ${b.stepTitle}` : ''}</li>)}</ul>
        )}
        <div className="row">
          <input type="date" aria-label="Date du créneau" value={planDate} onChange={(e) => setPlanDate(e.target.value)} style={{ width: 160 }} />
          <input type="time" aria-label="Heure (facultatif)" value={planTime} onChange={(e) => setPlanTime(e.target.value)} style={{ width: 120 }} />
          <button className="btn" onClick={async () => { const r = await act(() => A.scheduleTask(s, id, planDate, planTime || undefined)); if (r && !r.ok) setMsg(r.reason); }}>{planTime ? 'Épingler à cette heure' : 'Premier créneau libre ce jour'}</button>
          {blocks.some((b) => DateTime.fromISO(b.end) > now && b.status === 'accepted') && <button className="btn ghost" onClick={() => act(() => A.deferTask(s, id))}>Remettre dans la liste</button>}
        </div>
        {t0.sessions.length > 0 && (
          <>
            <h3>Travail déclaré</h3>
            <p className="small muted">{fmtDuration(t0.spentMin)} au total · {t0.sessions.map((x) => `${x.start.slice(5, 10)} ${x.minutes ?? '…'} min${x.note ? ` (${x.note})` : ''}`).join(' · ')}</p>
          </>
        )}
        <h3>Actions</h3>
        <div className="btn-row">
          {t0.status !== 'done' && <button className="btn" onClick={() => act(() => A.markDone(s, id))}>Marquer fait</button>}
          {['done', 'archived', 'cancelled'].includes(t0.status) && <button className="btn" onClick={() => act(() => A.setTaskStatus(s, id, 'open'))}>Rouvrir</button>}
          {t0.status === 'inbox' && <button className="btn" onClick={() => act(() => A.setTaskStatus(s, id, 'open'))}>Classer en « à faire »</button>}
          {t0.status !== 'archived' && <button className="btn ghost" onClick={() => act(() => A.setTaskStatus(s, id, 'archived'))}>Archiver</button>}
          <button className="btn ghost danger" onClick={() => { act(() => s.commit(`Supprimé : ${t0.title}`, 'action', [{ store: 'tasks', next: { ...t0, deletedAt: s.nowIso() } }])); onClose(); }}>Supprimer</button>
        </div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Échéance / contrôle
const PREP_SUGGESTIONS = ['Repérer les notions évaluées', 'Tenter un exercice sans corrigé', 'Refaire l’exercice après correction', 'S’auto-tester sur les définitions'];

export function DeadlineSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const s = useStore();
  const ui = useUI();
  const act = useAct();
  const now = useNow();
  const d0 = s.state.deadlines.get(id);
  const [d, setD] = useState<Deadline | undefined>(d0);
  const [intervals, setIntervals] = useState('1, 3, 7');
  const [workDay, setWorkDay] = useState(localDate(now));
  if (!d0 || !d) return <Sheet title="Échéance introuvable" onClose={onClose}><p>Elle n’existe plus.</p></Sheet>;
  const set = (p: Partial<Deadline>) => setD({ ...d, ...p });
  const dirty = JSON.stringify(d) !== JSON.stringify(d0);
  const linked = live(s.state.tasks).filter((t) => t.deadlineId === id);
  const subjects = live(s.state.projects).filter((p) => p.kind === 'subject');
  const eff = effectiveDeadlineStatus(d0, now);
  async function addPrep(title: string, minutes = 25) {
    await act(() => s.commit(`Préparation ajoutée : ${title}`, 'action', [{ store: 'tasks', next: makeTask(s.nowIso(), { title, deadlineId: id, projectId: d0!.subjectId, kind: 'prep', estimateMin: minutes, estimateSource: 'default' }) }]));
  }
  async function spaced() {
    const days = intervals.split(/[,\s]+/).map(Number).filter((x) => x > 0);
    const writes = days.map((n) => ({ store: 'tasks' as const, next: makeTask(s.nowIso(), { title: `Révision espacée J+${n} : ${d0!.title}`, dueDate: addDays(workDay, n), projectId: d0!.subjectId, kind: 'prep', estimateMin: 20, estimateSource: 'default', notes: `Séance espacée à partir du jour de travail réel ${workDay}. Modifiable ou supprimable.` }) }));
    await act(() => s.commit(`Révisions espacées (${days.join(', ')})`, 'action', writes));
  }
  return (
    <Sheet title={d0.title} onClose={() => { if (!dirty || confirm('Fermer sans enregistrer ?')) onClose(); }}>
      <div className="stack">
        <div className="row small">
          <span className={'badge ' + (eff === 'to_fill' ? 'warn' : '')}>{DEADLINE_STATUS_LABEL[eff]}</span>
          {!d0.time && <span className="badge warn">heure inconnue</span>}
          {!d0.dateConfirmed && <span className="badge warn">date à confirmer</span>}
          {d0.source && <span className="muted">Provenance : {d0.source}</span>}
        </div>
        <Field label="Titre"><input type="text" value={d.title} onChange={(e) => set({ title: e.target.value })} /></Field>
        <div className="grid2">
          <Field label="Type">
            <select value={d.kind} onChange={(e) => set({ kind: e.target.value as Deadline['kind'] })}>
              {['controle', 'rattrapage', 'tp', 'rendu', 'admin', 'business', 'rdv', 'autre'].map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
          </Field>
          <Field label="Matière">
            <select value={d.subjectId ?? ''} onChange={(e) => set({ subjectId: e.target.value || undefined })}>
              <option value="">—</option>
              {subjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <Field label="Date" hint="Date officielle : ne la change que si tu as une nouvelle date connue"><input type="date" value={d.date} onChange={(e) => set({ date: e.target.value })} /></Field>
          <Field label="Heure (vide = inconnue)"><input type="time" value={d.time ?? ''} onChange={(e) => set({ time: e.target.value || undefined })} /></Field>
          <Field label="Durée (min)"><input type="number" value={d.durationMin ?? ''} onChange={(e) => set({ durationMin: e.target.value ? +e.target.value : undefined })} /></Field>
          <Field label="Lieu"><input type="text" value={d.location ?? ''} onChange={(e) => set({ location: e.target.value || undefined })} /></Field>
          <Field label="Importance">
            <select value={d.importance} onChange={(e) => set({ importance: e.target.value as Deadline['importance'] })}><option value="haute">haute</option><option value="normale">normale</option></select>
          </Field>
          <Field label="Statut">
            <select value={d.status} onChange={(e) => set({ status: e.target.value as Deadline['status'] })}>
              {Object.entries(DEADLINE_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        </div>
        <label className="check"><input type="checkbox" checked={d.dateConfirmed} onChange={(e) => set({ dateConfirmed: e.target.checked })} /><span>Date confirmée</span></label>
        <Field label="Chapitres concernés"><textarea value={d.chapters ?? ''} onChange={(e) => set({ chapters: e.target.value || undefined })} /></Field>
        {(eff === 'to_fill' || d0.status === 'done') && <Field label="Résultat (facultatif)"><input type="text" value={d.result ?? ''} onChange={(e) => set({ result: e.target.value || undefined })} /></Field>}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty} onClick={() => act(() => A.updateDeadline(s, id, d, 'Échéance enregistrée'))}>Enregistrer</button>
          <button className="btn ghost" onClick={() => download(`${d0.title}.ics`, deadlineIcs([d0], s.state.prefs.tz, s.nowIso()), 'text/calendar')}>Ajouter à mon agenda (.ics)</button>
        </div>

        <h3>Préparation ({linked.filter((t) => t.status !== 'done').length} ouverte·s)</h3>
        <ul className="tasklist">
          {linked.map((t) => (
            <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
              <button className="tick" aria-pressed={t.status === 'done'} aria-label={`Basculer ${t.title}`} onClick={() => act(() => (t.status === 'done' ? A.setTaskStatus(s, t.id, 'open') : A.markDone(s, t.id)))}>{t.status === 'done' ? '✓' : ''}</button>
              <button className="open" onClick={() => ui.openTask(t.id)}><span className="t">{t.title}</span><span className="small muted">{fmtDuration(remainingMinutes(t))}{t.learnState ? ` · ${LEARN_LABEL[t.learnState]}` : ''}</span></button>
            </li>
          ))}
        </ul>
        <div className="btn-row">{PREP_SUGGESTIONS.map((p) => <button key={p} className="btn small" onClick={() => addPrep(p)}>+ {p}</button>)}</div>
        <details>
          <summary>Révision espacée (facultatif)</summary>
          <div className="row" style={{ marginTop: 6 }}>
            <Field label="Intervalles (jours)"><input type="text" value={intervals} onChange={(e) => setIntervals(e.target.value)} /></Field>
            <Field label="À partir du jour de travail réel"><input type="date" value={workDay} onChange={(e) => setWorkDay(e.target.value)} /></Field>
          </div>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => setIntervals('1, 3, 7, 15, 30')}>Ancien profil J+1, 3, 7, 15, 30</button>
            <button className="btn small primary" onClick={spaced}>Créer les séances</button>
          </div>
          <p className="small muted">Chaque séance est une tâche ordinaire : modifie-la ou supprime-la librement.</p>
        </details>
        <div className="btn-row"><button className="btn ghost danger" onClick={() => { act(() => s.commit(`Supprimé : ${d0.title}`, 'action', [{ store: 'deadlines', next: { ...d0, deletedAt: s.nowIso() } }])); onClose(); }}>Supprimer l’échéance (les tâches liées restent)</button></div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Projet, matière, candidature, marque
export function ProjectSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const s = useStore();
  const ui = useUI();
  const act = useAct();
  const p0 = s.state.projects.get(id);
  const [p, setP] = useState<Project | undefined>(p0);
  const [note, setNote] = useState('');
  const [chapter, setChapter] = useState('');
  if (!p0 || !p) return <Sheet title="Projet introuvable" onClose={onClose}><p>Il n’existe plus.</p></Sheet>;
  const set = (x: Partial<Project>) => setP({ ...p, ...x });
  const dirty = JSON.stringify(p) !== JSON.stringify(p0);
  const tasks = live(s.state.tasks).filter((t) => t.projectId === id);
  const openTasks = tasks.filter((t) => ['open', 'in_progress', 'inbox'].includes(t.status) && t.kind !== 'chapter');
  const chapters = tasks.filter((t) => t.kind === 'chapter');
  const dls = live(s.state.deadlines).filter((d) => d.subjectId === id || d.projectId === id);
  const videos = live(s.state.videos).filter((v) => v.projectId === id);
  const today = localDate(s.clock().setZone(s.state.prefs.tz));
  return (
    <Sheet title={p0.name} onClose={() => { if (!dirty || confirm('Fermer sans enregistrer ?')) onClose(); }}>
      <div className="stack">
        {p0.source && <p className="small muted" style={{ margin: 0 }}>Provenance : {p0.source}</p>}
        <div className="grid2">
          <Field label="Nom"><input type="text" value={p.name} onChange={(e) => set({ name: e.target.value })} /></Field>
          <Field label="Type">
            <select value={p.kind} onChange={(e) => set({ kind: e.target.value as Project['kind'] })}>
              <option value="general">projet</option><option value="subject">matière</option><option value="application">candidature</option><option value="brand">marque / contenus</option><option value="book">livre</option><option value="shop">boutique</option>
            </select>
          </Field>
          <Field label="Domaine">
            <select value={p.areaId ?? ''} onChange={(e) => set({ areaId: e.target.value || undefined })}>
              <option value="">—</option>
              {live(s.state.areas).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Statut">
            <select value={p.status} onChange={(e) => set({ status: e.target.value as AreaStatus })}>
              {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Date cible"><input type="date" value={p.targetDate ?? ''} onChange={(e) => set({ targetDate: e.target.value || undefined })} /></Field>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={p.targetConfirmed !== false} onChange={(e) => set({ targetConfirmed: e.target.checked })} /><span>Date cible confirmée</span></label>
        </div>
        <Field label="Prochaine action"><input type="text" value={p.nextAction ?? ''} onChange={(e) => set({ nextAction: e.target.value || undefined })} /></Field>
        {p.kind === 'application' && (
          <>
            <div className="row"><span className="small muted">Candidature :</span>{(Object.keys(APP_LABEL) as (keyof typeof APP_LABEL)[]).map((k) => <button key={k} className="chip" aria-pressed={p.applicationStatus === k} onClick={() => set({ applicationStatus: k })}>{APP_LABEL[k]}</button>)}</div>
            <div className="grid2">
              <Field label="Entreprise"><input type="text" value={p.company ?? ''} onChange={(e) => set({ company: e.target.value || undefined })} /></Field>
              <Field label="Contact (facultatif)"><input type="text" value={p.contact ?? ''} onChange={(e) => set({ contact: e.target.value || undefined })} /></Field>
              <Field label="Date de relance (facultatif)"><input type="date" value={p.followUpDate ?? ''} onChange={(e) => set({ followUpDate: e.target.value || undefined })} /></Field>
            </div>
            <p className="small muted" style={{ margin: 0 }}>Une note ne vaut pas candidature envoyée : passe en « contactée » quand c’est fait.</p>
            {p.followUpDate && <button className="btn small" onClick={() => act(() => A.createTask(s, { title: `Relancer ${p.company ?? p.name}`, projectId: id, dueDate: p.followUpDate, estimateMin: 15, kind: 'followup' }))}>Créer la tâche de relance</button>}
          </>
        )}
        {(p.kind === 'brand' || p.kind === 'shop' || p.kind === 'book') && (
          <div className="grid2">
            <Field label="Montant prévu (€)"><input type="number" value={p.plannedSpendEur ?? ''} onChange={(e) => set({ plannedSpendEur: e.target.value ? +e.target.value : undefined })} /></Field>
            <Field label="Coût déclaré des outils (€)"><input type="number" value={p.declaredToolCostEur ?? ''} onChange={(e) => set({ declaredToolCostEur: e.target.value ? +e.target.value : undefined })} /></Field>
          </div>
        )}
        <div className="btn-row">
          <button className="btn primary" disabled={!dirty} onClick={() => act(() => A.upsertProject(s, p))}>Enregistrer</button>
        </div>

        {dls.length > 0 && <><h3>Échéances</h3><ul className="small">{dls.map((d) => <li key={d.id}><button className="btn small ghost" onClick={() => ui.openDeadline(d.id)}>{d.title} · {d.date}{d.time ? ' ' + d.time : ''} · {DEADLINE_STATUS_LABEL[d.status]}</button></li>)}</ul></>}
        <h3>Tâches ouvertes</h3>
        {openTasks.length === 0 ? <p className="small muted">Aucune.</p> : <ul className="small">{openTasks.map((t) => <li key={t.id}><button className="btn small ghost" onClick={() => ui.openTask(t.id)}>{t.title}</button></li>)}</ul>}
        <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); const v = (e.currentTarget.elements.namedItem('nt') as HTMLInputElement).value.trim(); if (v) { act(() => A.createTask(s, { title: v, projectId: id })); (e.currentTarget.elements.namedItem('nt') as HTMLInputElement).value = ''; } }}>
          <input name="nt" type="text" placeholder="Nouvelle tâche dans ce projet" /><button className="btn" type="submit">Ajouter</button>
        </form>

        {p.kind === 'subject' && (
          <>
            <h3>Points à rattraper</h3>
            <ul className="tasklist">
              {chapters.map((c) => (
                <li key={c.id}>
                  <button className="open" onClick={() => ui.openTask(c.id)}><span className="t">{c.title}</span><span className="small muted">{fmtDuration(remainingMinutes(c))}</span></button>
                  <select aria-label={`État de ${c.title}`} style={{ width: 'auto' }} value={c.learnState ?? 'a_decouvrir'} onChange={(e) => act(() => A.updateTask(s, c.id, { learnState: e.target.value as LearnState, status: e.target.value === 'acquis' ? 'done' : 'open' }, 'État modifié'))}>
                    {(Object.keys(LEARN_LABEL) as LearnState[]).map((k) => <option key={k} value={k}>{LEARN_LABEL[k]}</option>)}
                  </select>
                </li>
              ))}
            </ul>
            <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (chapter.trim()) { act(() => A.createTask(s, { title: chapter.trim(), projectId: id, kind: 'chapter', learnState: 'a_decouvrir', estimateMin: 120, priority: 0 })); setChapter(''); } }}>
              <input type="text" placeholder="Chapitre ou exercice à reprendre" value={chapter} onChange={(e) => setChapter(e.target.value)} /><button className="btn" type="submit">Ajouter</button>
            </form>
          </>
        )}

        {videos.length > 0 && <><h3>Vidéos</h3><ul className="small">{videos.map((v) => <li key={v.id}>{v.title} · {WORK_LABEL[v.workState]} · {Object.entries(v.platforms).filter(([, x]) => x).map(([k, x]) => `${PLATFORM_LABEL[k as Platform]} ${PSTATE_LABEL[x!.state]}`).join(', ') || 'aucune plateforme'}</li>)}</ul></>}

        <h3>Notes datées</h3>
        {p0.notes.length === 0 && <p className="small muted">Aucune note.</p>}
        <ul className="small">{[...p0.notes].sort((a, b) => b.date.localeCompare(a.date)).map((n) => <li key={n.id}><span className="muted">{n.date}</span> — {n.text}{n.source ? <span className="muted"> ({n.source})</span> : null}</li>)}</ul>
        <form className="row nowrap" onSubmit={(e) => { e.preventDefault(); if (note.trim()) { act(() => A.upsertProject(s, { ...p0, notes: [...p0.notes, { id: newId('n'), date: today, text: note.trim() }] }, 'Note ajoutée')); setNote(''); } }}>
          <input type="text" placeholder="Ajouter une note (consigne, règle de format, observation…)" value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn" type="submit">Ajouter</button>
        </form>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Vidéo
export function VideoSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const s = useStore();
  const act = useAct();
  const v0 = s.state.videos.get(id);
  const [v, setV] = useState<Video | undefined>(v0);
  const [metric, setMetric] = useState<{ platform: Platform; views: string; date: string; days: string }>({ platform: 'tiktok', views: '', date: localDate(s.clock().setZone(s.state.prefs.tz)), days: '' });
  if (!v0 || !v) return <Sheet title="Vidéo introuvable" onClose={onClose}><p>Elle n’existe plus.</p></Sheet>;
  const set = (x: Partial<Video>) => setV({ ...v, ...x });
  const dirty = JSON.stringify(v) !== JSON.stringify(v0);
  const brands = live(s.state.projects).filter((p) => ['brand', 'book', 'shop'].includes(p.kind));
  const comparable = (() => {
    const byDays = new Map<string, number>();
    for (const m of v0.metrics) if (m.daysAfterPublish != null) byDays.set(`${m.platform}:${m.daysAfterPublish}`, (byDays.get(`${m.platform}:${m.daysAfterPublish}`) ?? 0) + 1);
    return [...byDays.values()].some((n) => n > 0);
  })();
  return (
    <Sheet title={v0.title} onClose={() => { if (!dirty || confirm('Fermer sans enregistrer ?')) onClose(); }}>
      <div className="stack">
        <div className="grid2">
          <Field label="Titre"><input type="text" value={v.title} onChange={(e) => set({ title: e.target.value })} /></Field>
          <Field label="Projet">
            <select value={v.projectId ?? ''} onChange={(e) => set({ projectId: e.target.value || undefined })}><option value="">—</option>{brands.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          </Field>
          <Field label="Format"><input type="text" value={v.format ?? ''} placeholder="ex. vertical 45 s" onChange={(e) => set({ format: e.target.value || undefined })} /></Field>
          <Field label="État de travail">
            <select value={v.workState} onChange={(e) => set({ workState: e.target.value as VideoWorkState })}>{Object.entries(WORK_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </Field>
          <Field label="Prochaine étape"><input type="text" value={v.nextStep ?? ''} onChange={(e) => set({ nextStep: e.target.value || undefined })} /></Field>
          <Field label="Lien local ou privé vers les fichiers"><input type="text" value={v.fileLink ?? ''} onChange={(e) => set({ fileLink: e.target.value || undefined })} /></Field>
          <Field label="Variante d’accroche"><input type="text" value={v.hookVariant ?? ''} onChange={(e) => set({ hookVariant: e.target.value || undefined })} /></Field>
          <Field label="Coût (€, facultatif)"><input type="number" value={v.costEur ?? ''} onChange={(e) => set({ costEur: e.target.value ? +e.target.value : undefined })} /></Field>
        </div>
        <h3>Par plateforme</h3>
        <p className="small muted" style={{ margin: 0 }}>États saisis par toi : Max ne publie rien et ne lit aucun compte.</p>
        <table className="simple">
          <tbody>
            {(Object.keys(PLATFORM_LABEL) as Platform[]).map((k) => {
              const ps = v.platforms[k] ?? { state: 'non_prevu' as PlatformState };
              return (
                <tr key={k}>
                  <th scope="row">{PLATFORM_LABEL[k]}</th>
                  <td><select aria-label={`État ${PLATFORM_LABEL[k]}`} value={ps.state} onChange={(e) => set({ platforms: { ...v.platforms, [k]: { ...ps, state: e.target.value as PlatformState, source: 'saisi' } } })}>{Object.entries(PSTATE_LABEL).map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select></td>
                  <td><input type="date" aria-label={`Date ${PLATFORM_LABEL[k]}`} value={ps.date ?? ''} onChange={(e) => set({ platforms: { ...v.platforms, [k]: { ...ps, date: e.target.value || undefined } } })} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="btn-row"><button className="btn primary" disabled={!dirty} onClick={() => act(() => s.commit(`Vidéo enregistrée : ${v.title}`, 'action', [{ store: 'videos', next: v }]))}>Enregistrer</button></div>
        <h3>Mesures saisies</h3>
        {!comparable && <p className="notice small">Pas encore de données comparables : pour comparer deux accroches, note les vues au même délai après publication (ex. J+3) sur la même plateforme.</p>}
        <ul className="small">{v0.metrics.map((m) => <li key={m.id}>{m.date} · {PLATFORM_LABEL[m.platform]} · {m.views ?? '?'} vues{m.daysAfterPublish != null ? ` à J+${m.daysAfterPublish}` : ''} · source : {m.source}</li>)}</ul>
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (!metric.views) return; act(() => s.commit('Mesure ajoutée', 'action', [{ store: 'videos', next: { ...v0, metrics: [...v0.metrics, { id: newId('m'), date: metric.date, platform: metric.platform, views: +metric.views, daysAfterPublish: metric.days ? +metric.days : undefined, source: 'saisie manuelle' }] } }])); setMetric({ ...metric, views: '' }); }}>
          <select aria-label="Plateforme" style={{ width: 'auto' }} value={metric.platform} onChange={(e) => setMetric({ ...metric, platform: e.target.value as Platform })}>{Object.entries(PLATFORM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <input type="number" aria-label="Vues" placeholder="vues" style={{ width: 100 }} value={metric.views} onChange={(e) => setMetric({ ...metric, views: e.target.value })} />
          <input type="number" aria-label="Jours après publication" placeholder="J+" style={{ width: 70 }} value={metric.days} onChange={(e) => setMetric({ ...metric, days: e.target.value })} />
          <input type="date" aria-label="Date du relevé" style={{ width: 160 }} value={metric.date} onChange={(e) => setMetric({ ...metric, date: e.target.value })} />
          <button className="btn" type="submit">Ajouter</button>
        </form>
        <div className="btn-row"><button className="btn ghost danger" onClick={() => { act(() => s.commit(`Supprimée : ${v0.title}`, 'action', [{ store: 'videos', next: { ...v0, deletedAt: s.nowIso() } }])); onClose(); }}>Supprimer la fiche</button></div>
      </div>
    </Sheet>
  );
}

// ---------------------------------------------------------------- Bloc d'agenda
export function BlockSheet({ block, onClose }: { block: Block; onClose: () => void }) {
  const s = useStore();
  const act = useAct();
  const tz = s.state.prefs.tz;
  const st = DateTime.fromISO(block.start).setZone(tz);
  const en = DateTime.fromISO(block.actualEnd ?? block.end).setZone(tz);
  const [title, setTitle] = useState(block.title);
  const [date, setDate] = useState(st.toISODate()!);
  const [start, setStart] = useState(st.toFormat('HH:mm'));
  const [dur, setDur] = useState(minutesBetween(st, en));
  const [protection, setProtection] = useState(block.protection);
  const [category, setCategory] = useState(block.category);
  const occ = parseOccurrenceId(block.id);
  const alts = A.slotsFor(s, date, dur, block.id);
  const task = block.taskId ? s.state.tasks.get(block.taskId) : undefined;
  async function save(ns?: DateTime) {
    const sd = ns ?? atLocal(date, start, tz);
    await act(() => A.updateBlock(s, block.id, { title, start: iso(sd), end: iso(sd.plus({ minutes: dur })), actualEnd: undefined, protection, category }, ns ? 'Déplacé' : 'Bloc modifié'));
    onClose();
  }
  const kindLabel = block.kind === 'planned' ? 'Bloc planifié (validé)' : block.kind === 'external' ? 'Événement externe' : block.kind === 'protected' ? 'Temps protégé' : 'Engagement fixe';
  return (
    <Sheet title={block.private ? 'Temps privé' : block.title} onClose={onClose}>
      <div className="stack">
        <p className="small" style={{ margin: 0 }}>
          <span className="badge">{kindLabel}</span> <span className="badge">{protection === 'locked' ? 'verrouillé' : 'déplaçable'}</span> <span className="muted">Source : {block.source ?? block.origin}{occ ? ' · occurrence d’une série' : ''}</span>
        </p>
        {task && <p className="small" style={{ margin: 0 }}>Tâche : {task.title}{block.stepTitle ? ` — étape : ${block.stepTitle}` : ''}</p>}
        {!block.taskId && <Field label="Titre"><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>}
        <div className="grid2">
          <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Début"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="Durée (min)"><input type="number" min={5} step={5} value={dur} onChange={(e) => setDur(+e.target.value)} /></Field>
          <Field label="Catégorie"><select value={category} onChange={(e) => setCategory(e.target.value as Block['category'])}>{Object.entries(CATEGORY_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        </div>
        <label className="check"><input type="checkbox" checked={protection === 'locked'} onChange={(e) => setProtection(e.target.checked ? 'locked' : 'flexible')} /><span>Verrouillé : Max ne le déplace jamais</span></label>
        <div className="btn-row">
          <button className="btn primary" onClick={() => save()}>Enregistrer{occ ? ' (cette occurrence)' : ''}</button>
        </div>
        <h3>Déplacer vers un créneau libre ({fmtDay(date, localDate(s.clock().setZone(tz)))})</h3>
        {alts.length === 0 ? <p className="small muted">Aucun créneau libre de {dur} min ce jour-là. Change la date ci-dessus.</p> : (
          <div className="btn-row">{alts.map((a) => <button key={a.start.toISO()} className="btn small" onClick={() => save(a.start)}>{fmtRange(a.start, a.end)}</button>)}</div>
        )}
        <h3>Autres actions</h3>
        <div className="btn-row">
          {block.kind !== 'planned' && <button className="btn ghost" onClick={() => { act(() => A.updateBlock(s, block.id, { status: 'cancelled' }, 'Annulé')); onClose(); }}>Annuler cet événement{occ ? ' (cette fois)' : ''}</button>}
          {block.kind === 'planned' && task && <button className="btn ghost" onClick={() => { act(() => A.deferTask(s, task.id)); onClose(); }}>Remettre la tâche dans la liste</button>}
          {!occ && <button className="btn ghost danger" onClick={() => { act(() => s.commit(`Supprimé : ${block.title}`, 'action', [{ store: 'blocks', next: { ...s.state.blocks.get(block.id)!, deletedAt: s.nowIso() } }])); onClose(); }}>Supprimer</button>}
          {occ && <button className="btn ghost danger" onClick={() => { const r = s.state.recurrences.get(occ.recId); if (r && confirm(`Arrêter toute la série « ${r.title} » à partir d’aujourd’hui ?`)) { act(() => s.commit(`Série arrêtée : ${r.title}`, 'action', [{ store: 'recurrences', next: { ...r, until: addDays(localDate(s.clock().setZone(tz)), -1) } }])); onClose(); } }}>Arrêter la série</button>}
        </div>
        <p className="small muted">Heure locale ({tz}) {fmtTime(st)}.</p>
      </div>
    </Sheet>
  );
}
