import { useEffect, useRef } from 'react';
import { STANDALONE } from '../services/api';
import { authService } from '../services/authService';
import { useAuthStore } from '../store/authStore';

const REFRESH_EVERY_MS = 10 * 60_000;
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll'] as const;

/**
 * Le jeton expire après 30 minutes. Tant que l'utilisateur est actif, on le renouvelle
 * toutes les 10 minutes ; sans activité, la session expire d'elle-même.
 */
export function useSessionKeepAlive() {
  const token = useAuthStore((s) => s.token);
  const lastActivity = useRef(Date.now());

  useEffect(() => {
    if (!token || STANDALONE) return;
    const mark = () => (lastActivity.current = Date.now());
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const timer = setInterval(async () => {
      if (Date.now() - lastActivity.current > REFRESH_EVERY_MS) return;
      try {
        const { token: fresh } = await authService.refresh();
        useAuthStore.getState().setToken(fresh);
      } catch {
        /* le 401 déconnecte déjà l'utilisateur */
      }
    }, REFRESH_EVERY_MS);
    return () => {
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, mark));
    };
  }, [token]);
}
