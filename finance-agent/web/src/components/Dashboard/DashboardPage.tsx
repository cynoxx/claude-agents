import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useBillMutations } from '../../hooks/useBills';
import { dashboardService, notificationService } from '../../services/notificationService';
import { useAuthStore } from '../../store/authStore';
import { CATEGORIES } from '../../utils/categories';
import { eur, formatMonth } from '../../utils/format';
import { BillRow } from '../Bills/BillRow';
import { BudgetBar } from '../Budget/BudgetBar';
import { PageTitle } from '../Layout/Layout';
import { Card, CardHeader, EmptyState, ErrorMessage, Spinner } from '../ui';

const SERIES = '#2a78d6';

export function DashboardPage() {
  const user = useAuthStore((s) => s.user);
  const { data, isLoading, error } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardService.get });
  const { pay } = useBillMutations();
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
    .map((l) => ({ name: CATEGORIES[l.category].label, spent: l.spent }));
  const trend = data.monthlyTrend.map((m) => ({ name: formatMonth(m.month), total: m.total }));
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

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="À payer en priorité" action={<Link to="/calendrier" className="text-xs text-brand-700">Voir le calendrier</Link>} />
          {urgent.length === 0 ? (
            <EmptyState>Rien à payer dans les 7 prochains jours. 🎉</EmptyState>
          ) : (
            <div className="divide-y divide-slate-100">
              {urgent.map((b) => (
                <BillRow key={b.id} bill={b} today={data.today} onPay={() => pay.mutate(b.id)} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Rappels" action={<Link to="/notifications" className="text-xs text-brand-700">Tout voir</Link>} />
          {data.upcomingReminders.length === 0 ? (
            <EmptyState>Aucun rappel non lu.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.upcomingReminders.map((n) => (
                <li key={n.id} className="flex items-start gap-2 px-4 py-3">
                  <span aria-hidden>{n.type === 'BUDGET_ALERT' ? '💶' : '🔔'}</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{n.title}</div>
                    <div className="text-xs text-slate-500">{n.message}</div>
                  </div>
                  <button className="text-xs text-slate-400 hover:text-slate-700" onClick={() => markRead.mutate(n.id)} title="Marquer comme lu">
                    ✓
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Dépenses du mois par catégorie" />
          {byCategory.length === 0 ? (
            <EmptyState>Pas encore de facture ce mois-ci.</EmptyState>
          ) : (
            <div className="h-64 p-2">
              <ResponsiveContainer>
                <BarChart data={byCategory} layout="vertical" margin={{ left: 8, right: 16 }}>
                  <CartesianGrid horizontal={false} stroke="#e2e8f0" />
                  <XAxis type="number" tickFormatter={(v) => `${v} €`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip formatter={(v: number) => [eur(v), 'Dépensé']} cursor={{ fill: '#f1f5f9' }} />
                  <Bar dataKey="spent" fill={SERIES} radius={[0, 4, 4, 0]} barSize={14} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Évolution sur 6 mois" />
          <div className="h-64 p-2">
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tickFormatter={(v) => `${v} €`} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} width={56} />
                <Tooltip formatter={(v: number) => [eur(v), 'Total des factures']} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="total" fill={SERIES} radius={[4, 4, 0, 0]} barSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Budget vs réel" action={<Link to="/budget" className="text-xs text-brand-700">Gérer</Link>} />
          {budgets.length === 0 ? (
            <EmptyState>
              Aucun budget défini. <Link to="/budget" className="text-brand-700">Définir mes limites</Link>
            </EmptyState>
          ) : (
            <div className="space-y-4 p-4">
              {budgets.map((l) => (
                <BudgetBar key={l.category} line={l} threshold={user?.budgetWarningThreshold ?? 80} />
              ))}
            </div>
          )}
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Derniers paiements" action={<Link to="/factures" className="text-xs text-brand-700">Historique</Link>} />
          {data.recentTransactions.length === 0 ? (
            <EmptyState>Aucune facture payée pour l'instant.</EmptyState>
          ) : (
            <div className="grid divide-y divide-slate-100 md:grid-cols-2 md:divide-y-0">
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
    <Card className={`p-4 ${tone === 'danger' ? 'border-red-200 bg-red-50' : ''}`}>
      <div className={`text-xs font-medium ${tone === 'danger' ? 'text-red-700' : 'text-slate-500'}`}>{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums sm:text-2xl ${tone === 'danger' ? 'text-red-800' : 'text-slate-900'}`}>{value}</div>
      <div className="text-xs text-slate-500">{hint}</div>
    </Card>
  );
}
