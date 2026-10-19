import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { incomeService } from '../../services/incomeService';
import type { Income } from '../../types';
import { incomeForMonth, occurrenceIn } from '../../utils/balance';
import { INCOME_CATEGORIES, RECURRENCES } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { eur, formatDate, formatMonth } from '../../utils/format';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, CardHeader, EmptyState, ErrorMessage, Modal, Spinner } from '../ui';
import { BalanceChart } from './BalanceChart';
import { IncomeForm, useIncomeMutations } from './IncomeForm';

/** Rentrées d'argent et bilan mensuel entrées / sorties. */
export function IncomesPage() {
  const incomes = useQuery({ queryKey: ['incomes'], queryFn: incomeService.list });
  const balance = useQuery({ queryKey: ['balance', 6], queryFn: () => incomeService.balance(6) });
  const { remove } = useIncomeMutations();
  const [editing, setEditing] = useState<Income | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Income | null>(null);
  const month = localToday().slice(0, 7);

  if (incomes.isLoading || balance.isLoading) return <Spinner />;
  if (incomes.error || balance.error) return <ErrorMessage error={incomes.error ?? balance.error} />;

  const list = incomes.data!;
  const current = balance.data![balance.data!.length - 1]!;
  const active = list.filter((i) => i.recurrence !== 'NONE' && (!i.endDate || i.endDate >= `${month}-01`));
  const oneOff = list.filter((i) => !active.includes(i));
  const open = (i: Income | null) => {
    setEditing(i);
    setFormOpen(true);
  };

  return (
    <>
      <PageTitle title="Revenus" subtitle="Vos rentrées d’argent face à vos factures, mois par mois" action={<Button onClick={() => open(null)}>+ Ajouter une rentrée</Button>} />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="p-5">
          <div className="text-xs text-muted">Entrées ce mois-ci</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{eur(current.income)}</div>
          <div className="mt-1 text-xs text-muted">{formatMonth(month, true)}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-muted">Sorties ce mois-ci</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{eur(current.expenses)}</div>
          <div className="mt-1 text-xs text-muted">factures du mois</div>
        </Card>
        <Card className="col-span-2 p-5 lg:col-span-1">
          <div className="text-xs text-muted">Reste</div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${current.balance < 0 ? 'text-red-400' : ''}`}>{eur(current.balance)}</div>
          <div className="mt-1 text-xs text-muted">
            {current.income > 0 ? `${Math.round((current.expenses / current.income) * 100)} % des entrées partent en factures` : 'Ajoutez vos rentrées pour voir le solde'}
          </div>
        </Card>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader title="Six derniers mois" />
          <div className="px-5 pb-5 pt-2">
            <BalanceChart months={balance.data!} />
          </div>
          <table className="w-full border-t border-white/5 text-xs sm:text-sm">
            <thead className="text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 sm:px-5 font-medium">Mois</th>
                <th className="px-1.5 py-2 sm:px-2 text-right font-medium">Entrées</th>
                <th className="px-1.5 py-2 sm:px-2 text-right font-medium">Sorties</th>
                <th className="px-3 py-2 sm:px-5 text-right font-medium">Reste</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 whitespace-nowrap tabular-nums">
              {[...balance.data!].reverse().map((m) => (
                <tr key={m.month}>
                  <td className="px-3 py-2 capitalize sm:px-5">
                    <span className="sm:hidden">{formatMonth(m.month)}</span>
                    <span className="hidden sm:inline">{formatMonth(m.month, true)}</span>
                  </td>
                  <td className="px-1.5 py-2 sm:px-2 text-right">{eur(m.income)}</td>
                  <td className="px-1.5 py-2 sm:px-2 text-right text-ink/70">{eur(m.expenses)}</td>
                  <td className={`px-3 py-2 sm:px-5 text-right font-semibold ${m.balance < 0 ? 'text-red-400' : ''}`}>{eur(m.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Rentrées régulières" action={<span className="text-xs tabular-nums text-muted">{eur(incomeForMonth(active, month))} ce mois-ci</span>} />
            {active.length === 0 ? (
              <EmptyState>
                Aucune rentrée régulière.{' '}
                <button onClick={() => open(null)} className="text-ink underline underline-offset-2">
                  Ajouter mon salaire
                </button>
              </EmptyState>
            ) : (
              <IncomeList items={active} month={month} onEdit={open} onDelete={setToDelete} />
            )}
          </Card>
          {oneOff.length > 0 && (
            <Card>
              <CardHeader title="Rentrées ponctuelles et terminées" />
              <IncomeList items={oneOff} month={month} onEdit={open} onDelete={setToDelete} />
            </Card>
          )}
        </div>
      </div>

      <IncomeForm open={formOpen} onClose={() => setFormOpen(false)} income={editing} />
      <Modal open={toDelete !== null} onClose={() => setToDelete(null)} title="Supprimer la rentrée">
        <p className="text-sm text-ink/70">« {toDelete?.label} » sera supprimée, y compris des mois passés du bilan.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" className="bg-field" onClick={() => setToDelete(null)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (toDelete) remove.mutate(toDelete.id);
              setToDelete(null);
            }}
          >
            Supprimer
          </Button>
        </div>
      </Modal>
    </>
  );
}

function IncomeList({ items, month, onEdit, onDelete }: { items: Income[]; month: string; onEdit: (i: Income) => void; onDelete: (i: Income) => void }) {
  return (
    <ul className="divide-y divide-white/5 pb-2">
      {items.map((i) => {
        const next = occurrenceIn(i, month);
        const when =
          i.recurrence === 'NONE'
            ? formatDate(i.date)
            : `${RECURRENCES[i.recurrence]}${next ? ` · le ${formatDate(next, { day: 'numeric', month: 'short' })}` : ''}${i.endDate ? ` · jusqu’au ${formatDate(i.endDate)}` : ''}`;
        return (
          <li key={i.id} className="px-5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-medium">{i.label}</div>
                <div className="truncate text-xs text-muted">{[i.source, INCOME_CATEGORIES[i.category]].filter(Boolean).join(' · ')}</div>
                <div className="text-xs text-muted">{when}</div>
              </div>
              <div className="whitespace-nowrap font-semibold tabular-nums">+{eur(i.amount)}</div>
            </div>
            <div className="mt-1 flex justify-end gap-1">
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => onEdit(i)}>
                Modifier
              </Button>
              <Button variant="ghost" className="px-2 py-1 text-xs text-red-400" onClick={() => onDelete(i)}>
                Supprimer
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
