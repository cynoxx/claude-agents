import { Link } from 'react-router-dom';
import { requestLock } from '../../standalone/LockGate';
import { Card } from '../ui';
import { Icon, type IconName } from '../ui/icons';
import { Title } from './SimpleLayout';

const LINKS: { to: string; label: string; detail: string; icon: IconName }[] = [
  { to: '/factures', label: 'Factures et abonnements', detail: 'Échéances, pièces jointes, import de relevé', icon: 'bills' },
  { to: '/revenus', label: 'Revenus', detail: 'Bourse, salaire, aides qui tombent chaque mois', icon: 'income' },
  { to: '/plan', label: 'Plan', detail: 'Aides à demander, abonnements à résilier', icon: 'plan' },
  { to: '/budget', label: 'Budgets', detail: 'Limite par catégorie', icon: 'budget' },
  { to: '/calendrier', label: 'Calendrier', detail: 'Factures du mois, jour par jour', icon: 'calendar' },
  { to: '/notifications', label: 'Rappels', detail: 'Factures à payer bientôt', icon: 'bell' },
  { to: '/parametres', label: 'Réglages', detail: 'Rappels et alertes', icon: 'settings' },
];

export function MorePage() {
  return (
    <div>
      <Title>Plus</Title>
      <Card className="divide-y divide-white/5 px-2">
        {LINKS.map((l) => (
          <Link key={l.to} to={l.to} className="flex items-center gap-4 rounded-2xl px-3 py-3.5 hover:bg-white/5">
            <Icon name={l.icon} className="h-5 w-5 shrink-0 text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm">{l.label}</span>
              <span className="block truncate text-xs text-muted">{l.detail}</span>
            </span>
            <Icon name="right" className="h-4 w-4 shrink-0 text-muted" />
          </Link>
        ))}
        <button onClick={requestLock} className="flex w-full items-center gap-4 rounded-2xl px-3 py-3.5 text-left hover:bg-white/5">
          <Icon name="lock" className="h-5 w-5 shrink-0 text-muted" />
          <span className="text-sm">Verrouiller</span>
        </button>
      </Card>
    </div>
  );
}
