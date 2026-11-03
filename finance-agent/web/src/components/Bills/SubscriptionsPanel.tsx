import { useMemo, useState } from 'react';
import { useBillMutations, useBills } from '../../hooks/useBills';
import type { Bill } from '../../types';
import { RECURRENCES } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { DUE_STYLES, dueLabel, dueStatus } from '../../utils/dueStatus';
import { eur, formatDate } from '../../utils/format';
import { groupSubscriptions, type Subscription } from '../../utils/subscriptions';
import { Button, Card, CardHeader, EmptyState, ErrorMessage, Modal, Spinner } from '../ui';
import { ThinBars } from '../ui/MiniBars';

const CADENCE: Record<string, string> = { MONTHLY: '/ mois', QUARTERLY: '/ trimestre', YEARLY: '/ an', NONE: '' };

/** Vue « abonnements » de la page Factures : coût récurrent, prochains prélèvements, résiliation. */
export function SubscriptionsPanel({ onAdd, onEdit }: { onAdd: () => void; onEdit: (bill: Bill) => void }) {
  const { data: bills, isLoading, error } = useBills({ status: 'all', sort: 'dueDate', order: 'asc' });
  const { pay, remove, update } = useBillMutations();
  const today = localToday();
  const subs = useMemo(() => groupSubscriptions(bills ?? [], today), [bills, today]);
  const active = subs.filter((s) => s.active);
  const ended = subs.filter((s) => !s.active);
  const monthly = active.reduce((t, s) => t + s.monthly, 0);
  const next = active.filter((s) => !s.current.paid)[0];
  const [toCancel, setToCancel] = useState<Subscription | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  if (isLoading) return <Spinner />;
  if (error) return <ErrorMessage error={error} />;

  const cancel = async (s: Subscription) => {
    setToCancel(null);
    for (const b of s.unpaid) await remove.mutateAsync(b.id);
    // La dernière échéance payée ne doit plus se renouveler
    const lastPaid = [...(bills ?? [])].filter((b) => b.paid && s.key === `${b.provider.trim().toLowerCase()}|${b.title.trim().toLowerCase()}`).pop();
    if (lastPaid && lastPaid.recurrence !== 'NONE') await update.mutateAsync({ id: lastPaid.id, data: { recurrence: 'NONE' } });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="p-5">
          <div className="text-xs text-muted">Par mois</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{eur(monthly)}</div>
          <div className="mt-1 text-xs text-muted">
            {active.length} abonnement{active.length > 1 ? 's' : ''} actif{active.length > 1 ? 's' : ''}
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted">Par an</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{eur(monthly * 12)}</div>
          <div className="mt-1 text-xs text-muted">au rythme actuel</div>
        </Card>
        <Card className="col-span-2 p-5 lg:col-span-1">
          <div className="text-xs text-muted">Prochain prélèvement</div>
          {next ? (
            <>
              <div className="mt-1 truncate text-2xl font-semibold">{eur(next.amount)}</div>
              <div className="mt-1 truncate text-xs text-muted">
                {next.title} · {formatDate(next.current.dueDate, { day: 'numeric', month: 'long' })}
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-muted">Aucun à venir</div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Mes abonnements"
            action={
              <button onClick={onAdd} className="text-xs text-muted hover:text-ink">
                + Ajouter
              </button>
            }
          />
          {active.length === 0 ? (
            <EmptyState>
              Aucun abonnement suivi.{' '}
              <button onClick={onAdd} className="text-ink underline underline-offset-2">
                Ajouter le premier
              </button>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-white/5 px-1 pb-2">
              {active.map((s) => (
                <SubscriptionRow key={s.key} s={s} today={today} onPay={() => pay.mutate(s.current.id)} onEdit={() => onEdit(s.current)} onCancel={() => setToCancel(s)} />
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium">Coût mensuel par abonnement</h2>
          {active.length === 0 ? (
            <p className="text-sm text-muted">Rien à afficher pour l'instant.</p>
          ) : (
            <ThinBars rows={[...active].sort((a, b) => b.monthly - a.monthly).map((s) => ({ key: s.key, label: s.title, value: s.monthly }))} format={eur} />
          )}
        </Card>
      </div>

      {ended.length > 0 && (
        <Card>
          <button onClick={() => setShowEnded((v) => !v)} className="flex w-full items-center justify-between px-5 py-4 text-sm">
            <span className="font-medium">Abonnements terminés ({ended.length})</span>
            <span className="text-muted">{showEnded ? 'Masquer' : 'Afficher'}</span>
          </button>
          {showEnded && (
            <ul className="divide-y divide-white/5 px-5 pb-3 text-sm">
              {ended.map((s) => (
                <li key={s.key} className="flex justify-between gap-3 py-2 text-muted">
                  <span className="min-w-0 truncate">
                    {s.title} · {s.provider}
                  </span>
                  <span className="whitespace-nowrap tabular-nums">{eur(s.paidLastYear)} sur 12 mois</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal open={toCancel !== null} onClose={() => setToCancel(null)} title="Résilier l'abonnement">
        <p className="text-sm text-ink/70">
          {toCancel?.title} ne sera plus suivi : {toCancel?.unpaid.length ? `${toCancel.unpaid.length === 1 ? "l'échéance à venir sera supprimée" : `les ${toCancel.unpaid.length} échéances à venir seront supprimées`}` : 'plus aucune échéance ne sera créée'}. L'historique des paiements est conservé.
        </p>
        <p className="mt-2 text-xs text-muted">Pensez à résilier aussi auprès de {toCancel?.provider}.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" className="bg-field" onClick={() => setToCancel(null)}>
            Annuler
          </Button>
          <Button variant="danger" onClick={() => toCancel && void cancel(toCancel)}>
            Résilier
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SubscriptionRow({ s, today, onPay, onEdit, onCancel }: { s: Subscription; today: string; onPay: () => void; onEdit: () => void; onCancel: () => void }) {
  const st = dueStatus(s.current, today);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{s.title}</div>
        <div className="truncate text-xs text-muted">
          {s.provider} · {RECURRENCES[s.recurrence]}
        </div>
      </div>
      <div className="text-right">
        <div className="whitespace-nowrap font-semibold tabular-nums">
          {eur(s.amount)} <span className="text-xs font-normal text-muted">{CADENCE[s.recurrence]}</span>
        </div>
        {s.recurrence !== 'MONTHLY' && s.recurrence !== 'NONE' && <div className="text-xs text-muted tabular-nums">soit {eur(s.monthly)} / mois</div>}
      </div>
      <div className="flex w-full items-center justify-between gap-2 sm:w-auto sm:justify-end">
        {s.current.paid ? (
          <span className="text-xs text-muted">Prochaine échéance non saisie</span>
        ) : (
          <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${DUE_STYLES[st].badge}`}>
            {formatDate(s.current.dueDate, { day: 'numeric', month: 'short' })} · {dueLabel(s.current, today)}
          </span>
        )}
        <div className="flex gap-1">
          {!s.current.paid && (
            <Button variant="secondary" className="whitespace-nowrap bg-field px-2 py-1 text-xs" onClick={onPay}>
              ✓ Payé
            </Button>
          )}
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onEdit}>
            Modifier
          </Button>
          <Button variant="ghost" className="px-2 py-1 text-xs text-red-400" onClick={onCancel}>
            Résilier
          </Button>
        </div>
      </div>
    </li>
  );
}
