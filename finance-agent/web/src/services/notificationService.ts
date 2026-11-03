import type { AppNotification, DashboardData } from '../types';
import { api, toQuery } from './api';

export const notificationService = {
  list: (unread?: boolean) => api<{ items: AppNotification[]; unreadCount: number }>(`/notifications${toQuery({ unread })}`),
  markRead: (id: string) => api(`/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () => api('/notifications/read-all', { method: 'PATCH' }),
};

export const dashboardService = {
  get: () => api<DashboardData>('/dashboard'),
};
