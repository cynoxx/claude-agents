import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '../../services/authService';
import { useAuthStore } from '../../store/authStore';
import { Button, Field, Input } from '../ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const setSession = useAuthStore((s) => s.setSession);
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isLogin = mode === 'login';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = isLogin ? await authService.login(email, password) : await authService.register(email, password, name);
      setSession(session.token, session.user);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-6 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-9 w-9" />
          <div>
            <h1 className="text-lg font-semibold">Agent financier</h1>
            <p className="text-xs text-slate-500">Factures, échéances et budget au même endroit</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {!isLogin && (
            <Field label="Prénom (facultatif)">
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </Field>
          <Field label="Mot de passe">
            <Input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
            />
          </Field>
          {error && <p className="rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? '…' : isLogin ? 'Se connecter' : 'Créer mon compte'}
          </Button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          {isLogin ? (
            <>
              Pas encore de compte ? <Link to="/inscription" className="font-medium text-brand-700">Créer un compte</Link>
            </>
          ) : (
            <>
              Déjà inscrit ? <Link to="/connexion" className="font-medium text-brand-700">Se connecter</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
