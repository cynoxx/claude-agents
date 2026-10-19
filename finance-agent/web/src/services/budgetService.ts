import type { BillCategory, BudgetLine } from '../types';
import { api, toQuery } from './api';

export const budgetService = {
  get: (year?: number, month?: number) => api<{ year: number; month: number; lines: BudgetLine[] }>(`/budget${toQuery({ year, month })}`),
  set: (data: { category: BillCategory; limitAmount: number; month: number; year: number }) => api('/budget', { method: 'POST', json: data }),
  remove: (id: string) => api<void>(`/budget/${id}`, { method: 'DELETE' }),
};
