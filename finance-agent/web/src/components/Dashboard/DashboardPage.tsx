import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useBillMutations, useBills } from '../../hooks/useBills';
import { incomeService } from '../../services/incomeService';
import { dashboardService, notificationService } from '../../services/notificationService';
import { useAuthStore } from '../../store/authStore';
import { CATEGORIES } from '../../utils/categories';
import { addDays, localToday } from '../../utils/dates';
import { eur, formatDate, formatMonth } from '../../utils/format';

const DAY_INITIALS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
import { BillRow } from '../Bills/BillRow';
import { BudgetBar } from '../Budget/BudgetBar';
import { PageTitle } from '../Layout/Layout';
import { Card, CardHeader, EmptyState, ErrorMessage, Spinner } from '../ui';
import { MiniBars, ThinBars, type MiniBar } from '../ui/MiniBars';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.get });
  const { pay } = useBillMutations();
  const balance = useQuery({ queryKey: ['balance', 6], queryFn: () => incomeService.balance(6) });
  const month = balance.data?.[balance.data.length - 1];
  // Semaine du lundi au dimanche contenant aujourd'hui
  const today = localToday();
  const monday = addDays(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
  const { data: weekBills = [] } = useBills({ from: monday, to: addDays(monday, 6) });
  const qc = useQueryClient();
  const markRead = useMutation({
    mutationFn: notificationService.markRead,
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['dashboard'] }), qc.invalidateQueries({ queryKey: ['notifications'] })]),
  });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorMessage error={error} />;

  const urgent = [...data.overdueBills, ...data.billsDueThisWeek];
  const weekTotal = data.billsDueThisWeek.reduce((s, b) => s + b.amount, 0);
  const monthTotal = data.billsDueThisMonth.reduce((s, b) => s + b.amount, 0);
  const byCategory = data.budgetSummary
    .filter((l) => l.spent > 0)
    .sort((a, b) => b.spent - a.spent)
    .map((l) => ({ key: l.category, label: CATEGORIES[l.category].label, value: l.spent }));
  const week: MiniBar[] = Array.from({ length: 7 }, (_, i) => {
    const day = addDays(monday, i);
    return {
      key: day,
      label: DAY_INITIALS[i]!,
      title: formatDate(day, { weekday: 'long', day: 'numeric', month: 'long' }),
      value: weekBills.filter((b) => b.dueDate === day).reduce((s, b) => s + b.amount, 0),
      highlight: day === today,
    };
  });
  const trend: MiniBar[] = data.monthlyTrend.map((m, i, all) => ({
    key: m.month,
    label: formatMonth(m.month).split(' ')[0]!.replace('.', ''),
    title: formatMonth(m.month, true),
    value: m.total,
    highlight: i === all.length - 1,
  }));
  const budgets = data.budgetSummary.filter((l) => l.limit > 0);

  return (
    <>
      <PageTitle title={`Bonjour${user?.name ? ` ${user.name}` : ''}`} subtitle="Voici où en sont vos factures et votre budget." />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="En retard" value={eur(data.totalOverdue)} hint={`${data.overdueBills.length} facture(s)`} tone={data.overdueBills.length ? 'danger' : undefined} />
        <Stat label="Cette semaine" value={eur(weekTotal)} hint={`${data.billsDueThisWeek.length} échéance(s)`} />
        <Stat label="Reste ce mois-ci" value={eur(monthTotal)} hint={`${data.billsDueThisMonth.length} échéance(s)`} />
        <Stat label="Total à payer" value={eur(data.totalAmountDue)} hint="toutes échéances" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2">
          <CardHeader title="À payer en priorité" action={<Link to="/calendrier" className="text-xs text-muted hover:text-ink">Voir le calendrier</Link>} />
          {urgent.length === 0 ? (
            <EmptyState>Rien à payer dans les 7 prochains jours.</EmptyState>
          ) : (
            <div className="divide-y divide-white/5">
              {urgent.map((b) => (
                <BillRow key={b.id} bill={b} today={data.today} onPay={() => pay.mutate(b.id)} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Rappels" action={<Link to="/notifications" className="text-xs text-muted hover:text-ink">Tout voir</Link>} />
          {data.upcomingReminders.length === 0 ? (
            <EmptyState>Aucun rappel non lu.</EmptyState>
          ) : (
            <ul className="divide-y divide-white/5">
              {data.upcomingReminders.slice(0, 5).map((n) => (
                <li key={n.id} className="flex items-start gap-2 px-4 py-3">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${n.type === 'BUDGET_ALERT' ? 'bg-orange-500' : 'bg-ink'}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-muted">{n.message}</div>
                  </div>
                  <button className="text-xs text-muted hover:text-ink/70" onClick={() => markRead.mutate(n.id)} title="Marquer comme lu">
                    ✓
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Bilan du mois" action={<Link to="/revenus" className="text-xs text-muted hover:text-ink">Voir le détail</Link>} />
          {!month ? (
            <EmptyState>Chargement…</EmptyState>
          ) : (
            <div className="space-y-2 px-5 pb-5 pt-2 text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted">Entrées</span>
                <span>{eur(month.income)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Sorties (factures)</span>
                <span>{eur(month.expenses)}</span>
              </div>
              <div className="h-[7px] rounded-full bg-track">
                <div
                  className={`h-full rounded-full ${month.expenses > month.income ? 'bg-red-500' : 'bg-ink'}`}
                  style={{ width: `${month.income > 0 ? Math.min(100, Math.max(3, (month.expenses / month.income) * 100)) : month.expenses > 0 ? 100 : 0}%` }}
                />
              </div>
              <div className="flex justify-between pt-1 text-base font-semibold">
                <span>Reste</span>
                <span className={month.balance < 0 ? 'text-red-400' : ''}>{eur(month.balance)}</span>
              </div>
              {month.income === 0 && (
                <Link to="/revenus" className="block text-xs text-muted underline underline-offset-2 hover:text-ink">
                  Ajoutez vos rentrées d’argent pour voir ce qu’il vous reste
                </Link>
              )}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Cette semaine" />
          <div className="px-5 pb-5 pt-2">
            <MiniBars bars={week} format={eur} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Six derniers mois" />
          <div className="px-5 pb-5 pt-2">
            <MiniBars bars={trend} format={eur} />
          </div>
        </Card>

        <Card>
          <CardHeader title="Ce mois-ci par catégorie" />
          {byCategory.length === 0 ? (
            <EmptyState>Pas encore de facture ce mois-ci.</EmptyState>
          ) : (
            <div className="px-5 pb-5 pt-3">
              <ThinBars rows={byCategory} format={eur} />
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Budget vs réel" action={<Link to="/budget" className="text-xs text-muted hover:text-ink">Gérer</Link>} />
          {budgets.length === 0 ? (
            <EmptyState>
              Aucun budget défini. <Link to="/budget" className="text-ink underline">Définir mes limites</Link>
            </EmptyState>
          ) : (
            <div className="space-y-4 p-4">
              {budgets.map((l) => (
                <BudgetBar key={l.category} line={l} threshold={user?.budgetWarningThreshold ?? 80} />
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Derniers paiements" action={<Link to="/factures" className="text-xs text-muted hover:text-ink">Historique</Link>} />
          {data.recentTransactions.length === 0 ? (
            <EmptyState>Aucune facture payée pour l'instant.</EmptyState>
          ) : (
            <div className="grid grid-cols-1 divide-y divide-white/5 md:grid-cols-2 md:divide-y-0">
              {data.recentTransactions.map((b) => (
                <BillRow key={b.id} bill={b} today={data.today} />
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: 'danger' }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-1.5 text-xs text-muted">
        {tone === 'danger' && <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden />}
        {label}
      </div>
      <div className={`mt-1 text-xl font-semibold tracking-tight tabular-nums sm:text-2xl ${tone === 'danger' ? 'text-red-300' : 'text-ink'}`}>{value}</div>
      <div className="text-xs text-muted">{hint}</div>
    </Card>
  );
}
