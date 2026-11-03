import { describe, expect, it } from 'vitest';
import { incomeForMonth, monthlyBalance, monthsEndingAt, occurrenceIn } from '../src/lib/balance.js';

const salary = { amount: 2000, date: '2026-01-31', endDate: null, recurrence: 'MONTHLY' as const };

describe('bilan mensuel', () => {
  it('place une rentrée mensuelle chaque mois, au dernier jour si besoin', () => {
    expect(occurrenceIn(salary, '2025-12')).toBeNull();
    expect(occurrenceIn(salary, '2026-02')).toBe('2026-02-28');
    expect(occurrenceIn(salary, '2026-10')).toBe('2026-10-31');
  });

  it('respecte la périodicité et la date de fin', () => {
    const q = { amount: 300, date: '2026-01-15', endDate: '2026-07-14', recurrence: 'QUARTERLY' as const };
    expect(['2026-01', '2026-02', '2026-04', '2026-07'].map((m) => occurrenceIn(q, m))).toEqual(['2026-01-15', null, '2026-04-15', null]);
    expect(occurrenceIn({ ...salary, recurrence: 'NONE' }, '2026-01')).toBe('2026-01-31');
    expect(occurrenceIn({ ...salary, recurrence: 'NONE' }, '2026-02')).toBeNull();
  });

  it('calcule les mois et le solde', () => {
    expect(monthsEndingAt('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02']);
    expect(incomeForMonth([salary, { amount: 50.5, date: '2026-02-03', endDate: null, recurrence: 'NONE' }], '2026-02')).toBe(2050.5);
    const [b] = monthlyBalance([salary], [{ amount: 850, dueDate: '2026-03-05' }, { amount: 40, dueDate: '2026-04-01' }], ['2026-03']);
    expect(b).toEqual({ month: '2026-03', income: 2000, expenses: 850, balance: 1150 });
  });
});
