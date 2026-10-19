import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { notificationService } from '../../services/notificationService';
import { formatDate } from '../../utils/format';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, EmptyState, ErrorMessage, Spinner } from '../ui';

const ICONS = { BILL_REMINDER: '🔔', BUDGET_ALERT: '💶', ADMIN_TASK: '🗂️', GENERAL: 'ℹ️' } as const;

export function NotificationsPage() {
  const [unreadOnly, setUnreadOnly] = useState(false);
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: ['notifications', unreadOnly], queryFn: () => notificationService.list(unreadOnly || undefined) });
  const invalidate = () => Promise.all(['notifications', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k] })));
  const markRead = useMutation({ mutationFn: notificationService.markRead, onSuccess: invalidate });
  const markAll = useMutation({ mutationFn: notificationService.markAllRead, onSuccess: invalidate });

  return (
    <>
      <PageTitle
        title="Notifications"
        subtitle="Rappels d'échéance et alertes de budget"
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setUnreadOnly((v) => !v)}>
              {unreadOnly ? 'Tout afficher' : 'Non lues seulement'}
            </Button>
            <Button onClick={() => markAll.mutate()} disabled={!data?.unreadCount}>
              Tout marquer comme lu
            </Button>
          </div>
        }
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorMessage error={error} />
      ) : (
        <Card>
          {data!.items.length === 0 ? (
            <EmptyState>Aucune notification.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data!.items.map((n) => (
                <li key={n.id} className={`flex items-start gap-3 px-4 py-3 ${n.isRead ? 'opacity-60' : ''}`}>
                  <span aria-hidden className="text-lg">
                    {ICONS[n.type]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {!n.isRead && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Non lue" />}
                      {n.title}
                    </div>
                    <div className="text-sm text-slate-600">{n.message}</div>
                    <div className="mt-0.5 text-xs text-slate-400">
                      {new Date(n.createdAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      {n.dueDate && ` · échéance ${formatDate(n.dueDate)}`}
                    </div>
                  </div>
                  {!n.isRead && (
                    <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => markRead.mutate(n.id)}>
                      Marquer comme lu
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
