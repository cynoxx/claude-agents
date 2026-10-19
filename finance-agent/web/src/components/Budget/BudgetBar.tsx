import type { BudgetLine } from '../../types';
import { CATEGORIES } from '../../utils/categories';
import { eur } from '../../utils/format';

/** Jauge budget vs réel : la couleur d'état est toujours doublée d'un texte. */
export function BudgetBar({ line, threshold }: { line: BudgetLine; threshold: number }) {
  const pct = line.percentageUsed;
  const state = pct >= 100 ? 'over' : pct >= threshold ? 'warn' : 'ok';
  const bar = { ok: 'bg-green-600', warn: 'bg-orange-500', over: 'bg-red-600' }[state];
  const text = { ok: '', warn: 'Seuil atteint', over: 'Dépassé' }[state];
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: CATEGORIES[line.category].color }} />
          {CATEGORIES[line.category].label}
        </span>
        <span className="tabular-nums text-slate-600">
          {eur(line.spent)} / {eur(line.limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <div className="mt-0.5 flex justify-between text-xs text-slate-500">
        <span>{Math.round(pct)} %</span>
        {text && <span className={state === 'over' ? 'font-medium text-red-700' : 'text-orange-700'}>{text}</span>}
      </div>
    </div>
  );
}
