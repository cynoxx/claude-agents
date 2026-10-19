import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import { useSessionKeepAlive } from '../../hooks/useSessionKeepAlive';
import { notificationService } from '../../services/notificationService';
import { useAuthStore } from '../../store/authStore';

const NAV = [
  { to: '/', label: 'Tableau de bord', short: 'Accueil', icon: '📊' },
  { to: '/factures', label: 'Factures', short: 'Factures', icon: '🧾' },
  { to: '/calendrier', label: 'Calendrier', short: 'Agenda', icon: '📅' },
  { to: '/budget', label: 'Budget', short: 'Budget', icon: '💶' },
  { to: '/notifications', label: 'Notifications', short: 'Alertes', icon: '🔔' },
  { to: '/parametres', label: 'Paramètres', short: 'Réglages', icon: '⚙️' },
];

export function Layout() {
  useSessionKeepAlive();
  const { user, logout } = useAuthStore();
  const { data } = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => notificationService.list(true), refetchInterval: 60_000 });
  const unread = user?.notifyInApp === false ? 0 : (data?.unreadCount ?? 0);

  const badge = (to: string) =>
    to === '/notifications' && unread > 0 ? (
      <span className="ml-auto rounded-full bg-red-500 px-1.5 text-xs font-semibold text-white">{unread > 99 ? '99+' : unread}</span>
    ) : null;

  return (
    <div className="min-h-screen md:flex">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <img src="/favicon.svg" alt="" className="h-8 w-8" />
          <span className="font-semibold">Agent financier</span>
        </div>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-brand-50 font-medium text-brand-800' : 'text-slate-600 hover:bg-slate-50'}`
              }
            >
              <span aria-hidden>{n.icon}</span>
              {n.label}
              {badge(n.to)}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-slate-100 p-4 text-sm">
          <div className="truncate text-slate-600">{user?.name || user?.email}</div>
          <button onClick={logout} className="mt-1 text-slate-500 hover:text-slate-800">
            Se déconnecter
          </button>
        </div>
      </aside>

      <main className="flex-1 pb-20 md:pb-0">
        <div className="mx-auto max-w-6xl p-4 md:p-8">
          <Outlet />
        </div>
      </main>

      {/* Navigation mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-6 border-t border-slate-200 bg-white md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `relative flex flex-col items-center py-2 text-[11px] ${isActive ? 'text-brand-700' : 'text-slate-500'}`}
          >
            <span aria-hidden className="text-lg leading-none">
              {n.icon}
            </span>
            {n.short}
            {n.to === '/notifications' && unread > 0 && <span className="absolute right-3 top-1 h-2 w-2 rounded-full bg-red-500" />}
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
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
