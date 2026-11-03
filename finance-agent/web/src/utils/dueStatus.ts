import type { Bill } from '../types';
import { daysBetween } from './dates';

export type DueStatus = 'paid' | 'overdue' | 'urgent' | 'soon' | 'later';

/**
 * Code couleur du calendrier des échéances :
 * rouge = en retard, orange = 3 jours ou moins, jaune = 7 jours ou moins, vert = plus de 7 jours.
 */
export function dueStatus(bill: Pick<Bill, 'paid' | 'dueDate'>, today: string): DueStatus {
  if (bill.paid) return 'paid';
  const days = daysBetween(today, bill.dueDate);
  if (days < 0) return 'overdue';
  if (days <= 3) return 'urgent';
  if (days <= 7) return 'soon';
  return 'later';
}

export const DUE_STYLES: Record<DueStatus, { label: string; badge: string; dot: string; chip: string }> = {
  overdue: { label: 'En retard', badge: 'bg-red-500/15 text-red-300', dot: 'bg-red-500', chip: 'bg-red-500/15 text-red-300 border-red-500/30' },
  urgent: { label: '≤ 3 jours', badge: 'bg-orange-500/15 text-orange-300', dot: 'bg-orange-500', chip: 'bg-orange-500/15 text-orange-300 border-orange-500/30' },
  soon: { label: '≤ 7 jours', badge: 'bg-yellow-400/15 text-yellow-200', dot: 'bg-yellow-400', chip: 'bg-yellow-400/15 text-yellow-200 border-yellow-500/30' },
  later: { label: '> 7 jours', badge: 'bg-green-500/15 text-green-300', dot: 'bg-green-500', chip: 'bg-green-500/15 text-green-300 border-green-500/30' },
  paid: { label: 'Payée', badge: 'bg-white/5 text-ink/70', dot: 'bg-stub', chip: 'bg-transparent text-muted border-white/10 line-through' },
};

export function dueLabel(bill: Pick<Bill, 'paid' | 'dueDate'>, today: string): string {
  if (bill.paid) return 'Payée';
  const days = daysBetween(today, bill.dueDate);
  if (days < 0) return `En retard de ${-days} j`;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `Dans ${days} j`;
}
