import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { billService } from '../services/billService';
import type { BillFilters, BillInput } from '../types';

export function useBills(filters: BillFilters = {}) {
  return useQuery({ queryKey: ['bills', filters], queryFn: () => billService.list(filters) });
}

/** Mutations sur les factures : rafraîchit listes, dashboard, budget et notifications. */
export function useBillMutations() {
  const qc = useQueryClient();
  const invalidate = () =>
    Promise.all(['bills', 'dashboard', 'budget', 'notifications'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  return {
    create: useMutation({ mutationFn: (data: BillInput) => billService.create(data), onSuccess: invalidate }),
    update: useMutation({ mutationFn: ({ id, data }: { id: string; data: Partial<BillInput> }) => billService.update(id, data), onSuccess: invalidate }),
    remove: useMutation({ mutationFn: (id: string) => billService.remove(id), onSuccess: invalidate }),
    pay: useMutation({ mutationFn: (id: string) => billService.pay(id), onSuccess: invalidate }),
  };
}
