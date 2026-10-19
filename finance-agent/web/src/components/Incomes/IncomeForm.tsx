import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { ApiError } from '../../services/api';
import { incomeService } from '../../services/incomeService';
import type { Income, IncomeCategory, IncomeInput, Recurrence } from '../../types';
import { INCOME_CATEGORIES, RECURRENCES } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { Button, Field, Input, Modal, Select } from '../ui';

export function useIncomeMutations() {
  const qc = useQueryClient();
  const invalidate = () => Promise.all(['incomes', 'balance'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    save: useMutation({
      mutationFn: ({ id, data }: { id?: string; data: IncomeInput }) => (id ? incomeService.update(id, data) : incomeService.create(data)),
      onSuccess: invalidate,
    }),
    remove: useMutation({ mutationFn: (id: string) => incomeService.remove(id), onSuccess: invalidate }),
  };
}

export function IncomeForm({ open, onClose, income }: { open: boolean; onClose: () => void; income: Income | null }) {
  return (
    <Modal open={open} onClose={onClose} title={income ? 'Modifier la rentrée' : 'Nouvelle rentrée d’argent'}>
      {open && <IncomeFormBody key={income?.id ?? 'new'} income={income} onDone={onClose} />}
    </Modal>
  );
}

function IncomeFormBody({ income, onDone }: { income: Income | null; onDone: () => void }) {
  const { save } = useIncomeMutations();
  const [form, setForm] = useState({
    label: income?.label ?? '',
    source: income?.source ?? '',
    amount: income ? String(income.amount) : '',
    date: income?.date ?? localToday(),
    endDate: income?.endDate ?? '',
    recurrence: (income?.recurrence ?? 'MONTHLY') as Recurrence,
    category: (income?.category ?? 'SALARY') as IncomeCategory,
    notes: income?.notes ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    const data: IncomeInput = {
      label: form.label,
      source: form.source || null,
      amount: Number(form.amount.replace(',', '.')),
      date: form.date,
      endDate: form.recurrence === 'NONE' ? null : form.endDate || null,
      recurrence: form.recurrence,
      category: form.category,
      notes: form.notes || null,
    };
    try {
      await save.mutateAsync({ id: income?.id, data });
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      else setError(err instanceof Error ? err.message : 'Enregistrement impossible');
    }
  }

  const err = (k: string) => errors[k]?.[0];
  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Intitulé" error={err('label')}>
          <Input value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Salaire" autoFocus />
        </Field>
        <Field label="Montant (€)" error={err('amount')}>
          <Input value={form.amount} onChange={(e) => set('amount', e.target.value)} inputMode="decimal" placeholder="2 100,00" />
        </Field>
        <Field label="Provenance (facultatif)" error={err('source')}>
          <Input value={form.source} onChange={(e) => set('source', e.target.value)} placeholder="Employeur, CAF…" />
        </Field>
        <Field label="Catégorie" error={err('category')}>
          <Select value={form.category} onChange={(e) => set('category', e.target.value as IncomeCategory)}>
            {Object.entries(INCOME_CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Périodicité" error={err('recurrence')}>
          <Select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
            {Object.entries(RECURRENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {k === 'NONE' ? 'Une seule fois' : v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={form.recurrence === 'NONE' ? 'Date' : 'Première rentrée'} error={err('date')}>
          <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
        </Field>
        {form.recurrence !== 'NONE' && (
          <Field label="Jusqu’au (facultatif)" error={err('endDate')}>
            <Input type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
        )}
      </div>
      <Field label="Notes" error={err('notes')}>
        <Input value={form.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="secondary" className="bg-field" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={save.isPending}>
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
