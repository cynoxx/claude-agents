import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { SyncResult } from '../../standalone/bankin';
import { dailyAllowance, endOfMonth, mergeBalances, spendsOf, total } from '../../standalone/money';
import { currentState, scheduleSave } from '../../standalone/vault';
import { money, refreshMovements } from '../../standalone/bankin';
import { addDays } from '../../utils/dates';
import { eur, formatDate } from '../../utils/format';
import { Button, Card, Input } from '../ui';
import { Icon } from '../ui/icons';
import { MiniBars, type MiniBar } from '../ui/MiniBars';
import { AskCard } from './AskCard';
import { useBankinSync, useVault } from './useMoney';

const SYNC_TEXT: Record<Exclude<SyncResult, { ok: true }>['reason'], string> = {
  unavailable: "La lecture de tes mails ne marche que dans claude.ai. Tu peux saisir ton solde à la main en attendant.",
  not_connected: 'Connecte Gmail dans claude.ai (Paramètres, Connecteurs) pour que je lise ton solde Bankin chaque jour.',
  reauth: 'Gmail est déconnecté : reconnecte-le dans claude.ai (Paramètres, Connecteurs).',
  denied: "Tu n'as pas autorisé cette page à lire Gmail. Tu peux le permettre dans le menu Autorisations de la page.",
  error: "Gmail n'a pas répondu. Réessaie dans un moment.",
};

const DAY = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];

