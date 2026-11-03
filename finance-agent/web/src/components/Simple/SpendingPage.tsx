import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { guessCategory } from '../../standalone/bankin';
import { byCategory, incomeOf, QUICK_CATEGORIES, SPEND_LABELS, spendsOf, total, type Movement, type Spend, type SpendCategory } from '../../standalone/money';
import { addDays } from '../../utils/dates';
import { eur, formatDate, formatMonth } from '../../utils/format';
import { Button, Card, Field, Input, Modal } from '../ui';
import { Icon } from '../ui/icons';
import { ThinBars } from '../ui/MiniBars';
import { AskCard } from './AskCard';
import { Title } from './SimpleLayout';
import { addMovement, replaceMovement, useVault } from './useMoney';

const shift = (ym: string, k: number) => {
  const d = new Date(`${ym}-15T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + k);
  return d.toISOString().slice(0, 7);
};

const SOURCE: Record<Movement['source'], string> = { auto: '', mail: 'trouvé dans tes mails', me: '', bankin: 'alerte Bankin' };

export function SpendingPage() {
  const v = useVault();
  const [month, setMonth] = useState(v.today.slice(0, 7));
  const [edit, setEdit] = useState<Movement | null>(null);
  const [adding, setAdding] = useState(false);
  const [cat, setCat] = useState<SpendCategory | null>(null);
  const spends = spendsOf(month, v.bills, v.money.movements);
  const done = spends.filter((s) => !s.pending);
  const shown = cat ? done.filter((s) => s.category === cat) : done;
  const pending = v.money.movements.filter((m) => m.status === 'pending' && spends.some((s) => s.id === m.id));
  const out = total(spends);
  const inc = incomeOf(month, v.incomes, v.money.movements);
  const rows = byCategory(spends.filter((s) => !s.pending));

  const open = (s: Spend) => {
    const m = v.money.movements.find((x) => x.id === s.id);
    if (m) setEdit(m);
  };

  const days = [...new Set(shown.map((s) => s.date))];

  return (
    <div>
      <Title>Dépenses</Title>
      <div className="mb-4 flex items-center justify-between">
        <button onClick={() => setMonth(shift(month, -1))} className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-ink" aria-label="Mois précédent">
          <Icon name="left" />
        </button>
        <span className="text-sm font-medium first-letter:uppercase">{formatMonth(month, true)}</span>
        <button
          onClick={() => setMonth(shift(month, 1))}
          disabled={month >= v.today.slice(0, 7)}
          className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-ink disabled:opacity-30"
          aria-label="Mois suivant"
        >
          <Icon name="right" />
        </button>
      </div>

      <Card className="p-5">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-xs text-muted">Sorties</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{eur(out)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Entrées</p>
            <p className="mt-1 text-lg font-semibold tabular-nums">{eur(inc)}</p>
          </div>
          <div>
            <p className="text-xs text-muted">Reste</p>
            <p className={`mt-1 text-lg font-semibold tabular-nums ${inc - out < 0 ? 'text-red-400' : ''}`}>{eur(inc - out)}</p>
          </div>
        </div>
        {rows.length > 0 && (
          <div className="mt-6">
            <ThinBars rows={rows} format={eur} />
          </div>
        )}
      </Card>

      {pending.length > 0 && (
        <div className="mt-4 space-y-4">
          {pending.map((m) => (
            <AskCard key={m.id} m={m} today={v.today} />
          ))}
        </div>
      )}

      <div className="mb-2 mt-6 flex items-center justify-between gap-2">
        <div className="flex min-w-0 gap-1.5 overflow-x-auto pb-1">
          <Chip on={!cat} onClick={() => setCat(null)}>
            Tout
          </Chip>
          {rows.map((r) => (
            <Chip key={r.key} on={cat === r.key} onClick={() => setCat(cat === r.key ? null : r.key)}>
              {r.label}
            </Chip>
          ))}
        </div>
        <Button onClick={() => setAdding(true)} className="shrink-0 px-3" aria-label="Ajouter une dépense">
          <Icon name="plus" className="h-4 w-4" />
          Ajouter
        </Button>
      </div>

      {shown.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted">Aucune dépense ce mois-ci pour l'instant.</Card>
      ) : (
        <Card className="divide-y divide-white/5 px-5">
          {days.map((d) => (
            <div key={d} className="py-3">
              <p className="mb-1.5 text-xs first-letter:uppercase text-muted">{formatDate(d, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
              <ul className="space-y-1">
                {shown
                  .filter((s) => s.date === d)
                  .map((s) => (
                    <li key={s.id}>
                      <button
                        onClick={() => (s.kind === 'movement' ? open(s) : undefined)}
                        className={`flex w-full items-center justify-between gap-3 rounded-xl py-1.5 text-left text-sm ${s.kind === 'movement' ? 'hover:bg-white/5' : 'cursor-default'}`}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">{s.label}</span>
                          <span className="block text-xs text-muted">
                            {SPEND_LABELS[s.category]}
                            {s.kind === 'bill' ? ' · facture' : s.source && SOURCE[s.source] ? ` · ${SOURCE[s.source]}` : ''}
                          </span>
                        </span>
                        <span className="shrink-0 tabular-nums">{eur(-s.amount)}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </Card>
      )}
      <p className="mt-3 text-center text-xs text-muted">
        Les factures se gèrent dans{' '}
        <Link to="/factures" className="underline-offset-2 hover:underline">
          Factures et abonnements
        </Link>
        .
      </p>

      {edit && <EditMovement m={edit} onClose={() => setEdit(null)} />}
      {adding && <AddSpend today={v.today} onClose={() => setAdding(false)} />}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-xs ${on ? 'bg-ink text-on-ink' : 'bg-card text-ink/80 hover:text-ink'}`}>
      {children}
    </button>
  );
}

