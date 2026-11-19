import { useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { localDate, fmtTime, addDays } from '../core/time';
import type { LogEntry } from '../core/types';
import { Field, useAct, useNow } from './common';

/** Journal volontaire : sommeil, caféine, énergie. Privé, supprimable, jamais envoyé à un assistant externe. */
export function Journal() {
  const s = useStore();
  const act = useAct();
  const now = useNow();
  const today = localDate(now);
  const tz = s.state.prefs.tz;
  const [sl, setSl] = useState({ date: today, bed: '', wake: '', quality: '' as '' | 'bien' | 'moyen' | 'mal', sleepMin: '' });
  const [cf, setCf] = useState({ date: today, time: now.toFormat('HH:mm'), product: 'Café', quantity: '', mg: '' });
  const [edit, setEdit] = useState<string | null>(null);
  const logs = live(s.state.logs).sort((a, b) => (b.date + (b.at ?? b.wakeAt ?? '')).localeCompare(a.date + (a.at ?? a.wakeAt ?? '')));
  const last14 = logs.filter((l) => l.date >= addDays(today, -14));
  const nights = last14.filter((l) => l.kind === 'sleep');
  const caf = last14.filter((l) => l.kind === 'caffeine');
  const lateCafDays = new Set(caf.filter((c) => c.at && DateTime.fromISO(c.at).setZone(tz).hour >= 14).map((c) => c.date));
  const nightsWithLate = nights.filter((n) => lateCafDays.has(addDays(n.date, -1))).length;
  const energyLow = s.state.prefs.energy?.date === today && s.state.prefs.energy.level === 'basse';

  const del = (l: LogEntry) => act(() => s.commit('Entrée supprimée', 'action', [{ store: 'logs', next: { ...l, deletedAt: s.nowIso() } }]));
  return (
    <div>
      <h1>Journal</h1>
      <p className="small muted">Facultatif. Ces données restent sur cet appareil, sont supprimables et ne sont jamais envoyées à un assistant. Aucun score ni diagnostic : c’est une aide à l’organisation.</p>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Capacité du jour</h2>
        <div className="btn-row">
          <button className="chip" aria-pressed={!energyLow} onClick={() => act(() => A.resetDay(s))}>Normale</button>
          <button className="chip" aria-pressed={energyLow} onClick={() => act(() => A.updatePrefs(s, { energy: { date: today, level: 'basse' } }, 'Peu d’énergie aujourd’hui'))}>Peu d’énergie</button>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>« Peu d’énergie » allège la journée au prochain recalage, en gardant tes engagements verrouillés.</p>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Nuit</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); act(() => A.logSleep(s, { date: sl.date, bed: sl.bed || undefined, wake: sl.wake || undefined, quality: sl.quality || undefined, sleepMin: sl.sleepMin ? +sl.sleepMin : undefined })); setSl({ ...sl, bed: '', wake: '', quality: '', sleepMin: '' }); }}>
          <div className="grid2">
            <Field label="Jour du réveil"><input type="date" value={sl.date} onChange={(e) => setSl({ ...sl, date: e.target.value })} /></Field>
            <Field label="Coucher (la veille si après midi)"><input type="time" value={sl.bed} onChange={(e) => setSl({ ...sl, bed: e.target.value })} /></Field>
            <Field label="Réveil"><input type="time" value={sl.wake} onChange={(e) => setSl({ ...sl, wake: e.target.value })} /></Field>
            <Field label="Sommeil réel (min, si connu)" hint="Différent du temps passé au lit"><input type="number" value={sl.sleepMin} onChange={(e) => setSl({ ...sl, sleepMin: e.target.value })} /></Field>
          </div>
          <div className="row"><span className="small muted">Impression :</span>{(['bien', 'moyen', 'mal'] as const).map((q) => <button type="button" key={q} className="chip" aria-pressed={sl.quality === q} onClick={() => setSl({ ...sl, quality: q })}>{q === 'mal' ? 'mal dormi' : q === 'bien' ? 'bien dormi' : 'moyen'}</button>)}</div>
          <button className="btn primary" type="submit" disabled={!sl.bed && !sl.wake && !sl.quality}>Enregistrer la nuit</button>
        </form>
      </section>

      <section className="card">
        <h2 style={{ marginTop: 0 }}>Café, Red Bull…</h2>
        <form className="stack" onSubmit={(e) => { e.preventDefault(); act(() => A.logCaffeine(s, { date: cf.date, time: cf.time, product: cf.product, quantity: cf.quantity || 'inconnue', caffeineMg: cf.mg ? +cf.mg : undefined })); }}>
          <div className="grid2">
            <Field label="Produit"><input type="text" list="products" value={cf.product} onChange={(e) => setCf({ ...cf, product: e.target.value })} /></Field>
            <datalist id="products"><option value="Café" /><option value="Red Bull" /><option value="Thé" /><option value="Monster" /></datalist>
            <Field label="Heure"><input type="time" value={cf.time} onChange={(e) => setCf({ ...cf, time: e.target.value })} /></Field>
            <Field label="Format / quantité" hint="Vide = quantité inconnue"><input type="text" value={cf.quantity} placeholder="25 cl, double…" onChange={(e) => setCf({ ...cf, quantity: e.target.value })} /></Field>
            <Field label="Caféine (mg), seulement si indiquée"><input type="number" value={cf.mg} onChange={(e) => setCf({ ...cf, mg: e.target.value })} /></Field>
          </div>
          <button className="btn primary" type="submit">Enregistrer</button>
        </form>
      </section>

      <section>
        <h2>Revue (14 jours)</h2>
        <p className="small">{nights.length} nuit{nights.length > 1 ? 's' : ''} saisie{nights.length > 1 ? 's' : ''}, {caf.length} prise{caf.length > 1 ? 's' : ''} de caféine{caf.filter((c) => c.quantity === 'inconnue').length ? ` (dont ${caf.filter((c) => c.quantity === 'inconnue').length} de quantité inconnue)` : ''}. {nights.length > 0 && `Caféine après 14 h renseignée la veille de ${nightsWithLate} de ces nuits.`}</p>
        <p className="small muted">{14 - new Set(nights.map((n) => n.date)).size} jours sans nuit saisie. Une observation n’est pas une preuve de cause.</p>
      </section>

      <h2>Entrées</h2>
      {logs.length === 0 && <p className="muted">Aucune entrée.</p>}
      <ul className="tasklist">
        {logs.map((l) => (
          <li key={l.id}>
            <span className="grow">
              <strong>{l.date}</strong>{' '}
              {l.kind === 'sleep' && <>nuit : {l.bedAt ? `coucher ${fmtTime(DateTime.fromISO(l.bedAt).setZone(tz))}` : ''} {l.wakeAt ? `réveil ${fmtTime(DateTime.fromISO(l.wakeAt).setZone(tz))}` : ''} {l.sleepMin ? `· ${l.sleepMin} min dormies` : l.bedAt && l.wakeAt ? '· temps au lit (sommeil réel inconnu)' : ''} {l.quality ? `· ${l.quality === 'mal' ? 'mal dormi' : l.quality}` : ''}</>}
              {l.kind === 'caffeine' && <>{l.product} à {l.at ? fmtTime(DateTime.fromISO(l.at).setZone(tz)) : '?'} · quantité {l.quantity ?? 'inconnue'}{l.caffeineMg ? ` · ${l.caffeineMg} mg (indiqué)` : ' · dosage inconnu'}</>}
            </span>
            {l.kind === 'sleep' && <button className="btn small ghost" onClick={() => setEdit(edit === l.id ? null : l.id)}>Corriger</button>}
            <button className="btn small ghost danger" onClick={() => del(l)} aria-label="Supprimer l’entrée">Supprimer</button>
            {edit === l.id && (
              <span className="row" style={{ width: '100%' }}>
                {(['bien', 'moyen', 'mal'] as const).map((q) => <button key={q} className="chip" aria-pressed={l.quality === q} onClick={() => act(() => s.commit('Nuit corrigée', 'action', [{ store: 'logs', next: { ...l, quality: q } }]))}>{q}</button>)}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
