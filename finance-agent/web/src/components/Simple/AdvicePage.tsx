import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSample } from '../../standalone/bankin';
import { byCategory, incomeOf, insights, spendsOf, total, type Insight } from '../../standalone/money';
import { currentState, scheduleSave } from '../../standalone/vault';
import { EMPTY_PLAN } from '../../utils/plan';
import { eur, formatMonth } from '../../utils/format';
import { Button, Card, Input } from '../ui';
import { Title } from './SimpleLayout';
import { useVault } from './useMoney';

const TONE: Record<Insight['tone'], string> = { warn: 'À corriger', info: 'À savoir', good: 'Ça va bien' };

export function AdvicePage() {
  const v = useVault();
  const list = insights({
    today: v.today,
    bills: v.bills,
    incomes: v.incomes,
    movements: v.money.movements,
    balances: v.money.balances,
    savingsGoal: v.plan.savingsGoal,
    subscriptionsMonthly: v.subscriptionsMonthly,
    subscriptionsCount: v.subscriptionsCount,
  });

  return (
    <div className="space-y-4">
      <Title sub="Ce que je remarque dans tes dépenses, et comment mettre de côté.">Conseils</Title>

      {list.length === 0 ? (
        <Card className="p-6 text-sm text-muted">Il me faut quelques jours de soldes et de dépenses pour te donner des conseils utiles.</Card>
      ) : (
        <Card className="divide-y divide-white/5 px-5">
          {list.map((i) => (
            <div key={i.id} className="py-4">
              <p className={`text-[11px] uppercase tracking-wide ${i.tone === 'warn' ? 'text-orange-400' : 'text-muted'}`}>{TONE[i.tone]}</p>
              <p className="mt-1 font-medium">{i.title}</p>
              <p className="mt-0.5 text-sm text-muted">{i.detail}</p>
            </div>
          ))}
        </Card>
      )}

      <SavingsGoal goal={v.plan.savingsGoal} />
      <AskClaude />

      <Card className="p-5">
        <p className="font-medium">Aides et pistes</p>
        <p className="mt-1 text-sm text-muted">Bourse, CAF, Crous, prime d'activité, tarif résident : suis tes demandes et les idées pour gagner plus ou dépenser moins.</p>
        <Link to="/plan" className="mt-3 inline-block text-sm underline-offset-2 hover:underline">
          Ouvrir le plan
        </Link>
      </Card>
    </div>
  );
}

function SavingsGoal({ goal }: { goal: number | null }) {
  const [value, setValue] = useState(goal ? String(goal) : '');
  const [saved, setSaved] = useState(false);
  const save = () => {
    const n = Math.abs(Number(value.replace(',', '.')));
    const s = currentState();
    s.plan = { ...(s.plan ?? EMPTY_PLAN), savingsGoal: n > 0 ? n : null };
    scheduleSave();
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };
  return (
    <Card className="p-5">
      <p className="font-medium">Objectif d'épargne par mois</p>
      <p className="mt-1 text-sm text-muted">Je le retire de ce que tu peux dépenser chaque jour.</p>
      <div className="mt-3 flex items-center gap-2">
        <Input inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ex. 50" className="w-28" aria-label="Objectif d'épargne" />
        <span className="text-muted">€</span>
        <Button variant="secondary" className="bg-field" onClick={save}>
          {saved ? 'Enregistré' : 'Enregistrer'}
        </Button>
      </div>
    </Card>
  );
}

/** Avis de Claude sur le mois, à partir des chiffres (aucun nom ni mail envoyé). */
function AskClaude() {
  const v = useVault();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => {
    void getSample().then((s) => setAvailable(!!s));
    return () => ctl.current?.abort();
  }, []);
  if (available === false) return null;

  async function ask() {
    const sample = await getSample();
    if (!sample) return;
    const months = [0, 1, 2, 3].map((k) => {
      const d = new Date(`${v.today.slice(0, 7)}-15T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() - k);
      return d.toISOString().slice(0, 7);
    });
    const data = months.map((m) => {
      const sp = spendsOf(m, v.bills, v.money.movements).filter((s) => !s.pending);
      return `${formatMonth(m, true)}${m === v.today.slice(0, 7) ? ` (jusqu'au ${Number(v.today.slice(8))})` : ''} : sorties ${eur(total(sp))}, entrées ${eur(incomeOf(m, v.incomes, v.money.movements))}. Par catégorie : ${byCategory(sp)
        .map((c) => `${c.label} ${eur(c.value)}`)
        .join(', ') || 'aucune'}.`;
    });
    const last = v.money.balances.at(-1);
    const prompt = `Tu es un conseiller budgétaire bienveillant et direct pour un étudiant en Corse qui veut économiser.
Voici ses chiffres :
${data.join('\n')}
Solde actuel : ${last ? eur(last.amount) : 'inconnu'}. Abonnements : ${v.subscriptionsCount}, ${eur(v.subscriptionsMonthly)} par mois. Objectif d'épargne : ${v.plan.savingsGoal ? eur(v.plan.savingsGoal) + ' par mois' : 'aucun'}.
Réponds en français, en tutoyant, en 4 à 6 phrases courtes sans titres ni listes ni emojis : ce qu'il a mal fait ce mois-ci, ce qui va bien, et deux actions concrètes chiffrées pour économiser le mois prochain.`;
    ctl.current?.abort();
    ctl.current = new AbortController();
    setBusy(true);
    setNote('');
    setText('');
    try {
      await sample(prompt, { signal: ctl.current.signal, onText: ({ text: t }: { text: string }) => setText(t) });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setText((e as { text?: string }).text ?? '');
      if (code === 'not_granted' || code === 'sampling_disabled') setAvailable(false);
      else if (code === 'rate_limited') setNote('Trop de demandes pour le moment, réessaie plus tard.');
      else if (code !== 'cancelled') setNote("Claude n'a pas pu répondre, réessaie dans un moment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <p className="font-medium">L'avis de Claude sur ton mois</p>
      <p className="mt-1 text-sm text-muted">Seuls les totaux par catégorie sont envoyés, pas tes mails.</p>
      {(text || busy) && <p className="mt-3 whitespace-pre-line text-sm leading-relaxed">{text || 'Je regarde tes chiffres…'}</p>}
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={ask} disabled={busy}>
          {text ? 'Redemander' : 'Demander'}
        </Button>
        {busy && (
          <Button variant="ghost" onClick={() => ctl.current?.abort()}>
            Arrêter
          </Button>
        )}
      </div>
    </Card>
  );
}
