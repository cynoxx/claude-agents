import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import { useStore, live } from '../app/store';
import * as A from '../app/actions';
import { makeBackup, mergeWrites, previewMerge, validateBackup, type BackupFile, type MergePreview } from '../core/backup';
import { parseIcs, type IcsPreview } from '../core/ics';
import { contextProposals, demoWrites } from '../app/seed';
import { addDays, localDate } from '../core/time';
import { GRAMMAR_VERSION } from '../core/nlu/parse';
import { Field, useAct, useNow, download, go } from './common';
import { deadlineIcs } from './ics-export';

export function Settings({ section }: { section?: string }) {
  useEffect(() => {
    if (section) document.getElementById('s-' + section)?.scrollIntoView();
  }, [section]);
  return (
    <div>
      <h1>Réglages</h1>
      <nav className="chips" aria-label="Sections">
        {[['sauvegarde', 'Sauvegarde'], ['reprise', 'Reprise de contexte'], ['preferences', 'Préférences'], ['agenda', 'Agenda'], ['bilan', 'Revue & bilan'], ['historique', 'Historique'], ['voix', 'Voix & assistant'], ['demo', 'Démonstration']].map(([k, l]) => (
          <a key={k} className="chip" href={'#/reglages/' + k} style={{ display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>{l}</a>
        ))}
      </nav>
      <Backup />
      <ContextResume />
      <Preferences />
      <CalendarImport />
      <Review />
      <History />
      <VoiceAssistant />
      <Demo />
    </div>
  );
}

function Backup() {
  const s = useStore();
  const act = useAct();
  const [includePrivate, setIncludePrivate] = useState(false);
  const [file, setFile] = useState<BackupFile | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [take, setTake] = useState<Set<string>>(new Set());
  const [backups, setBackups] = useState<{ id: string; at: string; label: string; json: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  useEffect(() => { s.listBackups().then((b) => setBackups(b.sort((x, y) => y.at.localeCompare(x.at)))); }, [s, s.getVersion()]); // eslint-disable-line react-hooks/exhaustive-deps

  function exportNow() {
    const f = makeBackup(s.snapshot(), { includePrivate, space: s.space, nowIso: s.nowIso() });
    download(`max-sauvegarde-${DateTime.now().toFormat('yyyy-LL-dd-HHmm')}${includePrivate ? '-avec-prive' : ''}.json`, JSON.stringify(f, null, 1));
    act(() => A.updatePrefs(s, { lastExportAt: s.nowIso() }, 'Sauvegarde exportée'), '');
  }
  async function onFile(fl: File | undefined) {
    setErrors(null); setPreview(null); setFile(null); setDone(null);
    if (!fl) return;
    const text = await fl.text();
    const v = validateBackup(text);
    if (!v.ok) { setErrors(v.errors); return; }
    setFile(v.file);
    setPreview(previewMerge(s.snapshot(), v.file));
    setTake(new Set());
  }
  async function merge() {
    if (!preview || !file) return;
    const writes = mergeWrites(preview, take);
    if (writes.length) await act(() => s.commit(`Import (fusion) : ${writes.length} objet(s)`, 'import', writes));
    setDone(`Fusion terminée : ${writes.length} ajout(s) ou remplacement(s), ${preview.duplicates} doublon(s) ignoré(s).`);
    setPreview(null); setFile(null);
  }
  async function restore() {
    if (!file || !confirm('Remplacer toutes les données de cet espace par ce fichier ? L’état actuel est sauvegardé automatiquement avant.')) return;
    try { await s.restore(file.data, 'fichier importé'); setDone('Restauration terminée. L’état précédent est dans les sauvegardes automatiques ci-dessous.'); } catch (e: any) { setErrors(['Restauration impossible, aucune donnée modifiée : ' + e?.message]); }
    setPreview(null); setFile(null);
  }
  const lastExport = s.state.prefs.lastExportAt;
  return (
    <section id="s-sauvegarde">
      <h2>Sauvegarde et appareils</h2>
      <div className="card stack">
        <p style={{ margin: 0 }}><strong>Où sont mes données ?</strong> Sur cet appareil, dans le navigateur ({s.space === 'demo' ? 'espace de démonstration' : 'espace réel'}). Chaque action est enregistrée immédiatement, même hors connexion.</p>
        <p className="small" style={{ margin: 0 }}>
          Stockage durable : {s.persisted === true ? <strong>accordé</strong> : s.persisted === false ? <>non accordé (le navigateur pourrait effacer les données s’il manque de place) <button className="btn small" onClick={() => s.requestPersistence()}>Demander</button></> : 'inconnu sur ce navigateur'}
        </p>
        <p className="notice small" style={{ margin: 0 }}><strong>Synchronisation Mac ↔ iPhone : non disponible dans cette version.</strong> Les données d’un appareil ne passent pas seules sur l’autre. Pour transférer : « Exporter » sur l’un, puis « Importer » (fusion) sur l’autre — par AirDrop ou iCloud Drive. Dernier export : {lastExport ? DateTime.fromISO(lastExport).setLocale('fr').toFormat('d LLL HH:mm') : 'jamais'}.</p>
        <label className="check"><input type="checkbox" checked={includePrivate} onChange={(e) => setIncludePrivate(e.target.checked)} /><span>Inclure les données privées (journal sommeil/caféine, titres des temps privés, énergie)</span></label>
        <div className="btn-row">
          <button className="btn primary" onClick={exportNow}>Exporter {includePrivate ? '(avec données privées)' : '(sans données privées)'}</button>
          <label className="btn">Importer un fichier…<input type="file" accept="application/json,.json" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
        {errors && <div className="notice danger" role="alert"><strong>Fichier refusé, aucune donnée modifiée.</strong><ul className="small">{errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
        {done && <p className="notice" role="status">{done}</p>}
        {preview && file && (
          <div className="card stack">
            <strong>Aperçu de l’import</strong>
            <p className="small" style={{ margin: 0 }}>Fichier du {DateTime.fromISO(file.exportedAt).setLocale('fr').toFormat('d LLL yyyy HH:mm')} · {file.includesPrivate ? 'avec' : 'sans'} données privées · schéma v{file.schemaVersion}</p>
            <ul className="small">
              <li>{preview.added.length} nouvel(s) objet(s) à ajouter</li>
              <li>{preview.duplicates} doublon(s) ignoré(s)</li>
              <li>{preview.localOnly} objet(s) présents seulement ici : conservés</li>
              <li>{preview.keptDeleted} objet(s) supprimés ici : ne réapparaîtront pas</li>
              <li>{preview.collisions.length} collision(s) : ta version locale est gardée sauf si tu coches</li>
            </ul>
            {preview.collisions.map((c) => (
              <label key={c.store + c.id} className="check small">
                <input type="checkbox" checked={take.has(`${c.store}:${c.id}`)} onChange={(e) => setTake((x) => { const n = new Set(x); const k = `${c.store}:${c.id}`; e.target.checked ? n.add(k) : n.delete(k); return n; })} />
                <span>Prendre la version du fichier pour <strong>{c.label}</strong> ({c.store}, {c.reason} ; plus récente : {c.newer === 'local' ? 'ici' : 'fichier'})</span>
              </label>
            ))}
            <div className="btn-row">
              <button className="btn primary" onClick={merge}>Fusionner</button>
              <button className="btn" onClick={restore}>Restaurer (remplacer tout)</button>
              <button className="btn ghost" onClick={() => { setPreview(null); setFile(null); }}>Annuler</button>
            </div>
          </div>
        )}
        {backups.length > 0 && (
          <details>
            <summary>Sauvegardes automatiques ({backups.length})</summary>
            <ul className="small">{backups.map((b) => <li key={b.id}>{DateTime.fromISO(b.at).setLocale('fr').toFormat('d LLL HH:mm')} — {b.label} <button className="btn small ghost" onClick={() => download(`max-auto-${b.at.slice(0, 16)}.json`, JSON.stringify(makeBackup(JSON.parse(b.json), { includePrivate: true, space: s.space, nowIso: b.at })))}>Télécharger</button></li>)}</ul>
          </details>
        )}
      </div>
    </section>
  );
}

function ContextResume() {
  const s = useStore();
  const act = useAct();
  const proposals = useMemo(() => contextProposals(s.nowIso()), []); // eslint-disable-line react-hooks/exhaustive-deps
  const exists = (p: (typeof proposals)[number]) => p.writes.every((w) => s.get(w.store, w.next.id));
  const [checked, setChecked] = useState<Set<string>>(() => new Set(proposals.filter((p) => p.defaultChecked).map((p) => p.id)));
  const pending = proposals.filter((p) => !exists(p));
  async function adopt() {
    const writes = proposals.filter((p) => checked.has(p.id) && !exists(p)).flatMap((p) => p.writes.filter((w) => !s.get(w.store, w.next.id)));
    if (!writes.length) return;
    await act(() => s.commit(`Reprise de contexte : ${writes.length} élément(s)`, 'import', writes));
  }
  return (
    <section id="s-reprise">
      <h2>Reprise de contexte <span className="badge exp">facultatif</span></h2>
      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>Propositions tirées de ta photographie du 18/11/2026. Rien n’est ajouté sans ta coche. Chaque élément garde sa provenance et reste modifiable (Liste → Projets / Échéances). Aucune donnée sensible n’est incluse.</p>
        {pending.length === 0 && <p className="notice small">Tout a été repris. Corrige les éléments depuis la Liste.</p>}
        {proposals.map((p) => {
          const ex = exists(p);
          return (
            <label key={p.id} className="check" style={{ opacity: ex ? 0.6 : 1 }}>
              <input type="checkbox" disabled={ex} checked={ex || checked.has(p.id)} onChange={(e) => setChecked((x) => { const n = new Set(x); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
              <span>
                <span className="badge">{p.domain}</span> <strong>{p.label}</strong> <span className="badge">{p.proposedStatus}</span>{ex && <span className="badge accepted">repris</span>}
                {p.toConfirm.length > 0 && <><br /><span className="small">À confirmer : {p.toConfirm.join(' · ')}</span></>}
                <br /><span className="small muted">Provenance : {p.provenance}</span>
              </span>
            </label>
          );
        })}
        {pending.length > 0 && <div className="btn-row"><button className="btn primary" onClick={adopt}>Ajouter la sélection</button></div>}
      </div>
    </section>
  );
}

function Preferences() {
  const s = useStore();
  const act = useAct();
  const p = s.state.prefs;
  const [f, setF] = useState(p);
  useEffect(() => setF(s.state.prefs), [s.state.prefs.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(f) !== JSON.stringify(p);
  const today = localDate(s.clock().setZone(p.tz));
  return (
    <section id="s-preferences">
      <h2>Préférences</h2>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Sommeil protégé {!f.sleep.confirmed && <span className="badge warn">repère 22 h–6 h à vérifier</span>}</h3>
        <div className="grid2">
          <Field label="Coucher"><input type="time" value={f.sleep.bed} onChange={(e) => setF({ ...f, sleep: { ...f.sleep, bed: e.target.value } })} /></Field>
          <Field label="Réveil"><input type="time" value={f.sleep.wake} onChange={(e) => setF({ ...f, sleep: { ...f.sleep, wake: e.target.value } })} /></Field>
        </div>
        <label className="check"><input type="checkbox" checked={f.sleep.protect} onChange={(e) => setF({ ...f, sleep: { ...f.sleep, protect: e.target.checked } })} /><span>Ne rien planifier pendant cette fenêtre</span></label>
        <label className="check"><input type="checkbox" checked={f.sleep.confirmed} onChange={(e) => setF({ ...f, sleep: { ...f.sleep, confirmed: e.target.checked } })} /><span>Horaires confirmés</span></label>
        <h3 style={{ margin: 0 }}>Planification</h3>
        <div className="grid2">
          <Field label="Marge entre blocs (min)"><input type="number" min={0} value={f.bufferMin} onChange={(e) => setF({ ...f, bufferMin: +e.target.value })} /></Field>
          <Field label="Durée minimale utile (min)"><input type="number" min={5} value={f.minUsefulMin} onChange={(e) => setF({ ...f, minUsefulMin: +e.target.value })} /></Field>
          <Field label="Séance par défaut (min)"><input type="number" min={10} value={f.defaultChunkMin} onChange={(e) => setF({ ...f, defaultChunkMin: +e.target.value })} /></Field>
          <Field label="Séance maximale (min)"><input type="number" min={15} value={f.maxChunkMin} onChange={(e) => setF({ ...f, maxChunkMin: +e.target.value })} /></Field>
          <Field label="Priorités visibles sur Aujourd’hui"><input type="number" min={1} max={5} value={f.maxPriorities} onChange={(e) => setF({ ...f, maxPriorities: +e.target.value })} /></Field>
          <Field label="Fuseau"><input type="text" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} /></Field>
        </div>
        <h3 style={{ margin: 0 }}>Trajets et départ</h3>
        {f.travel.map((t, i) => (
          <div key={i} className="grid2">
            <Field label="Trajet"><input type="text" value={t.label} onChange={(e) => setF({ ...f, travel: f.travel.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /></Field>
            <Field label="Durée habituelle (min)" hint={t.minutes ? '' : 'Inconnue : Max propose une marge et le signale'}><input type="number" value={t.minutes ?? ''} onChange={(e) => setF({ ...f, travel: f.travel.map((x, j) => (j === i ? { ...x, minutes: e.target.value ? +e.target.value : undefined } : x)) })} /></Field>
          </div>
        ))}
        <Field label="Départ prévu aujourd’hui (pour « que faire avant de partir ? »)"><input type="time" value={f.departure?.date === today ? f.departure.time : ''} onChange={(e) => setF({ ...f, departure: e.target.value ? { date: today, time: e.target.value } : undefined })} /></Field>
        <h3 style={{ margin: 0 }}>Budgets (à confirmer)</h3>
        <div className="grid2">
          <Field label="Temps business par jour (min)" hint="Export : 45 à 60 min certains jours"><input type="number" value={f.businessDailyMin ?? ''} onChange={(e) => setF({ ...f, businessDailyMin: e.target.value ? +e.target.value : undefined })} /></Field>
          <Field label="Promotion (€/mois)" hint="Export : ≈ 30 €/mois"><input type="number" value={f.promoMonthlyEur ?? ''} onChange={(e) => setF({ ...f, promoMonthlyEur: e.target.value ? +e.target.value : undefined })} /></Field>
          <Field label="Crédits de production (€/mois)"><input type="number" value={f.productionCreditsMonthlyEur ?? ''} onChange={(e) => setF({ ...f, productionCreditsMonthlyEur: e.target.value ? +e.target.value : undefined })} /></Field>
        </div>
        <p className="small muted" style={{ margin: 0 }}>Le budget de temps par domaine (ex. Asclepium 60 min/jour) se règle sur le domaine ; le moteur le respecte au recalage.</p>
        {live(s.state.areas).filter((a) => a.status === 'active' || a.status === 'to_confirm').map((a) => (
          <div key={a.id} className="row small"><span className="grow">{a.name}</span>
            <input type="number" aria-label={`Budget ${a.name} (min/jour)`} placeholder="min/jour" style={{ width: 110 }} defaultValue={a.dailyBudgetMin ?? ''} onBlur={(e) => { const v = e.target.value ? +e.target.value : undefined; if (v !== a.dailyBudgetMin) act(() => s.commit(`Budget ${a.name}`, 'action', [{ store: 'areas', next: { ...a, dailyBudgetMin: v } }])); }} />
          </div>
        ))}
        <div className="btn-row"><button className="btn primary" disabled={!dirty} onClick={() => act(() => A.updatePrefs(s, f))}>Enregistrer les préférences</button></div>
      </div>
    </section>
  );
}

function CalendarImport() {
  const s = useStore();
  const act = useAct();
  const [pv, setPv] = useState<IcsPreview | null>(null);
  const [label, setLabel] = useState('Agenda ENT');
  const last = s.state.prefs.icsLastImport;
  async function onFile(f?: File) {
    if (!f) return;
    setPv(parseIcs(await f.text(), { nowIso: s.nowIso(), tz: s.state.prefs.tz, sourceLabel: label }));
  }
  async function doImport() {
    if (!pv) return;
    const writes: { store: 'blocks' | 'recurrences' | 'prefs'; next: any }[] = [];
    let kept = 0;
    for (const b of pv.blocks) {
      const ex = s.state.blocks.get(b.id);
      if (ex && (ex.version > 1 || ex.deletedAt)) { kept++; continue; } // modifié ou supprimé par toi : on garde ta version
      writes.push({ store: 'blocks', next: ex ? { ...b, createdAt: ex.createdAt } : b });
    }
    for (const r of pv.recurrences) {
      const ex = s.state.recurrences.get(r.id);
      if (ex && (ex.version > 1 || ex.deletedAt)) { kept++; continue; }
      writes.push({ store: 'recurrences', next: ex ? { ...r, createdAt: ex.createdAt } : r });
    }
    await act(() => s.commit(`Import agenda « ${label} » : ${writes.length} élément(s)`, 'import', [...writes, { store: 'prefs' as const, next: { ...s.state.prefs, icsLastImport: { at: s.nowIso(), label, count: writes.length } } }]));
    setPv(null);
    if (kept) alert(`${kept} événement(s) déjà modifié(s) par toi n’ont pas été écrasés.`);
  }
  const upcoming = live(s.state.deadlines).filter((d) => d.date >= localDate(s.clock()) && ['announced', 'to_confirm'].includes(d.status));
  return (
    <section id="s-agenda">
      <h2>Agenda</h2>
      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>Importer un fichier .ics (export de l’ENT, de Google Agenda ou d’Apple Calendrier). Lecture seule : Max n’écrit jamais dans ton agenda. Un second import met à jour sans créer de doublon ; tes modifications locales sont gardées.</p>
        {last && <p className="small" style={{ margin: 0 }}>Dernier import réussi : {DateTime.fromISO(last.at).setLocale('fr').toFormat('d LLL HH:mm')} · {last.label} · {last.count} élément(s).</p>}
        <div className="row">
          <Field label="Nom de la source"><input type="text" value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
          <label className="btn" style={{ alignSelf: 'end' }}>Choisir un .ics…<input type="file" accept=".ics,text/calendar" className="sr-only" onChange={(e) => onFile(e.target.files?.[0])} /></label>
        </div>
        {pv && (
          <div className="card stack">
            <strong>Aperçu</strong>
            <p className="small" style={{ margin: 0 }}>{pv.blocks.length} événement(s) · {pv.recurrences.length} série(s) hebdomadaire(s) · {pv.skipped.length} ignoré(s) ou à vérifier</p>
            {pv.warnings.map((w, i) => <p key={i} className="notice warn small">{w}</p>)}
            {pv.skipped.length > 0 && <details><summary>Ignorés ou à vérifier</summary><ul className="small">{pv.skipped.map((x, i) => <li key={i}>{x.summary} — {x.reason}</li>)}</ul></details>}
            <details><summary>Détail</summary><ul className="small">{pv.recurrences.map((r) => <li key={r.id}>{r.title} · chaque {r.weekdays.join(',')} {r.startTime}–{r.endTime} · du {r.from}{r.until ? ' au ' + r.until : ''}</li>)}{pv.blocks.slice(0, 50).map((b) => <li key={b.id}>{b.title} · {DateTime.fromISO(b.start).setZone(s.state.prefs.tz).toFormat('dd/LL HH:mm')}</li>)}</ul></details>
            <div className="btn-row"><button className="btn primary" onClick={doImport} disabled={pv.blocks.length + pv.recurrences.length === 0}>Importer</button><button className="btn ghost" onClick={() => setPv(null)}>Annuler</button></div>
          </div>
        )}
        <h3 style={{ margin: 0 }}>Rappels</h3>
        <p className="small" style={{ margin: 0 }}>Max n’envoie pas de notifications quand il est fermé. Pour être rappelé la veille de tes échéances, ajoute-les à ton agenda habituel (fichier .ics avec alerte), avec ton accord : rien n’est envoyé.</p>
        <div className="btn-row"><button className="btn" disabled={!upcoming.length} onClick={() => download('max-echeances.ics', deadlineIcs(upcoming, s.state.prefs.tz, s.nowIso()), 'text/calendar')}>Exporter les {upcoming.length} échéance(s) à venir (.ics)</button></div>
      </div>
    </section>
  );
}

function Review() {
  const s = useStore();
  const act = useAct();
  const now = useNow();
  const today = localDate(now);
  const from = addDays(today, -14);
  const batches = s.state.batches.filter((b) => b.at.slice(0, 10) >= from);
  const capDays = new Set(live(s.state.captures).filter((c) => c.createdAt.slice(0, 10) >= from).map((c) => c.createdAt.slice(0, 10)));
  const replanDays = new Set(batches.filter((b) => b.kind === 'replan').map((b) => b.at.slice(0, 10)));
  const usedDays = new Set([...capDays, ...replanDays]);
  const deferred = live(s.state.tasks).filter((t) => (t.deferCount ?? 0) >= 2 && t.status !== 'done').sort((a, b) => (b.deferCount ?? 0) - (a.deferCount ?? 0));
  const toFill = live(s.state.deadlines).filter((d) => ['announced', 'to_confirm'].includes(d.status) && d.date < today);
  const soon = live(s.state.deadlines).filter((d) => ['announced', 'to_confirm'].includes(d.status) && d.date >= today && d.date <= addDays(today, 7));
  const top = deferred[0];
  const pr = top?.projectId ? s.state.projects.get(top.projectId) : undefined;
  const nextSunday = addDays(today, (7 - now.weekday) % 7 || 7);
  return (
    <section id="s-bilan">
      <h2>Revue de semaine et bilan <span className="badge exp">facultatif</span></h2>
      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>Sur 14 jours : Max utilisé (capture ou recalage) <strong>{usedDays.size}</strong> jour(s) · {toFill.length} échéance(s) passée(s) à clarifier · {soon.length} échéance(s) dans les 7 jours.</p>
        {deferred.length > 0 ? (
          <>
            <p className="small" style={{ margin: 0 }}>Souvent reporté : {deferred.slice(0, 5).map((t) => `${t.title} (${t.deferCount}×)`).join(' · ')}</p>
            <div className="notice">
              <strong>Une décision :</strong> « {top.title} » revient sans cesse.
              <div className="btn-row" style={{ marginTop: 6 }}>
                <button className="btn small" onClick={() => act(() => A.scheduleTask(s, top.id, nextSunday, '10:00'))}>Bloquer un vrai créneau dimanche 10 h</button>
                {pr && <button className="btn small" onClick={() => act(() => A.upsertProject(s, { ...pr, status: 'paused' }, 'Mis en pause'))}>Mettre « {pr.name} » en pause</button>}
                {!pr && <button className="btn small" onClick={() => act(() => A.setTaskStatus(s, top.id, 'archived'))}>Archiver la tâche</button>}
              </div>
              <p className="small muted" style={{ margin: '4px 0 0' }}>Réversible depuis l’historique ou la fiche.</p>
            </div>
          </>
        ) : <p className="small muted" style={{ margin: 0 }}>Aucun report récurrent.</p>}
        <button className="btn small ghost" onClick={() => go('journal')}>Ouvrir le journal sommeil / caféine</button>
      </div>
    </section>
  );
}

function History() {
  const s = useStore();
  const [conf, setConf] = useState<{ id: string; list: { label: string; reason: string }[] } | null>(null);
  const items = s.state.batches.filter((b) => b.kind !== 'capture').slice(0, 30);
  async function undo(id: string, force = false) {
    const r = await s.undo(id, force);
    if (r && r.conflicts.length && !force) setConf({ id, list: r.conflicts });
    else setConf(null);
  }
  return (
    <section id="s-historique">
      <h2>Historique des actions</h2>
      <div className="card">
        {conf && (
          <div className="notice warn" role="alert">
            Ces objets ont été modifiés depuis : {conf.list.map((c) => `${c.label} (${c.reason})`).join(', ')}. Les annuler écraserait ta modification plus récente.
            <div className="btn-row" style={{ marginTop: 6 }}><button className="btn small" onClick={() => undo(conf.id, true)}>Annuler quand même le reste du lot</button><button className="btn small ghost" onClick={() => setConf(null)}>Garder tel quel</button></div>
          </div>
        )}
        <ul className="tasklist">
          {items.map((b) => (
            <li key={b.id}>
              <span className="grow small"><span className="muted">{DateTime.fromISO(b.at).setLocale('fr').toFormat('d LLL HH:mm')}</span> {b.label} {b.undoneAt && <span className="badge">annulé</span>}</span>
              {!b.undoneAt && b.kind !== 'undo' && <button className="btn small ghost" onClick={() => undo(b.id)}>Annuler</button>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function VoiceAssistant() {
  const sr = typeof window !== 'undefined' && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  return (
    <section id="s-voix">
      <h2>Voix et assistant</h2>
      <div className="card stack small">
        <p style={{ margin: 0 }}><strong>Dictée du clavier (iPhone, Mac) :</strong> fonctionne toujours dans le champ de capture. Sur iPhone, touche 🎤 du clavier ; sur Mac, double appui sur Fn ou Contrôle.</p>
        <p style={{ margin: 0 }}><strong>Bouton micro du navigateur</strong> <span className="badge exp">expérimental</span> : {sr ? 'disponible sur ce navigateur' : 'indisponible sur ce navigateur'}. La transcription s’affiche dans le champ, rien n’est validé sans toi. Selon le navigateur, l’audio peut être traité par le service de reconnaissance du fournisseur (Apple ou Google).</p>
        <p style={{ margin: 0 }}><strong>Interprétation des phrases :</strong> locale et déterministe (grammaire d’intentions v{GRAMMAR_VERSION}), sans réseau.</p>
        <p style={{ margin: 0 }}><strong>Assistant externe (modèle de langage) :</strong> désactivé — non disponible dans cette version. Aucun appel n’est fait, aucune clé n’est stockée. Il faudra un petit serveur pour le brancher sans exposer de clé.</p>
      </div>
    </section>
  );
}

function Demo() {
  const s = useStore();
  const act = useAct();
  const isDemo = s.space === 'demo';
  function switchTo(space: 'real' | 'demo') {
    try { localStorage.setItem('max.space', space); } catch { /* ignore */ }
    location.hash = '#/aujourdhui';
    location.reload();
  }
  async function fill() {
    const n = A.now(s);
    await act(() => s.commit('Données de démonstration', 'import', demoWrites(s.nowIso(), localDate(n), s.state.prefs.tz)));
  }
  return (
    <section id="s-demo">
      <h2>Espace de démonstration</h2>
      <div className="card stack">
        <p className="small" style={{ margin: 0 }}>Un espace séparé pour essayer le recalage sans toucher à tes vraies données (base distincte sur l’appareil).</p>
        <div className="btn-row">
          {isDemo ? <button className="btn primary" onClick={() => switchTo('real')}>Revenir à mes données</button> : <button className="btn" onClick={() => switchTo('demo')}>Ouvrir la démonstration</button>}
          {isDemo && <button className="btn" onClick={fill}>Remplir avec une journée type</button>}
          {isDemo && <button className="btn ghost danger" onClick={async () => { if (confirm('Vider l’espace de démonstration ?')) await s.wipe(); }}>Vider la démonstration</button>}
        </div>
        {!isDemo && (
          <details>
            <summary>Effacer mes données (zone de danger)</summary>
            <p className="small">Une sauvegarde automatique est faite avant, téléchargeable ci-dessus.</p>
            <button className="btn danger" onClick={async () => { if (confirm('Effacer toutes les données de cet appareil ? Une sauvegarde automatique est faite avant.')) { await s.autoBackup('Avant effacement'); await s.wipe(); } }}>Effacer cet espace</button>
          </details>
        )}
      </div>
    </section>
  );
}
