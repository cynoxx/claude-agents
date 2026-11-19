import { useCallback, useMemo, useRef, useState } from 'react';
import type { ID, ReplanFacts } from '../core/types';
import { useStore, getStore } from '../app/store';
import { fmtDateLong, localDate } from '../core/time';
import * as A from '../app/actions';
import { UIContext, useRoute, SaveStatus, type Toast, type UI, go } from './common';
import { CaptureBar, type CaptureHandle } from './Capture';
import { Today } from './Today';
import { Agenda } from './Agenda';
import { ListView } from './ListView';
import { Settings } from './Settings';
import { Journal } from './Journal';
import { ReplanSheet } from './Replan';
import { TaskSheet, DeadlineSheet } from './Sheets';

const NAV = [
  ['aujourdhui', 'Aujourd’hui', '◉'],
  ['agenda', 'Agenda', '▦'],
  ['liste', 'Liste', '☰'],
  ['reglages', 'Réglages', '⚙'],
] as const;

export function App({ updateAvailable, onUpdate }: { updateAvailable: boolean; onUpdate: () => void }) {
  const s = useStore();
  const route = useRoute();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [replan, setReplan] = useState<{ facts?: ReplanFacts; captureId?: ID } | null>(null);
  const [task, setTask] = useState<ID | null>(null);
  const [deadline, setDeadline] = useState<ID | null>(null);
  const capRef = useRef<CaptureHandle>(null);

  const toast = useCallback((text: string, batchId?: ID | null, error?: boolean) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t.slice(-2), { id, text, batchId: batchId ?? undefined, error }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 9000 : 7000);
  }, []);
  const ui: UI = useMemo(() => ({
    toast,
    openReplan: (facts, captureId) => setReplan({ facts, captureId }),
    openTask: (id) => setTask(id),
    openDeadline: (id) => setDeadline(id),
    focusCapture: () => capRef.current?.focus(),
  }), [toast]);

  async function undo(t: Toast) {
    if (!t.batchId) return;
    setToasts((x) => x.filter((y) => y.id !== t.id));
    const r = await getStore().undo(t.batchId);
    if (r?.conflicts.length) toast(`Non annulé : ${r.conflicts.map((c) => c.label).join(', ')} modifié depuis. Voir Réglages → Historique.`, null, true);
    else toast('Annulé', null);
  }

  const page = route[0];
  const today = localDate(A.now(s));
  let content;
  if (page === 'agenda') content = <Agenda />;
  else if (page === 'liste') content = <ListView filter={route[1]} />;
  else if (page === 'reglages') content = <Settings section={route[1]} />;
  else if (page === 'journal') content = <Journal />;
  else content = <Today />;

  const firstRun = !s.state.prefs.onboardingDone && s.space === 'real';
  return (
    <UIContext.Provider value={ui}>
      {s.space === 'demo' && <div className="demo-banner" role="status">Espace de démonstration — tes vraies données ne sont pas touchées. <a href="#/reglages/demo" style={{ color: 'white' }}>Revenir</a></div>}
      <div className="shell">
        <nav className="sidenav" aria-label="Navigation principale">
          <div className="brand">Max</div>
          {NAV.map(([k, l, i]) => <a key={k} href={'#/' + k} aria-current={page === k || (k === 'aujourdhui' && !NAV.some((n) => n[0] === page) && page !== 'journal') ? 'page' : undefined}><span aria-hidden="true">{i}</span>{l}</a>)}
          <a href="#/journal" aria-current={page === 'journal' ? 'page' : undefined}><span aria-hidden="true">☾</span>Journal</a>
          <div style={{ flex: 1 }} />
          <SaveStatus />
        </nav>
        <div>
          <header className="topbar">
            <span className="brand" style={{ display: 'inline' }}>Max</span>
            <span className="date">{fmtDateLong(today)}</span>
            <span className="spacer" />
            <SaveStatus />
          </header>
          <div className="capturebar"><CaptureBar ref={capRef} /></div>
          <main className="main" id="main">
            {updateAvailable && <p className="notice">Nouvelle version de Max disponible. <button className="btn small" onClick={onUpdate}>Recharger</button></p>}
            {s.save.kind === 'error' && <p className="notice danger" role="alert">Le dernier enregistrement a échoué : {s.save.message}. Tes données précédentes sont intactes. Exporte une sauvegarde si le problème continue.</p>}
            {firstRun && page === 'aujourdhui' && <Welcome />}
            {content}
          </main>
        </div>
      </div>
      <nav className="tabbar" aria-label="Navigation">
        {NAV.map(([k, l, i]) => <a key={k} href={'#/' + k} aria-current={page === k || (k === 'aujourdhui' && !NAV.some((n) => n[0] === page)) ? 'page' : undefined}><span className="ico" aria-hidden="true">{i}</span>{l}</a>)}
      </nav>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast" role={t.error ? 'alert' : 'status'} style={t.error ? { background: 'var(--danger)' } : undefined}>
            <span className="grow">{t.text}</span>
            {t.batchId && <button className="btn small" onClick={() => undo(t)}>Annuler</button>}
            <button className="btn small ghost" style={{ border: 0 }} aria-label="Fermer" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>✕</button>
          </div>
        ))}
      </div>
      {replan && <ReplanSheet initial={replan.facts} captureId={replan.captureId} onClose={() => setReplan(null)} />}
      {task && <TaskSheet key={task + s.state.tasks.get(task)?.version} id={task} onClose={() => setTask(null)} />}
      {deadline && <DeadlineSheet key={deadline + s.state.deadlines.get(deadline)?.version} id={deadline} onClose={() => setDeadline(null)} />}
    </UIContext.Provider>
  );
}

function Welcome() {
  const s = useStore();
  const done = () => A.updatePrefs(s, { onboardingDone: true }, 'Prise en main terminée');
  return (
    <section className="card" style={{ marginBottom: 12 }} aria-labelledby="w-h">
      <div className="kicker" id="w-h">Bienvenue dans Max</div>
      <p style={{ margin: '6px 0' }}>Écris ce qui te tombe dessus dans le champ ci-dessus, par exemple « contrôle d’électricité jeudi, heure à vérifier ». Max en fait une échéance, une préparation et un plan.</p>
      <div className="btn-row">
        <button className="btn primary" onClick={() => { go('reglages/reprise'); }}>Reprendre mon contexte (à confirmer)</button>
        <button className="btn" onClick={() => go('reglages/demo')}>Essayer en démonstration</button>
        <button className="btn ghost" onClick={done}>Passer</button>
      </div>
      <p className="small muted" style={{ margin: '6px 0 0' }}>Tu pourras reprendre ces étapes plus tard dans Réglages.</p>
    </section>
  );
}
