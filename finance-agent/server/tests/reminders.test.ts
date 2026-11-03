import { describe, expect, it } from 'vitest';
import { nextDueDate } from '../src/services/billService.js';
import { planReminder, reminderText } from '../src/services/notificationService.js';

const days = [7, 3, 0];

describe('planReminder', () => {
  it('ne rappelle rien plus de 7 jours avant', () => {
    expect(planReminder('2026-10-30', '2026-10-19', days)).toBeNull();
  });

  it('rappelle à J-7, J-3 et le jour J', () => {
    expect(planReminder('2026-10-26', '2026-10-19', days)).toEqual({ stage: 7, daysUntil: 7 });
    expect(planReminder('2026-10-22', '2026-10-19', days)).toEqual({ stage: 3, daysUntil: 3 });
    expect(planReminder('2026-10-19', '2026-10-19', days)).toEqual({ stage: 0, daysUntil: 0 });
  });

  it('rattrape un rappel manqué avec le seuil atteint le plus proche', () => {
    expect(planReminder('2026-10-24', '2026-10-19', days)).toEqual({ stage: 7, daysUntil: 5 });
    expect(planReminder('2026-10-20', '2026-10-19', days)).toEqual({ stage: 3, daysUntil: 1 });
  });

  it('signale les factures en retard', () => {
    expect(planReminder('2026-10-15', '2026-10-19', days)).toEqual({ stage: 'overdue', daysUntil: -4 });
  });

  it('respecte des seuils personnalisés', () => {
    expect(planReminder('2026-11-02', '2026-10-19', [14, 1])).toEqual({ stage: 14, daysUntil: 14 });
    expect(planReminder('2026-10-19', '2026-10-19', [14, 1])).toEqual({ stage: 1, daysUntil: 0 });
  });
});

describe('reminderText', () => {
  const bill = { title: 'Électricité', provider: 'EDF', amount: 82.5 as never };
  it('rédige les messages en français', () => {
    expect(reminderText(bill, { stage: 3, daysUntil: 3 }, '2026-10-22').title).toBe('Échéance dans 3 jours : Électricité');
    expect(reminderText(bill, { stage: 0, daysUntil: 0 }, '2026-10-19').title).toBe("À payer aujourd'hui : Électricité");
    const late = reminderText(bill, { stage: 'overdue', daysUntil: -1 }, '2026-10-18');
    expect(late.title).toBe('Facture en retard : Électricité');
    expect(late.message).toContain('il y a 1 jour.');
    expect(late.message).toContain('82,50');
  });
});

describe('nextDueDate', () => {
  it('calcule la prochaine échéance', () => {
    expect(nextDueDate('2026-01-31', 'MONTHLY')).toBe('2026-02-28');
    expect(nextDueDate('2026-10-05', 'QUARTERLY')).toBe('2027-01-05');
    expect(nextDueDate('2026-10-05', 'YEARLY')).toBe('2027-10-05');
    expect(nextDueDate('2026-10-05', 'NONE')).toBeNull();
  });
});
