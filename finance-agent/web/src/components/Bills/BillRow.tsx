import type { Bill } from '../../types';
import { CATEGORIES } from '../../utils/categories';
import { DUE_STYLES, dueLabel, dueStatus } from '../../utils/dueStatus';
import { eur, formatDate } from '../../utils/format';

/** Ligne compacte réutilisée dans le dashboard et le calendrier. */
export function BillRow({ bill, today, onPay, onClick }: { bill: Bill; today: string; onPay?: () => void; onClick?: () => void }) {
  const status = dueStatus(bill, today);
  const cat = CATEGORIES[bill.category];
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DUE_STYLES[status].dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
      <button onClick={onClick} className="block w-full min-w-0 text-left" disabled={!onClick}>
        <div className="truncate text-sm font-medium">
          {bill.title}
        </div>
        <div className="truncate text-xs text-muted">
          {cat.label} · {bill.provider} · {formatDate(bill.dueDate)} · <span className={status === 'overdue' ? 'text-red-400' : ''}>{dueLabel(bill, today)}</span>
        </div>
      </button>
      </div>
      <div className="whitespace-nowrap text-right text-sm font-semibold tabular-nums">{eur(bill.amount)}</div>
      {onPay && !bill.paid && (
        <button onClick={onPay} className="rounded-full border border-white/15 px-2.5 py-1 text-xs hover:bg-white/5" title="Marquer comme payée">
          ✓ Payée
        </button>
      )}
    </div>
  );
}
