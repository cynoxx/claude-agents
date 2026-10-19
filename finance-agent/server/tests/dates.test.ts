import { describe, expect, it } from 'vitest';
import { addMonths, daysBetween, monthBounds, todayIn } from '../src/lib/dates.js';

describe('dates', () => {
  it('calcule la date du jour dans le fuseau', () => {
    // 23h30 UTC le 31 décembre = déjà le 1er janvier à Paris
    expect(todayIn('Europe/Paris', new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01');
    expect(todayIn('UTC', new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
  });

  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7);
    expect(daysBetween('2026-10-19', '2026-10-18')).toBe(-1);
    // Passage à l'heure d'hiver sans effet
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('ajoute des mois en gérant les fins de mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('2026-03-10', -5)).toBe('2025-10-10');
  });

  it('donne les bornes du mois', () => {
    expect(monthBounds(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthBounds(2026, 12)).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });
});
