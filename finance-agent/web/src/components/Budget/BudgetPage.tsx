import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { budgetService } from '../../services/budgetService';
import { useAuthStore } from '../../store/authStore';
import type { BillCategory } from '../../types';
import { CATEGORIES, CATEGORY_KEYS } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { eur, formatMonth } from '../../utils/format';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, CardHeader, EmptyState, ErrorMessage, Input, Spinner } from '../ui';
import { BudgetBar } from './BudgetBar';

export function BudgetPage() {
  const today = localToday();
  const [period, setPeriod] = useState({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
  const threshold = useAuthStore((s) => s.user?.budgetWarningThreshold ?? 80);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['budget', period], queryFn: () => budgetService.get(period.year, period.month) });
  const invalidate = () => Promise.all(['budget', 'dashboard', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const save = useMutation({ mutationFn: budgetService.set, onSuccess: invalidate });
  const remove = useMutation({ mutationFn: budgetService.remove, onSuccess: invalidate });
  const [drafts, setDrafts] = useState<Partial<Record<BillCategory, string>>>({});

  const shift = (delta: number) =>
    setPeriod(({ year, month }) => {
      const m = month + delta;
      return { year: year + Math.floor((m - 1) / 12), month: ((((m - 1) % 12) + 12) % 12) + 1 };
    });

  const lines = new Map(data?.lines.map((l) => [l.category, l]));
  const withLimit = data?.lines.filter((l) => l.limit > 0) ?? [];
  const totalLimit = withLimit.reduce((s, l) => s + l.limit, 0);
  const totalSpent = data?.lines.reduce((s, l) => s + l.spent, 0) ?? 0;
  const ym = `${period.year}-${String(period.month).padStart(2, '0')}`;

  const commit = (category: BillCategory) => {
    const raw = drafts[category];
    if (raw === undefined) return;
    const value = Number(raw.replace(',', '.'));
    const line = lines.get(category);
    if (!raw.trim() && line?.budgetId) remove.mutate(line.budgetId);
    else if (value > 0) save.mutate({ category, limitAmount: value, year: period.year, month: period.month });
    setDrafts((d) => ({ ...d, [category]: undefined }));
  };

  return (
    <>
      <PageTitle
        title="Budget"
        subtitle={`Alerte à ${threshold} % de chaque limite, puis au dépassement.`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => shift(-1)} aria-label="Mois précédent">
              ←
            </Button>
            <span className="min-w-28 text-center text-sm font-medium capitalize">{formatMonth(ym, true)}</span>
            <Button variant="secondary" onClick={() => shift(1)} aria-label="Mois suivant">
              →
            </Button>
          </div>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2 [&>*]:min-w-0">
          <Card>
            <CardHeader title="Limites par catégorie" />
            <ul className="divide-y divide-black/5">
              {CATEGORY_KEYS.map((c) => {
                const line = lines.get(c);
                const current = drafts[c] ?? (line?.limit ? String(line.limit) : '');
                return (
                  <li key={c} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm">{CATEGORIES[c].label}</div>
                      <div className="text-xs text-muted">Dépensé : {eur(line?.spent ?? 0)}</div>
                    </div>
                    <Input
                      className="w-28 text-right"
                      inputMode="decimal"
                      placeholder="Aucune"
                      aria-label={`Limite ${CATEGORIES[c].label}`}
                      value={current}
                      onChange={(e) => setDrafts((d) => ({ ...d, [c]: e.target.value }))}
                      onBlur={() => commit(c)}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <span className="text-sm text-muted">€</span>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title={`Budget vs réel : ${eur(totalSpent)} dépensés${totalLimit ? ` sur ${eur(totalLimit)}` : ''}`} />
            {withLimit.length === 0 ? (
              <EmptyState>Saisissez une limite à gauche pour suivre une catégorie.</EmptyState>
            ) : (
              <div className="space-y-4 p-4">
                {withLimit.map((l) => (
                  <BudgetBar key={l.category} line={l} threshold={threshold} />
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
