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
  overdue: { label: 'En retard', badge: 'bg-red-100 text-red-800', dot: 'bg-red-500', chip: 'bg-red-50 text-red-800 border-red-200' },
  urgent: { label: '≤ 3 jours', badge: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500', chip: 'bg-orange-50 text-orange-800 border-orange-200' },
  soon: { label: '≤ 7 jours', badge: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-400', chip: 'bg-yellow-50 text-yellow-900 border-yellow-200' },
  later: { label: '> 7 jours', badge: 'bg-green-100 text-green-800', dot: 'bg-green-500', chip: 'bg-green-50 text-green-800 border-green-200' },
  paid: { label: 'Payée', badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', chip: 'bg-slate-50 text-slate-500 border-slate-200 line-through' },
};

export function dueLabel(bill: Pick<Bill, 'paid' | 'dueDate'>, today: string): string {
  if (bill.paid) return 'Payée';
  const days = daysBetween(today, bill.dueDate);
  if (days < 0) return `En retard de ${-days} j`;
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return 'Demain';
  return `Dans ${days} j`;
}
