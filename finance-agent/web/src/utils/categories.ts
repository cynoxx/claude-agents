import type { BillCategory, Recurrence } from '../types';

// Palette catégorielle validée (daltonisme, contraste) ; la couleur accompagne toujours le libellé
export const CATEGORIES: Record<BillCategory, { label: string; color: string; icon: string }> = {
  HOUSING: { label: 'Logement', color: '#2a78d6', icon: '🏠' },
  UTILITIES: { label: 'Énergie et eau', color: '#eb6834', icon: '⚡' },
  INTERNET: { label: 'Internet et téléphone', color: '#6250d6', icon: '📶' },
  INSURANCE: { label: 'Assurances', color: '#1baf7a', icon: '🛡️' },
  TRANSPORT: { label: 'Transport', color: '#eda100', icon: '🚗' },
  FOOD: { label: 'Alimentation', color: '#008300', icon: '🛒' },
  HEALTH: { label: 'Santé', color: '#e34948', icon: '🩺' },
  ENTERTAINMENT: { label: 'Loisirs', color: '#e87ba4', icon: '🎭' },
  SUBSCRIPTION: { label: 'Abonnements', color: '#1c5cab', icon: '🔁' },
  OTHER: { label: 'Autres', color: '#8a8a85', icon: '📄' },
};

export const CATEGORY_KEYS = Object.keys(CATEGORIES) as BillCategory[];

export const RECURRENCES: Record<Recurrence, string> = {
  NONE: 'Ponctuelle',
  MONTHLY: 'Mensuelle',
  QUARTERLY: 'Trimestrielle',
  YEARLY: 'Annuelle',
};
