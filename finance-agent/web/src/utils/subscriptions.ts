import type { Bill, Recurrence } from '../types';

/** Coût mensuel équivalent selon la périodicité. */
const PER_MONTH: Record<Recurrence, number> = { NONE: 1, MONTHLY: 1, QUARTERLY: 1 / 3, YEARLY: 1 / 12 };

export interface Subscription {
  key: string;
  title: string;
  provider: string;
  recurrence: Recurrence;
  /** Montant de la dernière échéance */
  amount: number;
  monthly: number;
  /** Prochaine échéance à payer, sinon la dernière payée */
  current: Bill;
  /** Échéances non payées de la série (à supprimer pour résilier) */
  unpaid: Bill[];
  active: boolean;
  /** Total payé sur les 12 derniers mois */
  paidLastYear: number;
}

/** Abonnement : catégorie Abonnements, ou facture récurrente d'internet, téléphone ou loisirs. */
export function isSubscription(b: Bill) {
  return b.category === 'SUBSCRIPTION' || (b.recurrence !== 'NONE' && (b.category === 'INTERNET' || b.category === 'ENTERTAINMENT'));
}

/** Regroupe les échéances d'un même abonnement (même intitulé et fournisseur). */
export function groupSubscriptions(bills: Bill[], today: string): Subscription[] {
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  const series = new Map<string, Bill[]>();
  for (const b of bills.filter(isSubscription)) {
    const key = `${b.provider.trim().toLowerCase()}|${b.title.trim().toLowerCase()}`;
    series.set(key, [...(series.get(key) ?? []), b]);
  }
  return [...series.entries()]
    .map(([key, list]) => {
      const sorted = [...list].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const unpaid = sorted.filter((b) => !b.paid);
      const last = sorted[sorted.length - 1]!;
      const current = unpaid[0] ?? last;
      // Une série dont la dernière échéance est ponctuelle et payée est terminée
      const active = unpaid.length > 0 || last.recurrence !== 'NONE';
      return {
        key,
        title: current.title,
        provider: current.provider,
        recurrence: last.recurrence,
        amount: current.amount,
        monthly: Math.round(current.amount * PER_MONTH[last.recurrence] * 100) / 100,
        current,
        unpaid,
        active,
        paidLastYear: sorted.filter((b) => b.paid && (b.paidDate ?? b.dueDate) > yearAgo).reduce((t, b) => t + b.amount, 0),
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.current.dueDate.localeCompare(b.current.dueDate));
}
