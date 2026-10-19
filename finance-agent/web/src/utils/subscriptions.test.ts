import { describe, expect, it } from 'vitest';
import type { Bill } from '../types';
import { groupSubscriptions, isSubscription } from './subscriptions';

const bill = (p: Partial<Bill>): Bill => ({
  id: Math.random().toString(36),
  title: 'Netflix',
  provider: 'Netflix',
  amount: 13.49,
  dueDate: '2026-10-22',
  paid: false,
  paidDate: null,
  category: 'SUBSCRIPTION',
  reference: null,
  documentUrl: null,
  notes: null,
  recurrence: 'MONTHLY',
  createdAt: '',
  updatedAt: '',
  ...p,
});

describe('abonnements', () => {
  it('reconnaît les abonnements', () => {
    expect(isSubscription(bill({}))).toBe(true);
    expect(isSubscription(bill({ category: 'INTERNET', recurrence: 'MONTHLY' }))).toBe(true);
    expect(isSubscription(bill({ category: 'INTERNET', recurrence: 'NONE' }))).toBe(false);
    expect(isSubscription(bill({ category: 'HOUSING', recurrence: 'MONTHLY' }))).toBe(false);
  });

  it('regroupe une série et calcule le coût mensuel', () => {
    const subs = groupSubscriptions(
      [
        bill({ dueDate: '2026-09-22', paid: true, paidDate: '2026-09-22' }),
        bill({ dueDate: '2026-10-22' }),
        bill({ title: 'Antivirus', provider: 'Norton', amount: 60, recurrence: 'YEARLY', dueDate: '2027-01-05' }),
      ],
      '2026-10-19',
    );
    expect(subs).toHaveLength(2);
    const netflix = subs.find((s) => s.provider === 'Netflix')!;
    expect(netflix.current.dueDate).toBe('2026-10-22');
    expect(netflix.unpaid).toHaveLength(1);
    expect(netflix.paidLastYear).toBeCloseTo(13.49);
    expect(subs.find((s) => s.provider === 'Norton')!.monthly).toBe(5);
  });

  it('considère comme terminée une série ponctuelle payée', () => {
    const [s] = groupSubscriptions([bill({ recurrence: 'NONE', paid: true, paidDate: '2026-10-01' })], '2026-10-19');
    expect(s!.active).toBe(false);
  });
});
