import { BILL_CATEGORIES } from '../lib/categories.js';
import { fromDateString, monthBounds } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';

export interface BudgetLine {
  budgetId: string | null;
  category: string;
  spent: number;
  limit: number;
  percentageUsed: number;
}

/** Dépenses d'un mois par catégorie : toutes les factures dont l'échéance tombe dans le mois. */
export async function spentByCategory(userId: string, year: number, month: number): Promise<Map<string, number>> {
  const { start, end } = monthBounds(year, month);
  const rows = await prisma.bill.groupBy({
    by: ['category'],
    where: { userId, dueDate: { gte: fromDateString(start), lte: fromDateString(end) } },
    _sum: { amount: true },
  });
  return new Map(rows.map((r) => [r.category, Number(r._sum.amount ?? 0)]));
}

/** Budget vs réel pour chaque catégorie ayant un budget ou des dépenses ce mois-ci. */
export async function budgetSummary(userId: string, year: number, month: number): Promise<BudgetLine[]> {
  const [spent, budgets] = await Promise.all([
    spentByCategory(userId, year, month),
    prisma.budget.findMany({ where: { userId, year, month } }),
  ]);
  const byCat = new Map(budgets.map((b) => [b.category as string, b]));
  return BILL_CATEGORIES.filter((c) => byCat.has(c) || spent.has(c)).map((category) => {
    const budget = byCat.get(category);
    const limit = budget ? Number(budget.limitAmount) : 0;
    const s = spent.get(category) ?? 0;
    return {
      budgetId: budget?.id ?? null,
      category,
      spent: s,
      limit,
      percentageUsed: limit > 0 ? Math.round((s / limit) * 1000) / 10 : 0,
    };
  });
}