function CategoryPicker({ value, onChange }: { value: SpendCategory; onChange: (c: SpendCategory) => void }) {
  const all = [...QUICK_CATEGORIES, ...(Object.keys(SPEND_LABELS) as SpendCategory[]).filter((c) => !QUICK_CATEGORIES.includes(c))];
  return (
    <div className="flex flex-wrap gap-1.5">
      {all.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          className={`rounded-full px-3 py-1.5 text-xs ${value === c ? 'bg-ink text-on-ink' : 'bg-field text-ink/80 hover:text-ink'}`}
        >
          {SPEND_LABELS[c]}
        </button>
      ))}
    </div>
  );
}

function EditMovement({ m, onClose }: { m: Movement; onClose: () => void }) {
  const [label, setLabel] = useState(m.label === 'Non précisé' ? '' : m.label);
  const [category, setCategory] = useState<SpendCategory>(m.category);
  const save = (e: FormEvent) => {
    e.preventDefault();
    replaceMovement(m, { ...m, label: label.trim() || SPEND_LABELS[category], category, source: m.source === 'auto' ? 'me' : m.source });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title={eur(m.amount)}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Ce que c'était">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. courses, kebab, essence" />
        </Field>
        <CategoryPicker value={category} onChange={setCategory} />
        {m.mailUrl && (
          <a href={m.mailUrl} target="_blank" rel="noreferrer" className="block text-xs text-muted underline-offset-2 hover:text-ink hover:underline">
            Voir le mail correspondant
          </a>
        )}
        <div className="flex justify-between gap-2 pt-2">
          {m.source === 'me' && m.from && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                replaceMovement(m, null);
                onClose();
              }}
            >
              Supprimer
            </Button>
          )}
          <Button type="submit" className="ml-auto">
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AddSpend({ today, onClose }: { today: string; onClose: () => void }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today);
  const [category, setCategory] = useState<SpendCategory | null>(null);
  const [busy, setBusy] = useState(false);
  const value = Math.abs(Number(amount.replace(/\s/g, '').replace(',', '.')));
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!value || !date) return;
    setBusy(true);
    const cat = category ?? (await guessCategory(label));
    addMovement({
      id: `me_${Date.now().toString(36)}`,
      from: date,
      to: addDays(date, 1),
      amount: -Math.round(value * 100) / 100,
      label: label.trim() || SPEND_LABELS[cat],
      category: cat,
      status: 'done',
      source: 'me',
      createdAt: new Date().toISOString(),
    });
    onClose();
  };
  return (
    <Modal open onClose={onClose} title="Ajouter une dépense">
      <form onSubmit={save} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Montant (€)">
            <Input autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12,50" />
          </Field>
          <Field label="Date">
            <Input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Ce que c'était">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex. courses Leclerc" />
        </Field>
        <CategoryPicker value={category ?? ('' as SpendCategory)} onChange={setCategory} />
        <p className="text-xs text-muted">Sans catégorie choisie, je la devine. Cette dépense explique d'avance la baisse de ton solde ce jour-là.</p>
        <div className="flex justify-end">
          <Button type="submit" disabled={!value || busy}>
            {busy ? 'Je range…' : 'Ajouter'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
