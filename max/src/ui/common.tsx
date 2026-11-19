import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { DateTime } from 'luxon';
import type { ID, ReplanFacts } from '../core/types';
import { fmtTime } from '../core/time';
import { getStore, useStore } from '../app/store';

// ---------- Routage par ancre (#/...) : fonctionne hors ligne et en PWA installée ----------
export function useRoute(): string[] {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const path = hash.replace(/^#\/?/, '');
  return path ? path.split('/').map(decodeURIComponent) : ['aujourdhui'];
}
export function go(path: string) {
  location.hash = '#/' + path;
}

// ---------- Contexte d'interface (feuilles, toasts) ----------
export interface Toast { id: string; text: string; batchId?: ID; error?: boolean }
export interface UI {
  toast: (text: string, batchId?: ID | null, error?: boolean) => void;
  openReplan: (facts?: ReplanFacts, captureId?: ID) => void;
  openTask: (id: ID) => void;
  openDeadline: (id: ID) => void;
  focusCapture: () => void;
}
export const UIContext = createContext<UI>(null as unknown as UI);
export const useUI = () => useContext(UIContext);

/** Exécute une action et affiche « Annuler » immédiatement. */
export function useAct() {
  const ui = useUI();
  return async function act<T>(fn: () => Promise<T>, text?: string): Promise<T | undefined> {
    const s = getStore();
    const before = s.state.batches[0]?.id;
    try {
      const r = await fn();
      const b = s.state.batches[0];
      if (b && b.id !== before && text !== '') ui.toast(text ?? b.label, b.id);
      return r;
    } catch (e: any) {
      ui.toast(e?.message ?? String(e), null, true);
      return undefined;
    }
  };
}

export function Sheet({ title, onClose, children, wide }: { title: ReactNode; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} tabIndex={-1} ref={ref} style={wide ? { maxWidth: 900 } : undefined}>
        <header>
          <h2>{title}</h2>
          <button className="btn ghost" onClick={onClose} aria-label="Fermer">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function SaveStatus() {
  const s = useStore();
  const st = s.save;
  if (st.kind === 'loading') return <span className="save-status saving"><span className="dot" />Chargement…</span>;
  if (st.kind === 'saving') return <span className="save-status saving" aria-live="polite"><span className="dot" />Enregistrement…</span>;
  if (st.kind === 'error') return <span className="save-status error" role="alert"><span className="dot" />Échec d’enregistrement : {st.message}</span>;
  const t = DateTime.fromISO(st.at);
  return (
    <span className="save-status" title="Données enregistrées sur cet appareil (pas de synchronisation automatique)">
      <span className="dot" />Sur cet appareil · {t.isValid ? fmtTime(t.setZone(s.state.prefs.tz)) : ''}
    </span>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

export function useNow(intervalMs = 30000): DateTime {
  const s = getStore();
  const [n, setN] = useState(() => s.clock().setZone(s.state.prefs.tz));
  useEffect(() => {
    const id = setInterval(() => setN(s.clock().setZone(s.state.prefs.tz)), intervalMs);
    const vis = () => document.visibilityState === 'visible' && setN(s.clock().setZone(s.state.prefs.tz));
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', vis); };
  }, [s, intervalMs]);
  return n;
}

export function download(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const CATEGORY_LABEL: Record<string, string> = {
  cours: 'Cours', tp: 'TP', controle: 'Contrôle', trajet: 'Trajet', sport: 'Sport', famille: 'Famille', perso: 'Temps perso', prive: 'Privé', spirituel: 'Temps spirituel',
  sommeil: 'Sommeil', travail: 'Travail', repos: 'Repos', rdv: 'Rendez-vous', autre: 'Autre',
};
