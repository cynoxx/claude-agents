import type { Income, IncomeInput } from '../types';
import type { MonthBalance } from '../utils/balance';
import { api, toQuery } from './api';

export const incomeService = {
  list: () => api<Income[]>('/incomes'),
  create: (data: IncomeInput) => api<Income>('/incomes', { method: 'POST', json: data }),
  update: (id: string, data: IncomeInput) => api<Income>(`/incomes/${id}`, { method: 'PUT', json: data }),
  remove: (id: string) => api<void>(`/incomes/${id}`, { method: 'DELETE' }),
  balance: (months = 6) => api<MonthBalance[]>(`/incomes/balance${toQuery({ months })}`),
};
