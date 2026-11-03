// Programme « gagner plus, dépenser moins » : aides à demander, pistes de revenus,
// objectif d'épargne et calculs tirés des factures. Contenu pensé pour un étudiant en
// Corse ; les montants exacts dépendent de la situation, d'où les liens officiels.
import type { Bill, BillCategory, Recurrence } from '../types';

export type AidStatus = 'TODO' | 'ASKED' | 'GRANTED' | 'NOT_ELIGIBLE';

export interface PlanState {
  /** Somme à mettre de côté chaque mois */
  savingsGoal: number | null;
  aids: Record<string, AidStatus>;
  ideas: Record<string, boolean>;
  /** Factures récurrentes que l'on compte résilier */
  toCancel: Record<string, boolean>;
}

export const EMPTY_PLAN: PlanState = { savingsGoal: null, aids: {}, ideas: {}, toCancel: {} };

export const AID_STATUS: Record<AidStatus, string> = {
  TODO: 'À vérifier',
  ASKED: 'Demandée',
  GRANTED: 'Obtenue',
  NOT_ELIGIBLE: 'Pas pour moi',
};

export interface Aid {
  id: string;
  title: string;
  description: string;
  url: string;
  /** Rentrée récurrente une fois obtenue */
  recurring: boolean;
}

export const AIDS: Aid[] = [
  {
    id: 'simulateur',
    title: 'Faire le test de tes droits',
    description: 'Le simulateur officiel liste en une dizaine de minutes toutes les aides auxquelles tu peux prétendre. À faire en premier.',
    url: 'https://www.mesdroitssociaux.gouv.fr',
    recurring: false,
  },
  {
    id: 'bourse',
    title: 'Bourse sur critères sociaux',
    description: 'Versée chaque mois pendant l’année universitaire. Le dossier social étudiant se refait chaque printemps pour l’année suivante.',
    url: 'https://messervices.etudiant.gouv.fr',
    recurring: true,
  },
  {
    id: 'logement',
    title: 'Aide au logement de la CAF',
    description: 'Si tu paies un loyer, résidence Crous comprise, la CAF peut en prendre une partie en charge chaque mois.',
    url: 'https://www.caf.fr',
    recurring: true,
  },
  {
    id: 'repas',
    title: 'Repas Crous à 1 €',
    description: 'Les étudiants boursiers, et ceux en difficulté, mangent au restaurant universitaire pour 1 € le repas.',
    url: 'https://www.etudiant.gouv.fr',
    recurring: false,
  },
  {
    id: 'urgence',
    title: 'Aide ponctuelle du Crous',
    description: 'En cas de coup dur (dépense imprévue, baisse de ressources), le service social du Crous peut accorder une aide d’urgence.',
    url: 'https://www.etudiant.gouv.fr',
    recurring: false,
  },
  {
    id: 'css',
    title: 'Complémentaire santé solidaire',
    description: 'Une mutuelle gratuite ou à petit prix selon tes ressources : consultations, pharmacie et lunettes mieux remboursées.',
    url: 'https://www.ameli.fr',
    recurring: false,
  },
  {
    id: 'prime',
    title: 'Prime d’activité',
    description: 'Si tu as un job étudiant qui rapporte assez chaque mois, la CAF peut ajouter un complément. Son simulateur te dit si tu y as droit.',
    url: 'https://www.caf.fr',
    recurring: true,
  },
  {
    id: 'transport',
    title: 'Tarif résident pour les trajets vers le continent',
    description: 'Les résidents de Corse paient moins cher certains vols et traversées : demande le tarif résident en réservant, avec un justificatif de domicile.',
    url: 'https://www.aircorsica.com',
    recurring: false,
  },
];

export interface Idea {
  id: string;
  title: string;
  description: string;
  kind: 'earn' | 'save';
}

export const IDEAS: Idea[] = [
  { id: 'vinted', kind: 'earn', title: 'Vendre ce qui ne sert plus', description: 'Vêtements, jeux, matériel : ton échiquier a déjà plusieurs favoris sur Vinted, une petite baisse de prix aux intéressés peut le faire partir.' },
  { id: 'job', kind: 'earn', title: 'Un job de quelques heures par semaine', description: 'Le Crous publie des offres compatibles avec les cours sur Jobaviz, y compris sur le campus.' },
  { id: 'cours', kind: 'earn', title: 'Donner des cours particuliers', description: 'Soutien scolaire en sciences pour collégiens et lycéens : bien payé à l’heure, et ça révise les bases.' },
  { id: 'livret', kind: 'earn', title: 'Placer l’épargne sur un livret A', description: 'L’argent mis de côté rapporte un peu au lieu de dormir, et reste disponible à tout moment.' },
  { id: 'abonnements', kind: 'save', title: 'Faire le tri dans les abonnements', description: 'Coche ci-dessous ceux que tu peux résilier : l’économie sur un an s’affiche tout de suite.' },
  { id: 'courses', kind: 'save', title: 'Courses avec une liste et un budget', description: 'Fixer un budget Alimentation dans la page Budget : l’app te prévient à 80 % puis à 100 %.' },
  { id: 'livraison', kind: 'save', title: 'Moins de livraisons de repas', description: 'Un repas livré coûte souvent le prix de plusieurs repas au restaurant universitaire.' },
  { id: 'codes', kind: 'save', title: 'Réductions étudiantes avant chaque achat', description: 'Beaucoup de marques ont un tarif étudiant (Spotify, Apple, logiciels, transports) : vérifier avant de payer plein pot.' },
  { id: 'attente', kind: 'save', title: 'La règle des 48 heures', description: 'Pour tout achat non prévu de plus de 30 €, attendre deux jours avant de valider. La moitié des envies passent.' },
];

const PER_YEAR: Record<Recurrence, number> = { NONE: 0, MONTHLY: 12, QUARTERLY: 4, YEARLY: 1 };
const round = (n: number) => Math.round(n * 100) / 100;

/** Coût mensuel moyen d'une facture récurrente. */
export const monthlyCost = (b: Pick<Bill, 'amount' | 'recurrence'>) => round((b.amount * PER_YEAR[b.recurrence]) / 12);

/**
 * Factures récurrentes encore actives : pour chaque série (même fournisseur, même
 * périodicité), la plus récente.
 */
export function recurringBills(bills: Bill[]): Bill[] {
  const latest = new Map<string, Bill>();
  for (const b of bills) {
    if (b.recurrence === 'NONE') continue;
    const key = `${b.provider.toLowerCase()}|${b.recurrence}`;
    const cur = latest.get(key);
    if (!cur || b.dueDate > cur.dueDate) latest.set(key, b);
  }
  return [...latest.values()].sort((a, b) => monthlyCost(b) - monthlyCost(a));
}

export interface CategoryDrift {
  category: BillCategory;
  current: number;
  /** Moyenne des mois précédents */
  average: number;
}

/** Dépenses du mois par catégorie, comparées à la moyenne des `months` mois précédents. */
export function categoryDrift(bills: Bill[], month: string, previous: string[]): CategoryDrift[] {
  const sum = (cat: BillCategory, m: string) => bills.filter((b) => b.category === cat && b.dueDate.startsWith(m)).reduce((t, b) => t + b.amount, 0);
  const cats = [...new Set(bills.map((b) => b.category))];
  return cats
    .map((category) => ({
      category,
      current: round(sum(category, month)),
      average: previous.length ? round(previous.reduce((t, m) => t + sum(category, m), 0) / previous.length) : 0,
    }))
    .filter((d) => d.current > 0 || d.average > 0)
    .sort((a, b) => b.current - a.current);
}
