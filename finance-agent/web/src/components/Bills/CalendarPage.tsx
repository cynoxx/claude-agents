import { useMemo, useState } from 'react';
import { useBillMutations, useBills } from '../../hooks/useBills';
import type { Bill } from '../../types';
import type { DueStatus as DueStatusKey } from '../../utils/dueStatus';
import { localToday, monthGrid } from '../../utils/dates';
import { DUE_STYLES, dueStatus } from '../../utils/dueStatus';
import { eur, formatDate, formatMonth } from '../../utils/format';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, CardHeader, EmptyState } from '../ui';
import { BillForm } from './BillForm';
import { BillRow } from './BillRow';

const WEEKDAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const LEGEND: DueStatusKey[] = ['overdue', 'urgent', 'soon', 'later', 'paid'];

export function CalendarPage() {
  const today = localToday();
  const [cursor, setCursor] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) }));
  const [selected, setSelected] = useState<string>(today);
  const [form, setForm] = useState<{ open: boolean; bill: Bill | null; date?: string }>({ open: false, bill: null });
  const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor]);
  const { data: bills = [] } = useBills({ from: weeks[0]![0], to: weeks.at(-1)![6], sort: 'dueDate', order: 'asc' });
  const { pay } = useBillMutations();
  const monthKey = `${cursor.year}-${String(cursor.month).padStart(2, '0')}`;

  const byDay = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const b of bills) map.set(b.dueDate, [...(map.get(b.dueDate) ?? []), b]);
    return map;
  }, [bills]);

  const monthBills = bills.filter((b) => b.dueDate.startsWith(monthKey));
  const monthTotal = monthBills.reduce((s, b) => s + b.amount, 0);
  const monthUnpaid = monthBills.filter((b) => !b.paid).reduce((s, b) => s + b.amount, 0);
  const selectedBills = byDay.get(selected) ?? [];

  const shift = (delta: number) =>
    setCursor(({ year, month }) => {
      const m = month + delta;
      return { year: year + Math.floor((m - 1) / 12), month: ((((m - 1) % 12) + 12) % 12) + 1 };
    });

  return (
    <>
      <PageTitle
        title="Calendrier des échéances"
        subtitle={`${formatMonth(monthKey, true)} : ${eur(monthTotal)} au total, dont ${eur(monthUnpaid)} restant à payer`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => shift(-1)} aria-label="Mois précédent">
              ←
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) });
                setSelected(today);
              }}
            >
              Aujourd'hui
            </Button>
            <Button variant="secondary" onClick={() => shift(1)} aria-label="Mois suivant">
              →
            </Button>
          </div>
        }
      />

      <div className="mb-3 flex flex-wrap gap-3 text-xs text-slate-600">
        {LEGEND.map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-full ${DUE_STYLES[s].dot}`} /> {DUE_STYLES[s].label}
          </span>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-slate-100 bg-slate-50 text-center text-xs font-medium text-slate-500">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {weeks.flat().map((day) => {
              const inMonth = day.startsWith(monthKey);
              const dayBills = byDay.get(day) ?? [];
              const isToday = day === today;
              const isSelected = day === selected;
              return (
                <button
                  key={day}
                  onClick={() => setSelected(day)}
                  onDoubleClick={() => setForm({ open: true, bill: null, date: day })}
                  className={`flex min-h-16 flex-col items-start justify-start border-b border-r border-slate-100 p-1 text-left transition sm:min-h-24 sm:p-1.5 ${
                    inMonth ? 'bg-white' : 'bg-slate-50/60 text-slate-400'
                  } ${isSelected ? 'ring-2 ring-inset ring-brand-500' : 'hover:bg-slate-50'}`}
                >
                  <span
                    className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs ${isToday ? 'bg-brand-700 font-semibold text-white' : ''}`}
                  >
                    {Number(day.slice(8))}
                  </span>
                  {/* Mobile : pastilles ; desktop : étiquettes */}
                  <div className="mt-1 flex flex-wrap gap-0.5 sm:hidden">
                    {dayBills.map((b) => (
                      <span key={b.id} className={`h-2 w-2 rounded-full ${DUE_STYLES[dueStatus(b, today)].dot}`} />
                    ))}
                  </div>
                  <div className="mt-1 hidden w-full space-y-0.5 sm:block">
                    {dayBills.slice(0, 3).map((b) => (
                      <div key={b.id} className={`truncate rounded border px-1 text-[11px] leading-4 ${DUE_STYLES[dueStatus(b, today)].chip}`}>
                        {b.title} · {eur(b.amount)}
                      </div>
                    ))}
                    {dayBills.length > 3 && <div className="text-[11px] text-slate-500">+{dayBills.length - 3} autre(s)</div>}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        <Card>
          <CardHeader
            title={formatDate(selected, { weekday: 'long', day: 'numeric', month: 'long' })}
            action={
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setForm({ open: true, bill: null, date: selected })}>
                + Ajouter
              </Button>
            }
          />
          {selectedBills.length === 0 ? (
            <EmptyState>Aucune échéance ce jour-là.</EmptyState>
          ) : (
            <div className="divide-y divide-slate-100">
              {selectedBills.map((b) => (
                <BillRow key={b.id} bill={b} today={today} onPay={() => pay.mutate(b.id)} onClick={() => setForm({ open: true, bill: b })} />
              ))}
            </div>
          )}
        </Card>
      </div>

      <BillForm open={form.open} onClose={() => setForm((f) => ({ ...f, open: false }))} bill={form.bill} defaultDueDate={form.date} />
    </>
  );
}
