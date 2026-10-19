import { useState, type FormEvent } from 'react';
import { STANDALONE } from '../../services/api';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { PageTitle } from '../Layout/Layout';
import { Button, Card, CardHeader, Field, Input } from '../ui';

export function SettingsPage() {
  const { user, setUser } = useAuthStore();
  const [name, setName] = useState(user?.name ?? '');
  const [days, setDays] = useState((user?.billReminderDays ?? [7, 3, 0]).join(', '));
  const [threshold, setThreshold] = useState(String(user?.budgetWarningThreshold ?? 80));
  const [notifyEmail, setNotifyEmail] = useState(user?.notifyEmail ?? true);
  const [notifyInApp, setNotifyInApp] = useState(user?.notifyInApp ?? true);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = days
      .split(/[,;\s]+/)
      .filter(Boolean)
      .map(Number);
    if (!parsed.length || parsed.some((d) => !Number.isInteger(d) || d < 0 || d > 60)) {
      setStatus({ ok: false, msg: 'Jours de rappel : des nombres entiers entre 0 et 60, séparés par des virgules.' });
      return;
    }
    try {
      const updated = await authService.updateSettings({
        name: name.trim() || null,
        billReminderDays: parsed,
        budgetWarningThreshold: Number(threshold),
        notifyEmail,
        notifyInApp,
      });
      setUser(updated);
      setDays(updated.billReminderDays.join(', '));
      setStatus({ ok: true, msg: 'Réglages enregistrés.' });
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : 'Erreur' });
    }
  }

  return (
    <>
      <PageTitle title="Paramètres" subtitle={user?.email || undefined} />
      <form onSubmit={submit} className="grid max-w-2xl gap-4">
        <Card>
          <CardHeader title="Profil" />
          <div className="p-4">
            <Field label="Prénom">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Alertes" />
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <Field label="Rappels (jours avant l'échéance, 0 = le jour même)">
              <Input value={days} onChange={(e) => setDays(e.target.value)} placeholder="7, 3, 0" />
            </Field>
            <Field label="Alerte budget à (% de la limite)">
              <Input type="number" min={1} max={100} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card>
          <CardHeader title="Canaux de notification" />
          <div className="space-y-3 p-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-black" checked={notifyInApp} onChange={(e) => setNotifyInApp(e.target.checked)} />
              Dans l'application (pastille et liste des notifications)
            </label>
            {!STANDALONE && (
              <label className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 accent-black" checked={notifyEmail} onChange={(e) => setNotifyEmail(e.target.checked)} />
                Par email à {user?.email}
              </label>
            )}
            <p className="text-xs text-muted">Les notifications push et SMS arriveront dans une prochaine version.</p>
          </div>
        </Card>
        {status && <p className={`rounded-2xl p-3 text-sm ${status.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{status.msg}</p>}
        <div>
          <Button type="submit">Enregistrer</Button>
        </div>
      </form>
    </>
  );
}
