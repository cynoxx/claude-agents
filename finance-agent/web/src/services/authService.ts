import type { User } from '../types';
import { api } from './api';

interface Session {
  token: string;
  user: User;
}

export const authService = {
  login: (email: string, password: string) => api<Session>('/auth/login', { method: 'POST', json: { email, password } }),
  register: (email: string, password: string, name?: string) =>
    api<Session>('/auth/register', { method: 'POST', json: { email, password, name: name || undefined } }),
  refresh: () => api<{ token: string }>('/auth/refresh', { method: 'POST' }),
  me: () => api<User>('/auth/me'),
  updateSettings: (data: Partial<Pick<User, 'name' | 'billReminderDays' | 'budgetWarningThreshold' | 'notifyEmail' | 'notifyInApp'>>) =>
    api<User>('/settings', { method: 'PUT', json: data }),
};
