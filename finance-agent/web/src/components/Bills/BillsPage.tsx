import { useState } from 'react';
import { useBillMutations, useBills } from '../../hooks/useBills';
import type { Bill, BillCategory, BillFilters } from '../../types';
import { CATEGORIES, CATEGORY_KEYS, RECURRENCES } from '../../utils/categories';
import { localToday } from '../../utils/dates';
import { DUE_STYLES, dueLabel, dueStatus } from '../../utils/dueStatus';
import { eur, formatDate } from '../../utils/format';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, EmptyState, ErrorMessage, Input, Modal, Select, Spinner } from '../ui';
import { BillForm } from './BillForm';

const SORTS: Record<string, string> = { dueDate: 'Échéance', amount: 'Montant', provider: 'Fournisseur', title: 'Intitulé', createdAt: 'Ajout' };

export function BillsPage() {
  const [filters, setFilters] = useState<BillFilters>({ status: 'unpaid', sort: 'dueDate', order: 'asc' });
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Bill | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const { data: bills, isLoading, error } = useBills({ ...filters, q: search.trim() || undefined });
  const { pay, remove } = useBillMutations();
  const today = localToday();
  const total = bills?.reduce((s, b) => s + b.amount, 0) ?? 0;
  const set = (patch: Partial<BillFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const openForm = (bill: Bill | null) => {
    setEditing(bill);
    setFormOpen(true);
  };

  // Confirmation dans la page (les boîtes de dialogue du navigateur sont bloquées dans un artefact)
  const [toDelete, setToDelete] = useState<Bill | null>(null);
  const onDelete = (bill: Bill) => setToDelete(bill);

  return (
    <>
      <PageTitle title="Factures" subtitle="Suivi, historique et paiement de vos factures" action={<Button onClick={() => openForm(null)}>+ Ajouter une facture</Button>} />

      <Card className="mb-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Rechercher un fournisseur…" value={search} onChange={(e) => setSearch(e.target.value)} className="lg:col-span-2" />
          <Select value={filters.status} onChange={(e) => set({ status: e.target.value as BillFilters['status'] })} aria-label="Statut">
            <option value="all">Toutes</option>
            <option value="unpaid">À payer</option>
            <option value="overdue">En retard</option>
            <option value="paid">Payées (historique)</option>
          </Select>
          <Select value={filters.category ?? ''} onChange={(e) => set({ category: e.target.value as BillCategory | '' })} aria-label="Catégorie">
            <option value="">Toutes catégories</option>
            {CATEGORY_KEYS.map((c) => (
              <option key={c} value={c}>
                {CATEGORIES[c].label}
              </option>
            ))}
          </Select>
          <div className="flex gap-2">
            <Select value={filters.sort} onChange={(e) => set({ sort: e.target.value as BillFilters['sort'] })} aria-label="Trier par">
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              onClick={() => set({ order: filters.order === 'asc' ? 'desc' : 'asc' })}
              aria-label={filters.order === 'asc' ? 'Ordre croissant' : 'Ordre décroissant'}
              title={filters.order === 'asc' ? 'Croissant' : 'Décroissant'}
            >
              {filters.order === 'asc' ? '↑' : '↓'}
            </Button>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:flex sm:items-center">
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
            Du <Input type="date" value={filters.from ?? ''} onChange={(e) => set({ from: e.target.value || undefined })} className="min-w-0 flex-1 py-1" />
          </label>
          <label className="flex min-w-0 items-center gap-2 text-xs text-muted">
            au <Input type="date" value={filters.to ?? ''} onChange={(e) => set({ to: e.target.value || undefined })} className="min-w-0 flex-1 py-1" />
          </label>
        </div>
      </Card>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : (
        <Card>
          <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 text-sm text-ink/70">
            <span>
              {bills!.length} facture{bills!.length > 1 ? 's' : ''}
            </span>
            <span className="font-semibold text-ink">Total {eur(total)}</span>
          </div>
          {bills!.length === 0 ? (
            <EmptyState>Aucune facture pour ces critères.</EmptyState>
          ) : (
            <>
              {/* Tableau desktop */}
              <table className="hidden w-full text-sm md:table">
                <thead className="text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-4 py-2 font-medium">Facture</th>
                    <th className="px-4 py-2 font-medium">Catégorie</th>
                    <th className="px-4 py-2 font-medium">Échéance</th>
                    <th className="px-4 py-2 text-right font-medium">Montant</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {bills!.map((b) => {
                    const st = dueStatus(b, today);
                    return (
                      <tr key={b.id} className="hover:bg-white/5">
                        <td className="px-4 py-3">
                          <div className="font-medium">{b.title}</div>
                          <div className="text-xs text-muted">
                            {b.provider}
                            {b.reference && ` · réf. ${b.reference}`}
                            {b.recurrence !== 'NONE' && ` · ${RECURRENCES[b.recurrence]}`}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-ink/70">{CATEGORIES[b.category].label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div>{formatDate(b.dueDate)}</div>
                          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-xs ${DUE_STYLES[st].badge}`}>
                            {b.paid && b.paidDate ? `Payée le ${formatDate(b.paidDate, { day: 'numeric', month: 'short' })}` : dueLabel(b, today)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{eur(b.amount)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right">
                          {!b.paid && (
                            <Button variant="secondary" className="mr-1 px-2 py-1 text-xs" onClick={() => pay.mutate(b.id)}>
                              ✓ Payée
                            </Button>
                          )}
                          {b.documentUrl && (
                            <a href={b.documentUrl} target="_blank" rel="noreferrer" className="mr-1 inline-block rounded-md px-2 py-1 text-xs text-brand-700 hover:bg-white/5">
                              PDF
                            </a>
                          )}
                          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => openForm(b)}>
                            Modifier
                          </Button>
                          <Button variant="ghost" className="px-2 py-1 text-xs text-red-400" onClick={() => onDelete(b)}>
                            Supprimer
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Cartes mobile */}
              <ul className="divide-y divide-white/5 md:hidden">
                {bills!.map((b) => {
                  const st = dueStatus(b, today);
                  return (
                    <li key={b.id} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <button className="min-w-0 text-left" onClick={() => openForm(b)}>
                          <div className="truncate font-medium">
                            {b.title}
                          </div>
                          <div className="text-xs text-muted">
                            {b.provider} · {formatDate(b.dueDate)}
                          </div>
                        </button>
                        <div className="text-right">
                          <div className="font-semibold tabular-nums">{eur(b.amount)}</div>
                          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs ${DUE_STYLES[st].badge}`}>{dueLabel(b, today)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex gap-2">
                        {!b.paid && (
                          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => pay.mutate(b.id)}>
                            ✓ Payée
                          </Button>
                        )}
                        <Button variant="ghost" className="px-2 py-1 text-xs text-red-400" onClick={() => onDelete(b)}>
                          Supprimer
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </Card>
      )}

      <BillForm open={formOpen} onClose={() => setFormOpen(false)} bill={editing} />
      <Modal open={toDelete !== null} onClose={() => setToDelete(null)} title="Supprimer la facture">
        <p className="text-sm text-ink/70">
          « {toDelete?.title} » ({toDelete?.provider}) sera supprimée définitivement, avec ses rappels.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setToDelete(null)}>
            Annuler
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (toDelete) remove.mutate(toDelete.id);
              setToDelete(null);
            }}
          >
            Supprimer
          </Button>
        </div>
      </Modal>
    </>
  );
}
