import { describe, expect, it } from 'vitest';
import { merchantName, parseAmount, parseDate, parseStatement, planImport } from './bankStatement';

const LBP = `Numéro Compte   ;1234567X020
Type   ;CCP
Compte tenu en  ;euros
Date   ;03/11/2026
Solde (EUROS)   ;826,25
Solde (FRANCS)   ;5419,85

Date;Libellé;Montant(EUROS);Montant(FRANCS)
02/11/2026;"ACHAT CB CARREFOUR CITY 01.11.26 CARTE NUMERO 123";-20,00;-131,19
29/10/2026;"PRELEVEMENT DE PAYPAL EUROPE S.A.R.L. ET CIE S.C.A";-7,07;-46,38
28/10/2026;"VIREMENT DE CROUS CORSE BOURSE";1 234,50;8098,23
`;

describe('parseStatement', () => {
  it('lit un CSV de La Banque Postale', () => {
    const { format, transactions } = parseStatement(LBP);
    expect(format).toBe('csv');
    expect(transactions).toEqual([
      { date: '2026-11-02', label: 'ACHAT CB CARREFOUR CITY 01.11.26 CARTE NUMERO 123', amount: -20 },
      { date: '2026-10-29', label: 'PRELEVEMENT DE PAYPAL EUROPE S.A.R.L. ET CIE S.C.A', amount: -7.07 },
      { date: '2026-10-28', label: 'VIREMENT DE CROUS CORSE BOURSE', amount: 1234.5 },
    ]);
  });

  it('lit un CSV avec colonnes débit et crédit séparées', () => {
    const csv = 'Date opération,Libellé,Débit,Crédit\n2026-11-01,Spotify,7.07,\n2026-11-02,Salaire,,1500.00\n';
    expect(parseStatement(csv).transactions.map((t) => t.amount)).toEqual([-7.07, 1500]);
  });

  it('lit un export Bankin (description, catégorie, montant)', () => {
    const csv = 'Date;Description;Compte;Catégorie;Montant\n01/11/2026;Uber Eats;La Banque Postale;Restaurants;-12,40\n';
    expect(parseStatement(csv).transactions).toEqual([{ date: '2026-11-01', label: 'Uber Eats', amount: -12.4 }]);
  });

  it('lit un fichier OFX', () => {
    const ofx = '<OFX><STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261102<TRNAMT>-20.00<NAME>CARREFOUR</STMTTRN></OFX>';
    expect(parseStatement(ofx)).toEqual({ format: 'ofx', transactions: [{ date: '2026-11-02', label: 'CARREFOUR', amount: -20 }] });
  });
});

describe('formats', () => {
  it('montants', () => {
    expect(parseAmount('1 234,56')).toBe(1234.56);
    expect(parseAmount('-1.234,56 €')).toBe(-1234.56);
    expect(parseAmount('12.30')).toBe(12.3);
    expect(parseAmount('abc')).toBeNaN();
  });
  it('dates', () => {
    expect(parseDate('2/11/26')).toBe('2026-11-02');
    expect(parseDate('31/13/2026')).toBeNull();
  });
  it('nom du commerçant', () => {
    expect(merchantName('ACHAT CB CARREFOUR CITY 01.11.26 CARTE 1234')).toBe('Carrefour City');
    expect(merchantName('PRLV SEPA SPOTIFY')).toBe('Spotify');
  });
});

describe('planImport', () => {
  const { transactions } = parseStatement(LBP);

  it('sépare dépenses et rentrées', () => {
    const plan = planImport(transactions, [], []);
    expect(plan.expenses.map((e) => e.amount)).toEqual([-7.07, -20]);
    expect(plan.incomes.map((i) => i.amount)).toEqual([1234.5]);
    expect(plan.skipped).toBe(0);
  });

  it("n'importe pas deux fois le même relevé", () => {
    const first = planImport(transactions, [], []);
    const bills = first.expenses.map((e) => ({ amount: -e.amount, dueDate: e.date, paidDate: e.date, reference: e.key }));
    const incomes = first.incomes.map((i) => ({ amount: i.amount, date: i.date, notes: `Importée. ${i.key}` }));
    const again = planImport(transactions, bills, incomes);
    expect(again.expenses).toHaveLength(0);
    expect(again.incomes).toHaveLength(0);
    expect(again.skipped).toBe(3);
  });

  it('reconnaît une facture déjà saisie (même montant, date proche)', () => {
    const plan = planImport(transactions, [{ amount: 7.07, dueDate: '2026-10-29', paidDate: '2026-10-29', reference: null }], []);
    expect(plan.expenses.map((e) => e.amount)).toEqual([-20]);
    expect(plan.skipped).toBe(1);
  });

  it('garde deux achats identiques le même jour', () => {
    const twice = [...transactions.slice(0, 1), ...transactions.slice(0, 1)];
    expect(planImport(twice, [], []).expenses).toHaveLength(2);
  });
});