export function TodayPage() {
  const v = useVault();
  const { busy, result, run } = useBankinSync();
  const { balances, movements } = v.money;
  const last = balances.at(-1);
  const prev = balances.at(-2);
  const pending = movements.filter((m) => m.status === 'pending');
  const allowance = last ? dailyAllowance(last.amount, v.today, v.bills, v.incomes, v.plan.savingsGoal) : null;
  // Sorties des 14 derniers jours (factures payées + baisses rangées ou à préciser)
  const recent = [...spendsOf(v.today.slice(0, 7), v.bills, movements), ...spendsOf(addDays(v.today, -14).slice(0, 7), v.bills, movements)].filter(
    (s, i, all) => s.date > addDays(v.today, -14) && all.findIndex((x) => x.id === s.id) === i,
  );
  const weekSpent = total(recent.filter((s) => s.date > addDays(v.today, -7)));
  const upcoming = v.bills.filter((b) => !b.paid && b.dueDate >= v.today && b.dueDate <= addDays(v.today, 7)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const bars: MiniBar[] = Array.from({ length: 14 }, (_, k) => {
    const day = addDays(v.today, k - 13);
    return {
      key: day,
      label: DAY[new Date(`${day}T00:00:00Z`).getUTCDay()]!,
      title: `dépensé ${day === v.today ? "aujourd'hui" : formatDate(day, { weekday: 'long', day: 'numeric' })}`,
      value: total(recent.filter((s) => s.date === day)),
      highlight: day === v.today,
    };
  });

  return (
    <div className="space-y-4">
      <p className="text-sm first-letter:uppercase text-muted">{formatDate(v.today, { weekday: 'long', day: 'numeric', month: 'long' })}</p>

      <Card className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted">Sur ton compte</p>
            <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{last ? eur(last.amount) : '—'}</p>
            {last && prev && (
              <p className="mt-2 text-sm text-muted">
                {last.amount - prev.amount >= 0 ? '+' : ''}
                {eur(last.amount - prev.amount)} depuis {prev.date === addDays(last.date, -1) ? 'la veille' : `le ${formatDate(prev.date, { day: 'numeric', month: 'short' })}`}
              </p>
            )}
          </div>
          <button
            onClick={run}
            disabled={busy}
            className="rounded-full p-2 text-muted hover:bg-white/5 hover:text-ink disabled:opacity-50"
            aria-label="Relire mes mails Bankin"
            title="Relire mes mails Bankin"
          >
            <Icon name="refresh" className={`h-5 w-5 ${busy ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          {busy
            ? 'Je lis tes mails Bankin…'
            : last
              ? `Solde Bankin ${last.date === v.today ? 'de ce matin' : `du ${formatDate(last.date, { day: 'numeric', month: 'long' })}`}, La Banque Postale`
              : result && !result.ok
                ? ''
                : 'Je lis ton solde dans le mail Bankin de chaque matin.'}
        </p>
        {result && !result.ok && <p className="mt-3 text-sm text-ink/80">{SYNC_TEXT[result.reason]}</p>}
        {!busy && (!last || (result && !result.ok)) && <ManualBalance today={v.today} />}
        {last && recent.length > 0 && (
          <div className="mt-5">
            <MiniBars bars={bars} height={80} format={eur} />
          </div>
        )}
      </Card>

      {pending[0] && <AskCard key={pending[0].id} m={pending[0]} today={v.today} />}
      {pending[0] && !movements.some((m) => m.source === 'bankin' && m.from > addDays(v.today, -30)) && (
        <Card className="p-5">
          <p className="font-medium">Pour que je sache tout seul d'où vient chaque dépense</p>
          <p className="mt-1 text-sm text-muted">
            Dans l'appli Bankin, ouvre Profil, puis Notifications, puis Alertes de transactions, et mets le seuil au plus bas. Bankin t'enverra alors un mail
            par opération, avec le nom du commerçant : je les lis et je range chaque dépense sans te poser de question.
          </p>
        </Card>
      )}
      {pending.length > 1 && (
        <Link to="/depenses" className="block text-center text-sm text-muted hover:text-ink">
          {pending.length - 1} autre{pending.length > 2 ? 's' : ''} baisse{pending.length > 2 ? 's' : ''} à préciser
        </Link>
      )}

      {allowance && (
        <Card className="p-5">
          <p className="text-sm text-muted">Pour finir le mois</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {eur(allowance.perDay)}
            <span className="text-base font-normal text-muted"> par jour</span>
          </p>
          <p className="mt-2 text-sm text-muted">
            Jusqu'au {Number(endOfMonth(v.today).slice(8))} ({allowance.daysLeft} jour{allowance.daysLeft > 1 ? 's' : ''})
            {allowance.upcomingBills > 0 && `, après ${eur(allowance.upcomingBills)} de factures à venir`}
            {allowance.upcomingIncome > 0 && `, avec ${eur(allowance.upcomingIncome)} attendus`}
            {allowance.savingsGoal > 0 && `, en gardant ${eur(allowance.savingsGoal)} d'épargne`}.
          </p>
          <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3 text-sm">
            <span className="text-muted">Dépensé ces 7 derniers jours</span>
            <Link to="/depenses" className="tabular-nums hover:underline">
              {eur(weekSpent)}
            </Link>
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <Card className="p-5">
          <p className="mb-3 text-sm text-muted">À payer cette semaine</p>
          <ul className="space-y-2.5">
            {upcoming.slice(0, 5).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {b.provider || b.title}
                  <span className="text-muted"> · {b.dueDate === v.today ? "aujourd'hui" : formatDate(b.dueDate, { weekday: 'short', day: 'numeric' })}</span>
                </span>
                <span className="tabular-nums">{eur(b.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/** Solde saisi à la main, quand les mails ne sont pas lisibles. */
function ManualBalance({ today }: { today: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  function save(e: FormEvent) {
    e.preventDefault();
    const n = Number(value.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(n)) return;
    const s = currentState();
    const m = money(s);
    m.balances = mergeBalances(m.balances, [{ date: today, amount: n }]);
    refreshMovements(s);
    scheduleSave();
    setOpen(false);
    setValue('');
  }
  if (!open)
    return (
      <Button variant="secondary" className="mt-4 bg-field" onClick={() => setOpen(true)}>
        Saisir mon solde du jour
      </Button>
    );
  return (
    <form onSubmit={save} className="mt-4 flex items-center gap-2">
      <Input autoFocus inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder="ex. 812,40" aria-label="Solde du jour" className="w-36" />
      <span className="text-muted">€</span>
      <Button type="submit">OK</Button>
    </form>
  );
}
