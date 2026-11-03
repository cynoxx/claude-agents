import { useState } from 'react';
import type { MonthBalance } from '../../utils/balance';
import { eur, formatMonth } from '../../utils/format';

/**
 * Barres fines par mois : entrées (blanc) et sorties (gris) côte à côte.
 * Le mois courant est mis en avant ; le détail s'affiche au survol ou au toucher.
 */
export function BalanceChart({ months, height = 120 }: { months: MonthBalance[]; height?: number }) {
  const current = months[months.length - 1]?.month;
  const [active, setActive] = useState<string | null>(null);
  const shown = months.find((m) => m.month === (active ?? current));
  const max = Math.max(...months.flatMap((m) => [m.income, m.expenses]), 0);
  const h = (v: number) => (max > 0 && v > 0 ? Math.max(8, (v / max) * height) : 6);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-sm tabular-nums" aria-live="polite">
        {shown && (
          <>
            <span className="text-muted">{formatMonth(shown.month, true)}</span>
            <span>
              <span className="text-muted">Entrées</span> <span className="font-semibold">{eur(shown.income)}</span>
            </span>
            <span>
              <span className="text-muted">Sorties</span> <span className="font-semibold">{eur(shown.expenses)}</span>
            </span>
            <span className={shown.balance < 0 ? 'text-red-400' : ''}>
              <span className="text-muted">Reste</span> <span className="font-semibold">{eur(shown.balance)}</span>
            </span>
          </>
        )}
      </div>
      <div className="flex items-end justify-between gap-1 px-1" style={{ height }} role="list">
        {months.map((m) => {
          const isCurrent = m.month === current;
          return (
            <button
              key={m.month}
              role="listitem"
              aria-label={`${formatMonth(m.month, true)} : entrées ${eur(m.income)}, sorties ${eur(m.expenses)}`}
              onMouseEnter={() => setActive(m.month)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(m.month)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(m.month)}
              className="flex h-full flex-1 items-end justify-center gap-1.5"
            >
              <span className={`w-[7px] rounded-full ${m.income > 0 ? (isCurrent ? 'bar-highlight' : 'bg-ink') : 'bg-stub'}`} style={{ height: h(m.income) }} />
              <span className={`w-[7px] rounded-full ${m.expenses > 0 ? 'bg-white/35' : 'bg-stub'}`} style={{ height: h(m.expenses) }} />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-1 px-1">
        {months.map((m) => (
          <span key={m.month} className={`flex-1 text-center text-[11px] uppercase tracking-wide ${m.month === current ? 'text-ink' : 'text-muted'}`}>
            {formatMonth(m.month).split(' ')[0]!.replace('.', '')}
          </span>
        ))}
      </div>
      <div className="mt-4 flex justify-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-ink" /> Entrées
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-white/35" /> Sorties (factures)
        </span>
      </div>
    </div>
  );
}
