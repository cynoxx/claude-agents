// Bilan mensuel entrées / sorties. Fichier sans dépendance, recopié tel quel
// dans web/src/utils/balance.ts pour l'app autonome : garder les deux identiques.

export type Recurrence = 'NONE' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';

export interface IncomeLike {
  amount: number;
  /** Première (ou unique) rentrée, YYYY-MM-DD */
  date: string;
  /** Dernière date incluse pour une rentrée récurrente, YYYY-MM-DD */
  endDate: string | null;
  recurrence: Recurrence;
}

export interface MonthBalance {
  /** YYYY-MM */
  month: string;
  income: number;
  expenses: number;
  balance: number;
}

const STEP: Record<Recurrence, number> = { NONE: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };
const round = (n: number) => Math.round(n * 100) / 100;
const index = (ym: string) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const fromIndex = (i: number) => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;

/** Date de la rentrée dans le mois donné (YYYY-MM), ou null si elle n'y tombe pas. */
export function occurrenceIn(income: IncomeLike, month: string): string | null {
  const diff = index(month) - index(income.date);
  if (diff < 0) return null;
  const step = STEP[income.recurrence];
  if (step === 0 ? diff !== 0 : diff % step !== 0) return null;
  const [y, m] = month.split('-').map(Number) as [number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const day = Math.min(Number(income.date.slice(8, 10)), lastDay);
  const date = `${month}-${String(day).padStart(2, '0')}`;
  if (income.endDate && date > income.endDate) return null;
  return date;
}

/** Total des rentrées d'un mois. */
export function incomeForMonth(incomes: IncomeLike[], month: string): number {
  return round(incomes.reduce((t, i) => t + (occurrenceIn(i, month) ? i.amount : 0), 0));
}

/** Liste des mois YYYY-MM se terminant par `lastMonth` (inclus). */
export function monthsEndingAt(lastMonth: string, count: number): string[] {
  const last = index(lastMonth);
  return Array.from({ length: count }, (_, k) => fromIndex(last - count + 1 + k));
}

/**
 * Bilan de chaque mois : rentrées, factures dont l'échéance tombe dans le mois
 * (payées ou non) et solde.
 */
export function monthlyBalance(incomes: IncomeLike[], bills: { amount: number; dueDate: string }[], months: string[]): MonthBalance[] {
  return months.map((month) => {
    const income = incomeForMonth(incomes, month);
    const expenses = round(bills.filter((b) => b.dueDate.startsWith(month)).reduce((t, b) => t + b.amount, 0));
    return { month, income, expenses, balance: round(income - expenses) };
  });
}
