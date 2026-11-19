import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Capture as Cap, ID, Intent } from '../core/types';
import { useStore } from '../app/store';
import * as A from '../app/actions';
import { useAct, useUI } from './common';

type SR = any;
function getSR(): SR | null {
  const w = window as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export interface CaptureHandle { focus: () => void; show: (id: ID) => void }

export const CaptureBar = forwardRef<CaptureHandle>(function CaptureBar(_, ref) {
  const s = useStore();
  const ui = useUI();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<ID | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recRef = useRef<any>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus(), show: (id) => setShown(id) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); inputRef.current?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const c = await A.submitCapture(s, t);
      setText('');
      setShown(c.id);
      const b = s.state.batches[0];
      if (c.status === 'done' && b) ui.toast('Capturé', null);
    } catch (err: any) {
      ui.toast('Capture non enregistrée : ' + (err?.message ?? err), null, true);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const Rec = getSR();
    if (!Rec) return;
    if (listening) { recRef.current?.stop(); return; }
    setVoiceErr(null);
    const rec = new Rec();
    rec.lang = 'fr-FR';
    rec.interimResults = true;
    rec.continuous = false;
    const base = text ? text + ' ' : '';
    rec.onresult = (ev: any) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      setText(base + t);
    };
    rec.onerror = (ev: any) => setVoiceErr(ev.error === 'not-allowed' ? 'Micro refusé : utilise la dictée du clavier.' : 'Dictée indisponible : ' + ev.error);
    rec.onend = () => { setListening(false); inputRef.current?.focus(); };
    recRef.current = rec;
    try { rec.start(); setListening(true); } catch (err: any) { setVoiceErr(String(err?.message ?? err)); }
  }

  const cap = shown ? s.state.captures.get(shown) : undefined;
  const hasSR = typeof window !== 'undefined' && !!getSR();
  return (
    <div className="capture">
      <form onSubmit={submit} role="search" aria-label="Capture">
        <label htmlFor="cap-input" className="sr-only">Ajouter ou dire quelque chose</label>
        <input id="cap-input" ref={inputRef} type="text" enterKeyHint="send" autoComplete="off" placeholder="Ajouter ou dire quelque chose…  (⌘K)" value={text} onChange={(e) => setText(e.target.value)} disabled={busy} />
        {hasSR && (
          <button type="button" className="btn mic" aria-pressed={listening} onClick={toggleMic} aria-label={listening ? 'Arrêter la dictée' : 'Dicter (expérimental)'} title="Dictée du navigateur (expérimental)">
            {listening ? '■ Stop' : '🎤'}
          </button>
        )}
        <button className="btn primary" type="submit" disabled={busy || !text.trim()}>{busy ? '…' : 'OK'}</button>
      </form>
      {listening && <p className="small" role="status" style={{ margin: '4px 0 0' }}>● J’écoute… la transcription s’affiche dans le champ, rien n’est envoyé avant « OK ».</p>}
      {voiceErr && <p className="small" role="alert" style={{ margin: '4px 0 0', color: 'var(--danger)' }}>{voiceErr}</p>}
      {cap && <CaptureResult cap={cap} onClose={() => setShown(null)} />}
    </div>
  );
});

export function CaptureResult({ cap, onClose }: { cap: Cap; onClose?: () => void }) {
  const s = useStore();
  const act = useAct();
  return (
    <div className="cap-result" aria-live="polite">
      <div className="row small">
        <span className="grow muted">« {cap.text} »</span>
        {onClose && <button className="btn small ghost" onClick={onClose} aria-label="Fermer le résultat">Fermer</button>}
      </div>
      {cap.status === 'failed' && (
        <div className="intent needs">
          <p style={{ margin: 0 }}>Je n’ai pas su interpréter cette phrase. Elle reste dans la boîte de réception.</p>
          <div className="btn-row" style={{ marginTop: 6 }}>
            <button className="btn small" onClick={() => act(() => A.interpretCapture(s, cap.id), '')}>Réessayer</button>
            <button className="btn small" onClick={() => act(() => A.createTask(s, { title: cap.text, captureId: cap.id, status: 'inbox' }))}>En faire une tâche</button>
          </div>
        </div>
      )}
      {cap.parse?.intents.map((it, i) => <IntentView key={i} cap={cap} intent={it} index={i} />)}
    </div>
  );
}

function IntentView({ cap, intent, index }: { cap: Cap; intent: Intent; index: number }) {
  const s = useStore();
  const ui = useUI();
  const act = useAct();
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const applied = cap.applied[index];
  const missing = A.unresolved(intent, answers);
  const opensPreview = ['replan', 'energy'].includes(intent.type) || (intent.type === 'move' && (intent.fields.target === 'deadline' && (answers.choice ?? intent.fields.choice) === 'move_prep'));

  async function apply() {
    if (busy) return;
    setBusy(true);
    try {
      const r = await act(() => A.applyIntent(s, cap.id, index, answers), '');
      if (r?.open?.kind === 'replan') ui.openReplan(r.open.facts, cap.id);
      if (r?.open?.kind === 'answer') setAnswer(r.open.text);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={'intent ' + (applied ? 'ok' : 'needs')}>
      <div className="row nowrap">
        <span className="grow"><strong>{applied ? '✓ ' : ''}</strong>{intent.label}</span>
        {applied && applied[0] !== '—' && <button className="btn small" onClick={() => act(() => A.undoIntent(s, cap.id, index), 'Annulé')}>Annuler</button>}
      </div>
      {!applied && (
        <div className="stack" style={{ marginTop: 6 }}>
          {intent.ambiguities.map((a) => (
            <div key={a.field}>
              <div className="small" style={{ fontWeight: 600 }}>{a.question}</div>
              <div className="btn-row" style={{ marginTop: 4 }}>
                {a.options?.map((o) => (
                  <button key={String(o.value)} className="chip" aria-pressed={answers[a.field] === o.value} onClick={() => setAnswers((x) => ({ ...x, [a.field]: o.value }))}>{o.label}</button>
                ))}
                {/(date|dueDate)$/.test(a.field) && <input type="date" aria-label="Choisir une date" style={{ width: 170 }} onChange={(e) => setAnswers((x) => ({ ...x, [a.field]: e.target.value }))} />}
                {a.field === 'travel.minutes' && <input type="number" aria-label="Durée du trajet en minutes" placeholder="min" style={{ width: 90 }} onChange={(e) => setAnswers((x) => ({ ...x, [a.field]: +e.target.value }))} />}
              </div>
            </div>
          ))}
          {intent.type === 'create_event' && intent.fields.durationGuessed && <p className="small muted" style={{ margin: 0 }}>Durée proposée : {intent.fields.durationMin} min (modifiable ensuite dans l’agenda).</p>}
          <div className="btn-row">
            <button className="btn small primary" disabled={missing.length > 0 || busy} onClick={apply}>
              {opensPreview ? 'Voir l’aperçu' : intent.type === 'query_before_departure' ? 'Répondre' : 'Valider'}
            </button>
            {missing.length > 0 && <span className="small muted">Réponds d’abord {missing.length > 1 ? 'aux questions' : 'à la question'} ci-dessus.</span>}
            {index === (cap.parse?.intents.length ?? 1) - 1 && <span className="small muted">Tu peux fermer : la phrase reste dans la boîte de réception.</span>}
          </div>
        </div>
      )}
      {answer && <p className="notice" style={{ marginTop: 6 }}>{answer}</p>}
    </div>
  );
}
