import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Input } from '../components/ui';
import { Icon } from '../components/ui/icons';
import { createVault, eraseVault, getSaveStatus, lockVault, onSaveStatus, unlockVault, vaultStatus, type SaveStatus } from './vault';

type Kind = 'cloud' | 'browser' | 'memory';
type Phase = { step: 'loading' } | { step: 'create' | 'unlock'; kind: Kind } | { step: 'open'; kind: Kind };

const AUTO_LOCK_MS = 30 * 60_000;
const MIN_CODE = 4;

let lockNow: () => void = () => {};
/** Verrouille l'app depuis n'importe quel composant. */
export const requestLock = () => lockNow();

/**
 * Porte d'entrée de l'app autonome : création du code au premier lancement,
 * puis saisie du code à chaque ouverture. Verrouillage auto après 30 min sans activité.
 */
export function LockGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ step: 'loading' });
  const [kind, setKind] = useState<Kind>('memory');

  const refresh = useCallback(async () => {
    const s = await vaultStatus();
    setKind(s.kind);
    setPhase(s.unlocked ? { step: 'open', kind: s.kind } : { step: s.exists ? 'unlock' : 'create', kind: s.kind });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const lock = useCallback(async () => {
    await lockVault();
    qc.clear();
    setPhase({ step: 'unlock', kind });
  }, [qc, kind]);
  lockNow = () => void lock();

  useEffect(() => {
    if (phase.step !== 'open') return;
    let timer = setTimeout(lock, AUTO_LOCK_MS);
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(lock, AUTO_LOCK_MS);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [phase.step, lock]);

  if (phase.step === 'loading') {
    return (
      <Shell>
        <p className="text-center text-sm text-muted">Ouverture…</p>
      </Shell>
    );
  }
  if (phase.step === 'open') return <>{children}</>;
  return (
    <LockScreen
      mode={phase.step}
      kind={phase.kind}
      onOpen={() => {
        qc.clear();
        setPhase({ step: 'open', kind: phase.kind });
      }}
      onErased={() => setPhase({ step: 'create', kind: phase.kind })}
    />
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-card text-ink">
            <Icon name="lock" className="h-6 w-6" />
          </span>
          <h1 className="text-xl font-semibold tracking-tight">Agent financier</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

const WHERE: Record<Kind, string> = {
  cloud: 'Vos données sont chiffrées avec ce code puis enregistrées dans votre espace privé claude.ai, que vous seul pouvez lire.',
  browser: 'Vos données sont chiffrées avec ce code puis enregistrées dans ce navigateur.',
  memory: "Ce navigateur ne permet pas d'enregistrer : vos données seront perdues à la fermeture.",
};

function LockScreen({ mode, kind, onOpen, onErased }: { mode: 'create' | 'unlock'; kind: Kind; onOpen: () => void; onErased: () => void }) {
  const [code, setCode] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [forgot, setForgot] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (mode === 'create') {
      if (code.length < MIN_CODE) return setError(`Au moins ${MIN_CODE} caractères.`);
      if (code !== confirm) return setError('Les deux codes ne correspondent pas.');
    }
    setBusy(true);
    try {
      if (mode === 'create') {
        await createVault(code);
        onOpen();
      } else if (await unlockVault(code)) {
        onOpen();
      } else {
        setError('Code incorrect.');
        setCode('');
      }
    } catch (err) {
      setError((err as Error).message || 'Impossible d’ouvrir les données.');
    } finally {
      setBusy(false);
    }
  };

  if (forgot) {
    return (
      <Shell>
        <div className="space-y-4 rounded-[28px] bg-card p-6">
          <h2 className="font-medium">Code oublié</h2>
          <p className="text-sm text-muted">
            Le code sert de clé de chiffrement : personne ne peut le retrouver. La seule issue est de tout effacer et de repartir de zéro avec un
            nouveau code.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" className="bg-field" onClick={() => setForgot(false)}>
              Annuler
            </Button>
            <Button
              variant="danger"
              onClick={async () => {
                await eraseVault();
                setForgot(false);
                onErased();
              }}
            >
              Tout effacer
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <form onSubmit={submit} className="space-y-4 rounded-[28px] bg-card p-6">
        <div>
          <h2 className="font-medium">{mode === 'create' ? 'Choisissez un code d’accès' : 'Entrez votre code d’accès'}</h2>
          {mode === 'create' && <p className="mt-1 text-sm text-muted">Il sera demandé à chaque ouverture. Notez-le : il ne peut pas être récupéré.</p>}
        </div>
        <Field label="Code d’accès">
          <Input type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </Field>
        {mode === 'create' && (
          <Field label="Confirmez le code">
            <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
        )}
        {error && (
          <p className="text-sm text-red-400" role="alert">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={busy || !code}>
          {busy ? 'Un instant…' : mode === 'create' ? 'Créer et ouvrir' : 'Déverrouiller'}
        </Button>
        <p className="text-xs text-muted">{WHERE[kind]}</p>
        {mode === 'unlock' && (
          <button type="button" onClick={() => setForgot(true)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Code oublié ?
          </button>
        )}
      </form>
    </Shell>
  );
}

const STATUS: Record<SaveStatus, string> = {
  saved: 'Enregistré',
  saving: 'Enregistrement…',
  error: "Échec de l'enregistrement, nouvel essai à la prochaine modification",
};

/** Ligne discrète : état de l'enregistrement et bouton de verrouillage. */
export function SaveBar() {
  const [status, setStatus] = useState<SaveStatus>(getSaveStatus());
  const [kind, setKind] = useState<Kind | null>(null);
  useEffect(() => onSaveStatus(setStatus), []);
  useEffect(() => {
    vaultStatus().then((s) => setKind(s.kind)).catch(() => {});
  }, []);
  const where = kind === 'cloud' ? ' dans votre espace privé' : kind === 'browser' ? ' dans ce navigateur' : '';
  return (
    <div className="mb-4 flex items-center justify-between gap-3 text-xs text-muted">
      <span className={status === 'error' || kind === 'memory' ? 'text-red-400' : ''}>
        {kind === 'memory' ? 'Rien n’est enregistré : vos données seront perdues à la fermeture.' : `${STATUS[status]}${status === 'saved' ? where : ''}`}
      </span>
      <button onClick={requestLock} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-ink/70 hover:bg-white/5 hover:text-ink">
        <Icon name="lock" className="h-4 w-4" />
        Verrouiller
      </button>
    </div>
  );
}
