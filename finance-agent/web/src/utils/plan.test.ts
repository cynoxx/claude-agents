import { describe, expect, it } from 'vitest';
import type { Bill } from '../types';
import { categoryDrift, monthlyCost, recurringBills } from './plan';

const bill = (p: Partial<Bill>): Bill => ({
  id: Math.random().toString(36),
  title: 'x',
  provider: 'x',
  amount: 10,
  dueDate: '2026-11-01',
  paid: true,
  paidDate: null,
  category: 'OTHER',
  reference: null,
  documentUrl: null,
  notes: null,
  recurrence: 'NONE',
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('plan', () => {
  it('coût mensuel', () => {
    expect(monthlyCost({ amount: 44.99, recurrence: 'YEARLY' })).toBe(3.75);
    expect(monthlyCost({ amount: 7.07, recurrence: 'MONTHLY' })).toBe(7.07);
  });

  it('garde la dernière échéance de chaque abonnement', () => {
    const list = recurringBills([
      bill({ provider: 'Spotify', recurrence: 'MONTHLY', dueDate: '2026-10-29', amount: 7.07 }),
      bill({ provider: 'Spotify', recurrence: 'MONTHLY', dueDate: '2026-11-29', amount: 7.07 }),
      bill({ provider: 'Carrefour' }),
    ]);
    expect(list.map((b) => b.dueDate)).toEqual(['2026-11-29']);
  });

  it('compare le mois à la moyenne des précédents', () => {
    const d = categoryDrift(
      [bill({ category: 'FOOD', amount: 90, dueDate: '2026-11-02' }), bill({ category: 'FOOD', amount: 60, dueDate: '2026-10-02' })],
      '2026-11',
      ['2026-09', '2026-10'],
    );
    expect(d).toEqual([{ category: 'FOOD', current: 90, average: 30 }]);
  });
});
