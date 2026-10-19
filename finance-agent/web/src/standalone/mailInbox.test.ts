import { describe, expect, it } from 'vitest';
import { billFromInbox, importMailInbox } from './mailInbox';
import type { Backend, State } from './storage';

const state = (): State => ({
  version: 1,
  user: { id: 'moi', email: '', name: null, billReminderDays: [7, 3, 0], budgetWarningThreshold: 80, notifyEmail: false, notifyInApp: true, createdAt: '' },
  bills: [],
  budgets: [],
  notifications: [],
  incomes: [],
});

function backend(items: Array<{ id: string; data: Record<string, unknown> }>) {
  return { listInbox: async () => items, removeInbox: async () => {} } as unknown as Backend;
}

describe('factures des mails', () => {
  it('transforme un dépôt complet en facture', () => {
    const b = billFromInbox('abc', { title: 'CapCut Pro', provider: 'Apple', amount: 11.99, dueDate: '2026-10-16', paid: true, recurrence: 'MONTHLY', category: 'SUBSCRIPTION', mailUrl: 'https://mail.google.com/x' });
    expect(b).toMatchObject({ id: 'mail-abc', amount: 11.99, paid: true, paidDate: '2026-10-16', recurrence: 'MONTHLY', category: 'SUBSCRIPTION', documentUrl: 'https://mail.google.com/x' });
  });

  it('refuse un dépôt sans montant ni date', () => {
    expect(billFromInbox('x', { title: 'EDF' })).toBeNull();
    expect(billFromInbox('x', { title: 'EDF', amount: 30, dueDate: '16/10/2026' })).toBeNull();
  });

  it("n'ajoute jamais deux fois le même mail", async () => {
    const s = state();
    const items = [{ id: 'm1', data: { title: 'Free', amount: 19.99, dueDate: '2026-11-02' } }];
    expect((await importMailInbox(s, backend(items))).added).toBe(1);
    const again = await importMailInbox(s, backend(items));
    expect(again).toEqual({ added: 0, done: ['m1'] });
    expect(s.bills).toHaveLength(1);
    expect(s.notifications).toHaveLength(1);
  });

  it('laisse dans la boîte un dépôt incomplet', async () => {
    const s = state();
    const r = await importMailInbox(s, backend([{ id: 'bad', data: { title: 'X' } }]));
    expect(r).toEqual({ added: 0, done: [] });
  });
});
