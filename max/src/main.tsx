import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { MaxStore, setStore } from './app/store';
import { App } from './ui/App';
import './styles.css';

function getSpace(): 'real' | 'demo' {
  try {
    return localStorage.getItem('max.space') === 'demo' ? 'demo' : 'real';
  } catch {
    return 'real';
  }
}

let updateSW: ((reload?: boolean) => Promise<void>) | undefined;
let setUpdate: (v: boolean) => void = () => {};
try {
  updateSW = registerSW({ onNeedRefresh: () => setUpdate(true) });
} catch { /* pas de service worker (navigation privée, http) */ }

function Root() {
  const [update, setU] = useState(false);
  useEffect(() => { setUpdate = setU; }, []);
  return <App updateAvailable={update} onUpdate={() => updateSW?.(true)} />;
}

async function boot() {
  const el = document.getElementById('root')!;
  const store = new MaxStore(getSpace());
  try {
    await store.init();
  } catch (e: any) {
    el.innerHTML = `<div style="padding:24px;font-family:system-ui"><h1>Max ne peut pas ouvrir ses données</h1><p>${String(e?.message ?? e)}</p><p>Le stockage local est peut-être bloqué (navigation privée, réglages Safari). Rien n’a été effacé.</p></div>`;
    return;
  }
  setStore(store);
  // Mémoriser l'ouverture (sert à la reprise après absence). L'ancienne valeur reste lisible pendant la session.
  (window as any).__maxLastOpenAt = store.state.prefs.lastOpenAt;
  void store.commit('Ouverture', 'system', [{ store: 'prefs', next: { ...store.state.prefs, lastOpenAt: store.nowIso() } }]).catch(() => {});
  createRoot(el).render(
    <StrictMode>
      <Root />
    </StrictMode>,
  );
}
void boot();
