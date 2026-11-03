import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type DragEvent } from 'react';
import { billService } from '../../services/billService';
import { incomeService } from '../../services/incomeService';
import { decodeStatement, parseStatement, planImport, type ImportPlan } from '../../utils/bankStatement';
import { eur, formatDate } from '../../utils/format';
import { Button, ErrorMessage, Modal } from '../ui';
import { Icon } from '../ui/icons';

const ACCEPT = '.csv,.ofx,.qfx,.txt,text/csv';
const PREVIEW = 8;

/**
 * Import d'un relevé exporté depuis la banque ou Bankin : chaque dépense devient une
 * facture payée (catégorie devinée d'après le commerçant), chaque crédit une rentrée.
 */
export function BankImport({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [fileName, setFileName] = useState('');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ expenses: number; incomes: number } | null>(null);

  const reset = () => {
    setPlan(null);
    setFileName('');
    setError(null);
    setDone(null);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const take = async (f: File | undefined) => {
    if (!f) return;
    reset();
    setFileName(f.name);
    try {
      const { transactions } = parseStatement(decodeStatement(await f.arrayBuffer()));
      if (!transactions.length) throw new Error("Aucune opération trouvée dans ce fichier. Il faut l'export CSV ou OFX de ton compte.");
      const [bills, incomes] = await Promise.all([billService.list({ status: 'all' }), incomeService.list()]);
      setPlan(planImport(transactions, bills, incomes));
    } catch (e) {
      setError(e);
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files[0]);
  };

  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError(null);
    let expenses = 0;
    let incomes = 0;
    try {
      for (const t of plan.expenses) {
        await billService.create({
          title: t.provider,
          provider: t.provider,
          amount: -t.amount,
          dueDate: t.date,
          paid: true,
          paidDate: t.date,
          reference: t.key,
          notes: `Importée depuis ton relevé bancaire : ${t.label}`,
        });
        expenses++;
      }
      for (const t of plan.incomes) {
        await incomeService.create({
          label: t.provider,
          source: null,
          amount: t.amount,
          date: t.date,
          endDate: null,
          recurrence: 'NONE',
          category: 'OTHER',
          notes: `Importée depuis ton relevé bancaire : ${t.label} ${t.key}`,
        });
        incomes++;
      }
      setDone({ expenses, incomes });
      setPlan(null);
    } catch (e) {
      setError(e);
      if (expenses || incomes) setDone({ expenses, incomes });
    } finally {
      setBusy(false);
      await Promise.all(['bills', 'dashboard', 'budget', 'notifications', 'incomes', 'balance'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
    }
  };

  const spent = plan?.expenses.reduce((t, e) => t - e.amount, 0) ?? 0;
  const received = plan?.incomes.reduce((t, i) => t + i.amount, 0) ?? 0;
  const preview = plan ? [...plan.expenses, ...plan.incomes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, PREVIEW) : [];

  return (
    <Modal open={open} onClose={close} title="Importer un relevé bancaire">
      <p className="mb-4 text-sm text-muted">
        Exporte tes opérations depuis Bankin ou l'espace client de ta banque (fichier CSV ou OFX), puis dépose le fichier ici. Les dépenses arrivent dans
        Factures, déjà payées, et les virements reçus dans Revenus. Un relevé importé deux fois n'ajoute rien.
      </p>

      {!plan && !done && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          className={`flex w-full flex-col items-center gap-1 rounded-2xl border border-dashed px-4 py-6 text-sm transition ${over ? 'border-ink bg-white/5' : 'border-white/15 hover:border-white/30'}`}
        >
          <Icon name="clip" className="h-5 w-5 text-muted" />
          <span>{fileName || 'Glisse ton relevé ici'}</span>
          <span className="text-xs text-muted">ou clique pour choisir le fichier · CSV ou OFX</span>
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          void take(e.target.files?.[0]);
          e.target.value = '';
        }}
      />

      {error != null && (
        <div className="mt-3">
          <ErrorMessage error={error} />
        </div>
      )}

      {plan && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-field p-3">
              <div className="text-xs text-muted">Dépenses</div>
              <div className="mt-0.5 font-medium">
                {plan.expenses.length} · {eur(spent)}
              </div>
            </div>
            <div className="rounded-2xl bg-field p-3">
              <div className="text-xs text-muted">Rentrées</div>
              <div className="mt-0.5 font-medium">
                {plan.incomes.length} · {eur(received)}
              </div>
            </div>
          </div>
          {plan.skipped > 0 && (
            <p className="text-xs text-muted">
              {plan.skipped} opération{plan.skipped > 1 ? 's' : ''} déjà présente{plan.skipped > 1 ? 's' : ''} (importée{plan.skipped > 1 ? 's' : ''} avant ou
              saisie{plan.skipped > 1 ? 's' : ''} à la main) : ignorée{plan.skipped > 1 ? 's' : ''}.
            </p>
          )}
          {preview.length > 0 && (
            <ul className="divide-y divide-white/5 text-sm">
              {preview.map((t) => (
                <li key={t.key} className="flex items-center gap-3 py-2">
                  <span className="w-16 shrink-0 text-xs text-muted">{formatDate(t.date, { day: 'numeric', month: 'short' })}</span>
                  <span className="min-w-0 flex-1 truncate">{t.provider}</span>
                  <span className={`whitespace-nowrap tabular-nums ${t.amount > 0 ? 'text-ink' : 'text-ink/70'}`}>
                    {t.amount > 0 ? '+' : '−'}
                    {eur(Math.abs(t.amount))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {plan.expenses.length + plan.incomes.length > PREVIEW && (
            <p className="text-xs text-muted">et {plan.expenses.length + plan.incomes.length - PREVIEW} autres opérations.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={reset} disabled={busy}>
              Autre fichier
            </Button>
            <Button onClick={run} disabled={busy || plan.expenses.length + plan.incomes.length === 0}>
              {busy ? 'Import en cours…' : 'Importer'}
            </Button>
          </div>
        </div>
      )}

      {done && (
        <div className="space-y-4">
          <p className="text-sm">
            {done.expenses} dépense{done.expenses > 1 ? 's' : ''} et {done.incomes} rentrée{done.incomes > 1 ? 's' : ''} ajoutée
            {done.expenses + done.incomes > 1 ? 's' : ''}. Les catégories sont devinées d'après le commerçant : tu peux les corriger dans Factures.
          </p>
          <div className="flex justify-end">
            <Button onClick={close}>Fermer</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
