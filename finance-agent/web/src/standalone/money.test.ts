import { describe, expect, it } from 'vitest';
import type { Bill, Income } from '../types';
import { answer, categorizeLabel, dailyAllowance, parisDate, parseBankinSnippet, reconcile, spendsOf, total, type MoneyState } from './money';

const bill = (over: Partial<Bill>): Bill => ({
  id: 'b1',
  title: 'Spotify',
  amount: 10,
  dueDate: '2026-11-02',
  paid: true,
  paidDate: '2026-11-02',
  category: 'SUBSCRIPTION',
  provider: 'Spotify',
  reference: null,
  documentUrl: null,
  notes: null,
  recurrence: 'MONTHLY',
  createdAt: '',
  updatedAt: '',
  ...over,
});

describe('mail Bankin', () => {
  it('lit le solde dans l’aperçu', () => {
    const s = 'Balance quotidienne Mardi 03 novembre La Banque Postale Particuliers Mr Test 800,18 € Consulter ce compte logo_bankin L&#39;app tout-en-1';
    expect(parseBankinSnippet(s)).toBe(800.18);
  });
  it('gère les milliers et les soldes négatifs', () => {
    expect(parseBankinSnippet('Lundi 02 novembre Compte 1 234,56 € Consulter')).toBe(1234.56);
    expect(parseBankinSnippet('Lundi 02 novembre Compte 1 234,56 € Consulter')).toBe(1234.56);
    expect(parseBankinSnippet('Lundi 02 novembre Compte -42,10 € Consulter')).toBe(-42.1);
    expect(parseBankinSnippet('Rien à voir')).toBeNull();
  });
  it('date du mail à l’heure de Paris', () => {
    expect(parisDate('2026-11-03T07:02:15Z')).toBe('2026-11-03');
    expect(parisDate('2026-11-02T23:30:00Z')).toBe('2026-11-03');
  });
});

describe('variations du solde', () => {
  const balances = [
    { date: '2026-11-01', amount: 900 },
    { date: '2026-11-02', amount: 850 },
    { date: '2026-11-03', amount: 830 },
    { date: '2026-11-04', amount: 1030 },
  ];
  const base: MoneyState = { balances, movements: [] };

  it('pose une question pour chaque baisse inexpliquée et range les hausses', () => {
    const r = reconcile(base, [], [], '2026-11-04');
    const pending = r.movements.filter((m) => m.status === 'pending');
    expect(pending.map((m) => m.amount).sort((a, b) => a - b)).toEqual([-50, -20]);
    expect(r.movements.find((m) => m.amount > 0)?.label).toBe('Argent reçu');
  });

  it('déduit les factures payées et les rentrées connues', () => {
    const income: Income = { id: 'i', label: 'Bourse', source: null, amount: 200, date: '2026-11-03', endDate: null, recurrence: 'MONTHLY', category: 'BENEFITS', notes: null, createdAt: '', updatedAt: '' };
    const r = reconcile(base, [bill({ amount: 10, paidDate: '2026-11-01' })], [income], '2026-11-04');
    expect(r.movements.filter((m) => m.status === 'pending').map((m) => m.amount).sort((a, b) => a - b)).toEqual([-40, -20]);
    expect(r.movements.some((m) => m.amount > 0)).toBe(false);
  });

  it('une réponse partielle laisse le reste en question', () => {
    let r = reconcile(base, [], [], '2026-11-04');
    const q = r.movements.find((m) => m.amount === -50)!;
    r = { ...r, movements: [...r.movements.filter((m) => m !== q), answer(q, 'Kebab', 'RESTAURANT', 12)] };
    r = reconcile(r, [], [], '2026-11-04');
    expect(r.movements.find((m) => m.label === 'Kebab')?.amount).toBe(-12);
    expect(r.movements.find((m) => m.status === 'pending' && m.from === '2026-11-01')?.amount).toBe(-38);
    // Idempotent
    expect(reconcile(r, [], [], '2026-11-04').movements).toHaveLength(r.movements.length);
  });

  it('les baisses anciennes ne deviennent pas des questions', () => {
    const r = reconcile(base, [], [], '2026-12-20');
    expect(r.movements.every((m) => m.status === 'done')).toBe(true);
    expect(r.movements.filter((m) => m.label === 'Non précisé')).toHaveLength(2);
  });

  it('dépenses du mois : factures + variations, sans doublon', () => {
    const r = reconcile(base, [bill({ amount: 10, paidDate: '2026-11-01' })], [], '2026-11-04');
    const spends = spendsOf('2026-11', [bill({ amount: 10, paidDate: '2026-11-01' })], r.movements);
    expect(total(spends)).toBe(70);
  });
});

describe('catégories', () => {
  it('devine à partir de quelques mots', () => {
    expect(categorizeLabel('kebab avec Paul')).toBe('RESTAURANT');
    expect(categorizeLabel('Amazon')).toBe('SHOPPING');
    expect(categorizeLabel('Retrait DAB')).toBe('CASH');
    expect(categorizeLabel('Leclerc')).toBe('FOOD');
    expect(categorizeLabel('Spotify')).toBe('SUBSCRIPTION');
    expect(categorizeLabel('essence')).toBe('TRANSPORT');
    expect(categorizeLabel('truc')).toBe('OTHER');
  });
});

describe('reste à dépenser', () => {
  it('par jour jusqu’à la fin du mois', () => {
    const a = dailyAllowance(500, '2026-11-21', [bill({ paid: false, paidDate: null, dueDate: '2026-11-25', amount: 100 })], [], 100);
    expect(a.daysLeft).toBe(10);
    expect(a.perDay).toBe(30);
  });
});
