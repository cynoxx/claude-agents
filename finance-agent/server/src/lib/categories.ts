import type { BillCategory } from '@prisma/client';

export const BILL_CATEGORIES = [
  'HOUSING',
  'UTILITIES',
  'INTERNET',
  'INSURANCE',
  'TRANSPORT',
  'FOOD',
  'HEALTH',
  'ENTERTAINMENT',
  'SUBSCRIPTION',
  'OTHER',
] as const satisfies readonly BillCategory[];

// Fournisseurs courants en France. Les motifs sont cherchés dans le nom du
// fournisseur normalisé (minuscules, sans accents). Ajoutez vos fournisseurs ici.
const PROVIDER_RULES: Array<{ category: BillCategory; patterns: string[] }> = [
  {
    category: 'UTILITIES',
    patterns: ['edf', 'engie', 'totalenergies', 'total energies', 'eni', 'ekwateur', 'veolia', 'suez', 'saur', 'gaz', 'eau', 'electricite', 'enedis', 'grdf'],
  },
  {
    category: 'INTERNET',
    patterns: ['orange', 'sfr', 'free', 'bouygues', 'sosh', 'red by sfr', 'b&you', 'internet', 'fibre', 'telephone', 'mobile'],
  },
  {
    category: 'INSURANCE',
    patterns: ['axa', 'maif', 'macif', 'matmut', 'groupama', 'allianz', 'generali', 'gmf', 'maaf', 'mma', 'direct assurance', 'assurance', 'mutuelle'],
  },
  {
    category: 'SUBSCRIPTION',
    patterns: ['netflix', 'spotify', 'deezer', 'disney', 'canal+', 'canal plus', 'amazon prime', 'prime video', 'apple', 'youtube', 'abonnement', 'icloud', 'google one'],
  },
  {
    category: 'HOUSING',
    patterns: ['loyer', 'syndic', 'foncia', 'nexity', 'citya', 'charges', 'copropriete', 'taxe fonciere', 'credit immobilier'],
  },
  {
    category: 'TRANSPORT',
    patterns: ['sncf', 'ratp', 'navigo', 'total', 'shell', 'esso', 'bp ', 'vinci', 'sanef', 'aprr', 'peage', 'carburant', 'uber', 'blablacar'],
  },
  {
    category: 'FOOD',
    patterns: ['carrefour', 'leclerc', 'auchan', 'intermarche', 'lidl', 'monoprix', 'franprix', 'casino', 'super u', 'picard', 'deliveroo', 'uber eats'],
  },
  {
    category: 'HEALTH',
    patterns: ['pharmacie', 'medecin', 'docteur', 'dentiste', 'hopital', 'clinique', 'doctolib', 'ameli', 'opticien'],
  },
  {
    category: 'ENTERTAINMENT',
    patterns: ['fnac', 'cinema', 'ugc', 'pathe', 'gaumont', 'steam', 'playstation', 'nintendo', 'xbox', 'concert', 'salle de sport', 'basic fit'],
  },
];

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function matches(name: string, pattern: string): boolean {
  // Les motifs courts (edf, sfr, eau...) doivent correspondre à un mot entier
  if (pattern.length <= 4) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').trim();
    return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(name);
  }
  return name.includes(pattern);
}

/** Devine la catégorie d'une facture à partir du nom du fournisseur. */
export function categorizeProvider(companyName: string): BillCategory {
  const name = normalize(companyName);
  if (!name) return 'OTHER';
  // "uber eats" doit l'emporter sur "uber" : on teste les motifs les plus longs d'abord
  const candidates = PROVIDER_RULES.flatMap((rule) => rule.patterns.map((p) => ({ p, category: rule.category }))).sort(
    (a, b) => b.p.length - a.p.length,
  );
  for (const { p, category } of candidates) {
    if (matches(name, p)) return category;
  }
  return 'OTHER';
}
