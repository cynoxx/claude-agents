import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { SaveBar } from '../../standalone/LockGate';
import { Icon } from '../ui/icons';
import { useVault } from './useMoney';

const NAV = [
  { to: '/', label: "Aujourd'hui", icon: 'wallet' },
  { to: '/depenses', label: 'Dépenses', icon: 'budget' },
  { to: '/conseils', label: 'Conseils', icon: 'tips' },
  { to: '/plus', label: 'Plus', icon: 'more' },
] as const;

const MAIN = new Set(NAV.map((n) => n.to));

/** Version simple : quatre onglets, le reste rangé dans « Plus ». */
export function SimpleLayout() {
  const { money } = useVault();
  const pending = money.movements.filter((m) => m.status === 'pending').length;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const inner = !MAIN.has(pathname as (typeof NAV)[number]['to']);
  const dot = (to: string) => to === '/' && pending > 0;

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col md:flex">
        <div className="flex items-center gap-2 px-5 py-5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-[17px] font-bold text-on-ink" aria-hidden>
            €
          </span>
          <span className="font-semibold">Mon argent</span>
        </div>
        <nav className="space-y-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-full px-4 py-2 text-sm ${isActive || (n.to === '/plus' && inner) ? 'bg-card font-medium text-ink' : 'text-muted hover:text-ink'}`
              }
            >
              <Icon name={n.icon} />
              {n.label}
              {dot(n.to) && <span className="ml-auto rounded-full bg-ink px-1.5 text-xs font-medium text-on-ink">{pending}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 pb-24 md:pb-0">
        <div className="mx-auto max-w-3xl px-4 py-4 md:p-8">
          <SaveBar />
          {inner && (
            <button onClick={() => navigate('/plus')} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
              <Icon name="left" className="h-4 w-4" />
              Plus
            </button>
          )}
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) => `relative flex flex-col items-center py-2.5 text-[11px] ${isActive || (n.to === '/plus' && inner) ? 'text-ink' : 'text-muted'}`}
          >
            <Icon name={n.icon} className="mb-0.5 h-5 w-5" />
            {n.label}
            {dot(n.to) && <span className="absolute right-[32%] top-2 h-1.5 w-1.5 rounded-full bg-ink" />}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Titre de page discret */
export function Title({ children, sub }: { children: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-tight">{children}</h1>
      {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
    </div>
  );
}
