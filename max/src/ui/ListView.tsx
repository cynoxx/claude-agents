import { useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { norm } from '../core/nlu/parse';
import { effectiveDeadlineStatus, DEADLINE_STATUS_LABEL } from '../core/derive';
import { fmtDay, fmtDuration, fmtTime, localDate } from '../core/time';
import { remainingMinutes } from '../core/engine/planner';
import type { Task, Video } from '../core/types';
import { useAct, useUI, go, useNow } from './common';
import { CaptureResult } from './Capture';
import { VideoSheet, ProjectSheet, PLATFORM_LABEL, WORK_LABEL, STATUS_LABEL } from './Sheets';
import { makeVideo } from '../core/factory';

const FILTERS = [
  ['inbox', 'Boîte de réception'],
  ['todo', 'À faire'],
  ['dated', 'Datées'],
  ['echeances', 'Échéances'],
  ['projets', 'Projets'],
  ['videos', 'Vidéos'],
  ['done', 'Terminées'],
  ['archives', 'Archives'],
] as const;

export function ListView({ filter }: { filter?: string }) {
  const s = useStore();
  const ui = useUI();
  const act = useAct();
  const now = useNow();
  const today = localDate(now);
  const [q, setQ] = useState('');
  const [area, setArea] = useState<string | null>(null);
  const f = filter ?? 'todo';
  const areas = live(s.state.areas).filter((a) => a.status !== 'archived');
  const projects = new Map(live(s.state.projects).map((p) => [p.id, p]));
  const plannedNext = useMemo(() => {
    const m = new Map<string, DateTime>();
    for (const b of live(s.state.blocks)) {
      if (b.kind !== 'planned' || b.status !== 'accepted' || !b.taskId) continue;
      const st = DateTime.fromISO(b.end);
      if (st < now) continue;
      const cur = m.get(b.taskId);
      const start = DateTime.fromISO(b.start).setZone(s.state.prefs.tz);
      if (!cur || start < cur) m.set(b.taskId, start);
    }
    return m;
  }, [s.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps

  const matchQ = (text: string) => !q || norm(text).includes(norm(q));
  const inArea = (t: Task) => !area || t.areaId === area || (t.projectId && projects.get(t.projectId)?.areaId === area);
  let tasks = live(s.state.tasks).filter((t) => matchQ(t.title + ' ' + (t.nextStep ?? '') + ' ' + (t.notes ?? '')) && inArea(t));
  if (f === 'inbox') tasks = tasks.filter((t) => t.status === 'inbox');
  else if (f === 'todo') tasks = tasks.filter((t) => ['open', 'in_progress', 'inbox'].includes(t.status));
  else if (f === 'dated') tasks = tasks.filter((t) => ['open', 'in_progress', 'inbox'].includes(t.status) && (t.dueDate || t.deadlineId));
  else if (f === 'done') tasks = tasks.filter((t) => t.status === 'done');
  else if (f === 'archives') tasks = tasks.filter((t) => t.status === 'archived' || t.status === 'cancelled');
  const due = (t: Task) => t.dueDate ?? (t.deadlineId ? s.state.deadlines.get(t.deadlineId)?.date : undefined);
  tasks.sort((a, b) => (a.status === 'in_progress' ? -1 : 0) - (b.status === 'in_progress' ? -1 : 0) || (due(a) ?? '9999').localeCompare(due(b) ?? '9999') || b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt));
  const captures = live(s.state.captures).filter((c) => ['needs_input', 'failed', 'new', 'partial'].includes(c.status) && matchQ(c.text)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div>
      <h1>Liste</h1>
      <label htmlFor="search" className="sr-only">Rechercher</label>
      <input id="search" type="search" placeholder="Rechercher une tâche, un projet, une échéance…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" role="toolbar" aria-label="Filtres">
        {FILTERS.map(([k, l]) => (
          <button key={k} className="chip" aria-pressed={f === k} onClick={() => go('liste/' + k)}>
            {l}{k === 'inbox' && captures.length + live(s.state.tasks).filter((t) => t.status === 'inbox').length > 0 ? ` (${captures.length + live(s.state.tasks).filter((t) => t.status === 'inbox').length})` : ''}
          </button>
        ))}
      </div>
      {!['projets', 'videos', 'echeances'].includes(f) && areas.length > 0 && (
        <div className="chips" role="toolbar" aria-label="Domaines">
          <button className="chip" aria-pressed={!area} onClick={() => setArea(null)}>Tous domaines</button>
          {areas.map((a) => <button key={a.id} className="chip" aria-pressed={area === a.id} onClick={() => setArea(a.id)}>{a.name}{a.status === 'paused' ? ' (pause)' : ''}</button>)}
        </div>
      )}

      {f === 'inbox' && captures.length > 0 && (
        <section>
          <h2>Phrases à traiter</h2>
          {captures.map((c) => (
            <div key={c.id} className="card">
              <CaptureResult cap={c} />
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button className="btn small ghost" onClick={() => act(() => A.dismissCapture(s, c.id), 'Capture classée')}>Classer sans action</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {f === 'projets' ? <ProjectsList q={q} /> : f === 'videos' ? <VideosList q={q} /> : f === 'echeances' ? <DeadlinesList q={q} /> : (
        <>
          {tasks.length === 0 && <p className="muted">{f === 'inbox' ? 'Boîte de réception vide.' : 'Rien ici.'}</p>}
          <ul className="tasklist">
            {tasks.map((t) => {
              const d = due(t);
              const pl = plannedNext.get(t.id);
              const pr = t.projectId ? projects.get(t.projectId) : undefined;
              return (
                <li key={t.id} className={t.status === 'done' ? 'done' : ''}>
                  <button className="tick" aria-pressed={t.status === 'done'} aria-label={t.status === 'done' ? `Rouvrir « ${t.title} »` : `Marquer « ${t.title} » comme fait`} onClick={() => act(() => (t.status === 'done' ? A.setTaskStatus(s, t.id, 'open') : A.markDone(s, t.id)))}>{t.status === 'done' ? '✓' : ''}</button>
                  <button className="open" onClick={() => ui.openTask(t.id)}>
                    <span className="t">{t.status === 'in_progress' && <span className="badge accepted">en cours</span>} {t.title}</span>
                    <span className="small muted">
                      {[pr?.name, d && `pour ${fmtDay(d, today)}`, t.status !== 'done' && remainingMinutes(t) ? `reste ${fmtDuration(remainingMinutes(t))}` : null, pl ? `prévu ${fmtDay(pl.toISODate()!, today)} ${fmtTime(pl)}` : null, t.priority > 0 ? '★'.repeat(t.priority) : null].filter(Boolean).join(' · ')}
                      {t.status === 'inbox' && ' · à classer'}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function DeadlinesList({ q }: { q: string }) {
  const s = useStore();
  const ui = useUI();
  const now = useNow();
  const today = localDate(now);
  const ds = live(s.state.deadlines).filter((d) => !q || norm(d.title).includes(norm(q))).sort((a, b) => a.date.localeCompare(b.date));
  const groups: [string, typeof ds][] = [
    ['À venir', ds.filter((d) => d.date >= today && ['announced', 'to_confirm'].includes(d.status))],
    ['Passées à renseigner', ds.filter((d) => effectiveDeadlineStatus(d, now) === 'to_fill')],
    ['Terminées, annulées, historique', ds.filter((d) => ['done', 'cancelled', 'history'].includes(d.status))],
  ];
  return (
    <>
      {groups.map(([label, items]) => items.length > 0 && (
        <section key={label}>
          <h2>{label}</h2>
          <ul className="tasklist">
            {items.map((d) => (
              <li key={d.id}>
                <button className="open" onClick={() => ui.openDeadline(d.id)}>
                  <span className="t"><strong>{d.title}</strong></span>
                  <span className="small muted">{fmtDay(d.date, today)} {d.date}{d.time ? ` · ${d.time}` : ' · heure inconnue'} · {DEADLINE_STATUS_LABEL[effectiveDeadlineStatus(d, now)]}{!d.dateConfirmed ? ' · date à confirmer' : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {ds.length === 0 && <p className="muted">Aucune échéance. Écris par exemple « contrôle de maths jeudi » dans le champ de capture.</p>}
    </>
  );
}

function ProjectsList({ q }: { q: string }) {
  const s = useStore();
  const act = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const areas = live(s.state.areas);
  const projects = live(s.state.projects).filter((p) => !q || norm(p.name).includes(norm(q)));
  const tasksBy = (pid: string) => live(s.state.tasks).filter((t) => t.projectId === pid && ['open', 'in_progress', 'inbox'].includes(t.status));
  const groups = [...areas.map((a) => ({ a, items: projects.filter((p) => p.areaId === a.id) })), { a: null, items: projects.filter((p) => !p.areaId || !areas.some((a) => a.id === p.areaId)) }];
  return (
    <>
      <div className="btn-row">
        <button className="btn small" onClick={async () => { const p = await act(() => A.upsertProject(s, { name: 'Nouveau projet' }, 'Projet créé')); if (p) setOpen(p.id); }}>+ Projet</button>
      </div>
      {groups.map(({ a, items }) => (a || items.length > 0) && (
        <section key={a?.id ?? 'none'}>
          <h2>
            {a ? a.name : 'Sans domaine'} {a && <span className={'badge ' + (a.status === 'active' ? 'accepted' : a.status === 'to_confirm' ? 'warn' : '')}>{STATUS_LABEL[a.status]}</span>}
            {a && (
              <select aria-label={`Statut du domaine ${a.name}`} style={{ width: 'auto', minHeight: 32, marginLeft: 8, fontSize: 13 }} value={a.status} onChange={(e) => act(() => s.commit(`Domaine ${a.name} : ${STATUS_LABEL[e.target.value]}`, 'action', [{ store: 'areas', next: { ...a, status: e.target.value } }]))}>
                {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            )}
          </h2>
          {a?.source && <p className="small muted" style={{ marginTop: -4 }}>Provenance : {a.source}{a.dailyBudgetMin ? ` · budget ${a.dailyBudgetMin} min/jour` : ''}</p>}
          <ul className="tasklist">
            {items.map((p) => (
              <li key={p.id}>
                <button className="open" onClick={() => setOpen(p.id)}>
                  <span className="t"><strong>{p.name}</strong> <span className="badge">{STATUS_LABEL[p.status]}</span>{p.kind === 'application' && p.applicationStatus && <span className="badge fixed">{p.applicationStatus.replace('_', ' ')}</span>}</span>
                  <span className="small muted">{p.nextAction ?? tasksBy(p.id)[0]?.title ?? 'Pas de prochaine action'} · {tasksBy(p.id).length} tâche(s) ouverte(s){p.targetDate ? ` · cible ${p.targetDate}${p.targetConfirmed === false ? ' (à confirmer)' : ''}` : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {open && <ProjectSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function VideosList({ q }: { q: string }) {
  const s = useStore();
  const act = useAct();
  const [open, setOpen] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [lot, setLot] = useState('');
  const videos = live(s.state.videos).filter((v) => !q || norm(v.title).includes(norm(q)));
  const byProject = new Map<string, Video[]>();
  for (const v of videos) byProject.set(v.projectId ?? '', [...(byProject.get(v.projectId ?? '') ?? []), v]);
  async function newVideo() {
    const v = makeVideo(s.nowIso(), { title: 'Nouvelle vidéo' });
    await act(() => s.commit('Vidéo créée', 'action', [{ store: 'videos', next: v }]));
    setOpen(v.id);
  }
  async function assignLot() {
    if (!lot.trim() || sel.size === 0) return;
    const writes = [...sel].map((id) => ({ store: 'videos' as const, next: { ...s.state.videos.get(id)!, batchLabel: lot.trim() } }));
    const t = { store: 'tasks' as const, next: { ...(await import('../core/factory')).makeTask(s.nowIso(), { title: `Lot de production : ${lot.trim()} (${sel.size} vidéos)`, estimateMin: 30 + 20 * sel.size, continuous: true, notes: 'Réutiliser rendu, montage et voix déjà faits pour limiter les changements de contexte.' }) } };
    await act(() => s.commit(`Lot « ${lot.trim()} » : ${sel.size} vidéos`, 'action', [...writes, t]));
    setSel(new Set());
    setLot('');
  }
  return (
    <>
      <div className="btn-row"><button className="btn small" onClick={newVideo}>+ Vidéo</button></div>
      {sel.size > 0 && (
        <div className="card row" style={{ marginTop: 8 }}>
          <span>{sel.size} sélectionnée(s)</span>
          <input type="text" placeholder="Nom du lot (ex. 3 formats Loi N)" value={lot} onChange={(e) => setLot(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
          <button className="btn small primary" onClick={assignLot} disabled={!lot.trim()}>Créer le lot + une tâche de production</button>
        </div>
      )}
      {[...byProject.entries()].map(([pid, vs]) => (
        <section key={pid}>
          <h2>{s.state.projects.get(pid)?.name ?? 'Sans projet'}</h2>
          <ul className="tasklist">
            {vs.map((v) => (
              <li key={v.id}>
                <input type="checkbox" aria-label={`Sélectionner ${v.title}`} checked={sel.has(v.id)} onChange={(e) => setSel((x) => { const n = new Set(x); e.target.checked ? n.add(v.id) : n.delete(v.id); return n; })} style={{ width: 22, height: 22 }} />
                <button className="open" onClick={() => setOpen(v.id)}>
                  <span className="t"><strong>{v.title}</strong> <span className="badge">{WORK_LABEL[v.workState]}</span>{v.batchLabel && <span className="badge fixed">lot : {v.batchLabel}</span>}</span>
                  <span className="small muted">
                    {Object.entries(v.platforms).filter(([, p]) => p && p.state !== 'non_prevu').map(([k, p]) => `${PLATFORM_LABEL[k as keyof typeof PLATFORM_LABEL]} : ${p!.state === 'publie' ? 'publiée' : p!.state === 'programme' ? 'programmée' : 'prévue'}${p!.date ? ' ' + p!.date : ''}`).join(' · ') || 'Aucune plateforme'}
                    {v.nextStep ? ` · ensuite : ${v.nextStep}` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {videos.length === 0 && <p className="muted">Aucune fiche vidéo. Une fiche suit l’état de travail et l’état par plateforme.</p>}
      {open && <VideoSheet id={open} onClose={() => setOpen(null)} />}
    </>
  );
}

