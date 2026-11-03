import { useState, type FormEvent } from 'react';
import { guessCategory, markAnswered } from '../../standalone/bankin';
import { answer, QUICK_CATEGORIES, SPEND_LABELS, type Movement, type SpendCategory } from '../../standalone/money';
import { addDays, daysBetween } from '../../utils/dates';
import { eur, formatDate } from '../../utils/format';
import { Button, Card, Input } from '../ui';
import { replaceMovement } from './useMoney';

/** "hier", "lundi 2 nov." ou "entre le 31 oct. et le 2 nov." */
export function when(m: Pick<Movement, 'from' | 'to'>, today: string) {
  const span = daysBetween(m.from, m.to);
  if (span <= 1) {
    if (m.from === addDays(today, -1)) return 'hier';
    if (m.from === today) return "aujourd'hui";
    return `le ${formatDate(m.from, { weekday: 'long', day: 'numeric', month: 'short' })}`;
  }
  return `entre le ${formatDate(m.from, { day: 'numeric', month: 'short' })} et le ${formatDate(addDays(m.to, -1), { day: 'numeric', month: 'short' })}`;
}

/** Question posée quand le solde a baissé sans explication. */
export function AskCard({ m, today }: { m: Movement; today: string }) {
  const [label, setLabel] = useState('');
  const [cat, setCat] = useState<SpendCategory | null>(null);
  const [split, setSplit] = useState(false);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const total = Math.abs(m.amount);

  async function submit(e?: FormEvent, chosen = cat) {
    e?.preventDefault();
    if (!label.trim() && !chosen) return;
    setBusy(true);
    const category = chosen ?? (await guessCategory(label));
    const value = split ? Math.min(total, Math.abs(Number(amount.replace(',', '.')) || total)) : total;
    replaceMovement(m, answer(m, label, category, value));
    if (value >= total) markAnswered(m);
  }

  return (
    <Card className="p-5">
      <p className="text-sm text-muted">Ton solde a baissé {when(m, today)}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{eur(-total)}</p>
      {m.suggestion ? (
        <div className="mt-3 rounded-2xl bg-field p-4">
          <p className="text-sm">
            Un mail de <span className="font-medium">{m.suggestion.label}</span> parle du même montant
            {m.suggestion.subject ? ` (« ${m.suggestion.subject} »)` : ''}. C'était ça ?
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button onClick={() => setLabel(m.suggestion!.label)} variant="secondary" className="bg-card">
              Oui, c'est ça
            </Button>
            <Button variant="ghost" onClick={() => replaceMovement(m, { ...m, suggestion: null })}>
              Non
            </Button>
            {m.suggestion.url && (
              <a href={m.suggestion.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
                Voir le mail
              </a>
            )}
          </div>
          {label === m.suggestion.label && <p className="mt-2 text-xs text-muted">Choisis la catégorie ci-dessous, puis Ranger.</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm">Je n'ai trouvé aucune preuve dans tes mails. C'était quoi ?</p>
      )}
      <form onSubmit={submit} className="mt-3 space-y-3">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. courses Leclerc, kebab, essence" aria-label="Ce que c'était" />
        <div className="flex flex-wrap gap-1.5">
          {QUICK_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCat(cat === c ? null : c)}
              className={`rounded-full px-3 py-1.5 text-xs ${cat === c ? 'bg-ink text-on-ink' : 'bg-field text-ink/80 hover:text-ink'}`}
            >
              {SPEND_LABELS[c]}
            </button>
          ))}
        </div>
        {split ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted">Montant de cette dépense</span>
            <Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={total.toFixed(2).replace('.', ',')} className="w-28" />
            <span className="text-muted">€</span>
          </div>
        ) : (
          <button type="button" onClick={() => setSplit(true)} className="text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            C'était plusieurs choses ?
          </button>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-xs text-muted">{cat ? `Rangé dans ${SPEND_LABELS[cat]}` : label.trim() ? 'Je devine la catégorie' : ''}</span>
          <Button type="submit" disabled={busy || (!label.trim() && !cat)}>
            {busy ? 'Je range…' : 'Ranger'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
