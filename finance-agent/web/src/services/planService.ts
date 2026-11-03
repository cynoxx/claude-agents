import { EMPTY_PLAN, type PlanState } from '../utils/plan';
import { api, STANDALONE } from './api';

// Avec le serveur, le plan reste dans ce navigateur ; dans l'app autonome il est
// chiffré avec le reste des données.
const LS_KEY = 'finance-agent-plan';

export const planService = {
  async get(): Promise<PlanState> {
    if (STANDALONE) return api<PlanState>('/plan');
    try {
      return { ...EMPTY_PLAN, ...JSON.parse(localStorage.getItem(LS_KEY) ?? '{}') };
    } catch {
      return EMPTY_PLAN;
    }
  },
  async save(plan: PlanState): Promise<PlanState> {
    if (STANDALONE) return api<PlanState>('/plan', { method: 'PUT', json: plan });
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(plan));
    } catch {
      // stockage indisponible : le plan vaut pour la session
    }
    return plan;
  },
};
