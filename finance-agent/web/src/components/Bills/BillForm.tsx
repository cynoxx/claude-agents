import { useState, type FormEvent } from 'react';
import { useBillMutations } from '../../hooks/useBills';
import { ApiError } from '../../services/api';
import type { Bill, BillCategory, BillInput, Recurrence } from '../../types';
import { CATEGORIES, CATEGORY_KEYS, RECURRENCES } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { Button, Field, Input, Modal, Select } from '../ui';

interface Props {
  open: boolean;
  onClose: () => void;
  bill?: Bill | null;
  defaultDueDate?: string;
  /** Valeurs initiales d'une nouvelle facture (ex. un abonnement mensuel) */
  preset?: { category: BillCategory; recurrence: Recurrence };
}

export function BillForm({ open, onClose, bill, defaultDueDate, preset }: Props) {
  const title = bill ? 'Modifier la facture' : preset?.category === 'SUBSCRIPTION' ? 'Nouvel abonnement' : 'Nouvelle facture';
  return (
    <Modal open={open} onClose={onClose} title={title}>
      {/* La clé remonte le formulaire à chaque ouverture pour repartir des bonnes valeurs */}
      {open && <BillFormBody key={bill?.id ?? defaultDueDate ?? 'new'} bill={bill} defaultDueDate={defaultDueDate} preset={preset} onDone={onClose} />}
    </Modal>
  );
}

function BillFormBody({ bill, defaultDueDate, preset, onDone }: { bill?: Bill | null; defaultDueDate?: string; preset?: Props['preset']; onDone: () => void }) {
  const { create, update } = useBillMutations();
  const [form, setForm] = useState({
    title: bill?.title ?? '',
    provider: bill?.provider ?? '',
    amount: bill ? String(bill.amount) : '',
    dueDate: bill?.dueDate ?? defaultDueDate ?? localToday(),
    category: (bill?.category ?? preset?.category ?? '') as BillCategory | '',
    recurrence: (bill?.recurrence ?? preset?.recurrence ?? 'NONE') as Recurrence,
    reference: bill?.reference ?? '',
    documentUrl: bill?.documentUrl ?? '',
    notes: bill?.notes ?? '',
    paid: bill?.paid ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const pending = create.isPending || update.isPending;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors({});
    setError(null);
    const data: BillInput = {
      title: form.title,
      provider: form.provider,
      amount: Number(form.amount.replace(',', '.')),
      dueDate: form.dueDate,
      category: form.category || undefined,
      recurrence: form.recurrence,
      reference: form.reference || null,
      documentUrl: form.documentUrl || null,
      notes: form.notes || null,
      paid: form.paid,
    };
    try {
      if (bill) await update.mutateAsync({ id: bill.id, data });
      else await create.mutateAsync(data);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.details) setErrors(err.details);
      setError(err instanceof Error ? err.message : 'Erreur');
    }
  }

  const err = (k: string) => errors[k]?.[0];

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Intitulé" error={err('title')}>
          <Input required value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="Électricité octobre" />
        </Field>
        <Field label="Fournisseur" error={err('provider')}>
          <Input required value={form.provider} onChange={(e) => set('provider', e.target.value)} placeholder="EDF" />
        </Field>
        <Field label="Montant (€)" error={err('amount')}>
          <Input required inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} placeholder="82,50" />
        </Field>
        <Field label="Échéance" error={err('dueDate')}>
          <Input required type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
        <Field label="Catégorie">
          <Select value={form.category} onChange={(e) => set('category', e.target.value as BillCategory | '')}>
            <option value="">Automatique (d'après le fournisseur)</option>
            {CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Récurrence">
          <Select value={form.recurrence} onChange={(e) => set('recurrence', e.target.value as Recurrence)}>
            {Object.entries(RECURRENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Référence (facultatif)">
          <Input value={form.reference} onChange={(e) => set('reference', e.target.value)} />
        </Field>
        <Field label="Lien du document (facultatif)" error={err('documentUrl')}>
          <Input type="url" value={form.documentUrl} onChange={(e) => set('documentUrl', e.target.value)} placeholder="https://" />
        </Field>
      </div>
      <Field label="Notes (facultatif)">
        <textarea
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          rows={2}
          className="w-full rounded-2xl border border-transparent bg-field px-3.5 py-2 text-sm focus:border-ink focus:outline-none"
        />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.paid} onChange={(e) => set('paid', e.target.checked)} className="h-4 w-4 accent-white" />
        Déjà payée
      </label>
      {form.recurrence !== 'NONE' && (
        <p className="rounded-2xl bg-card p-3 text-xs text-ink/70">
          Quand cette facture sera marquée payée, la suivante sera créée automatiquement avec le même montant.
        </p>
      )}
      {error && <p className="rounded-2xl bg-red-500/15 p-3 text-sm text-red-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? 'Enregistrement…' : 'Enregistrer'}
        </Button>
      </div>
    </form>
  );
}
