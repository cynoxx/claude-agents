import { describe, expect, it } from 'vitest';
import { monthGrid } from './dates';
import { dueLabel, dueStatus } from './dueStatus';

const today = '2026-10-19';

describe('dueStatus', () => {
  it('applique le code couleur des échéances', () => {
    expect(dueStatus({ paid: false, dueDate: '2026-10-18' }, today)).toBe('overdue');
    expect(dueStatus({ paid: false, dueDate: '2026-10-19' }, today)).toBe('urgent');
    expect(dueStatus({ paid: false, dueDate: '2026-10-22' }, today)).toBe('urgent');
    expect(dueStatus({ paid: false, dueDate: '2026-10-23' }, today)).toBe('soon');
    expect(dueStatus({ paid: false, dueDate: '2026-10-26' }, today)).toBe('soon');
    expect(dueStatus({ paid: false, dueDate: '2026-10-27' }, today)).toBe('later');
    expect(dueStatus({ paid: true, dueDate: '2026-10-01' }, today)).toBe('paid');
  });

  it('formule les délais', () => {
    expect(dueLabel({ paid: false, dueDate: '2026-10-17' }, today)).toBe('En retard de 2 j');
    expect(dueLabel({ paid: false, dueDate: today }, today)).toBe("Aujourd'hui");
    expect(dueLabel({ paid: false, dueDate: '2026-10-20' }, today)).toBe('Demain');
    expect(dueLabel({ paid: false, dueDate: '2026-10-25' }, today)).toBe('Dans 6 j');
  });
});

describe('monthGrid', () => {
  it('construit des semaines du lundi au dimanche', () => {
    const grid = monthGrid(2026, 10);
    expect(grid[0]![0]).toBe('2026-09-28'); // le 1er octobre 2026 est un jeudi
    expect(grid.at(-1)![6]).toBe('2026-11-01');
    expect(grid.every((w) => w.length === 7)).toBe(true);
  });
});
