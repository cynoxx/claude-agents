import type { Bill, BillFilters, BillInput } from '../types';
import { api, toQuery } from './api';

export const billService = {
  list: (filters: BillFilters = {}) => api<Bill[]>(`/bills${toQuery(filters)}`),
  get: (id: string) => api<Bill>(`/bills/${id}`),
  create: (data: BillInput) => api<Bill>('/bills', { method: 'POST', json: data }),
  update: (id: string, data: Partial<BillInput>) => api<Bill>(`/bills/${id}`, { method: 'PUT', json: data }),
  remove: (id: string) => api<void>(`/bills/${id}`, { method: 'DELETE' }),
  pay: (id: string, paidDate?: string) => api<{ bill: Bill; next: Bill | null }>(`/bills/${id}/pay`, { method: 'PATCH', json: { paidDate } }),
};
