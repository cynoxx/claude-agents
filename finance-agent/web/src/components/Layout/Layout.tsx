import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useSessionKeepAlive } from '../../hooks/useSessionKeepAlive';
import { STANDALONE } from '../../services/api';
import { authService } from '../../services/authService';
import { notificationService } from '../../services/notificationService';
import { SaveBar } from '../../standalone/LockGate';
import { useAuthStore } from '../../store/authStore';
import { Icon } from '../ui/icons';

const NAV = [
  { to: '/', label: 'Tableau de bord', short: 'Accueil', icon: 'home' },
  { to: '/factures', label: 'Factures', short: 'Factures', icon: 'bills' },
  { to: '/calendrier', label: 'Calendrier', short: 'Agenda', icon: 'calendar' },
  { to: '/budget', label: 'Budget', short: 'Budget', icon: 'budget' },
  { to: '/notifications', label: 'Notifications', short: 'Alertes', icon: 'bell' },
  { to: '/parametres', label: 'Paramètres', short: 'Réglages', icon: 'settings' },
] as const;

export function Layout() {
  useSessionKeepAlive();
  const { user, logout, setUser } = useAuthStore();
  useEffect(() => {
    if (STANDALONE) authService.me().then(setUser).catch(() => {});
  }, [setUser]);
  const { data } = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => notificationService.list(true), refetchInterval: 60_000 });
  const unread = user?.notifyInApp === false ? 0 : (data?.unreadCount ?? 0);

  const badge = (to: string) =>
    to === '/notifications' && unread > 0 ? (
      <span className="ml-auto rounded-full bg-ink px-1.5 text-xs font-medium text-on-ink">{unread > 99 ? '99+' : unread}</span>
    ) : null;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-[17px] font-bold text-on-ink" aria-hidden>€</span>
          <span className="font-semibold">Agent financier</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-4 py-2 text-sm ${isActive ? 'bg-card font-medium text-ink' : 'text-muted hover:text-ink'}`
              }
            >
              <Icon name={n.icon} />
              {n.label}
              {badge(n.to)}
            </NavLink>
          ))}
        </nav>
        <div className="p-5 text-sm">
          {!STANDALONE && (
            <>
              <div className="truncate text-ink/70">{user?.name || user?.email}</div>
              <button onClick={logout} className="mt-1 text-muted hover:text-ink">
                Se déconnecter
              </button>
            </>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl p-4 md:p-8">
          {STANDALONE && <SaveBar />}
          <Outlet />
        </div>
      </main>

      {/* Navigation mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `relative flex flex-col items-center py-2 text-[11px] ${isActive ? 'text-ink' : 'text-muted'}`}
          >
            <Icon name={n.icon} className="mb-0.5 h-5 w-5" />
            {n.short}
            {n.to === '/notifications' && unread > 0 && <span className="absolute right-[30%] top-1.5 h-1.5 w-1.5 rounded-full bg-ink" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
