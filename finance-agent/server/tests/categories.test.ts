import { describe, expect, it } from 'vitest';
import { categorizeProvider } from '../src/lib/categories.js';

describe('categorizeProvider', () => {
  it.each([
    ['EDF', 'UTILITIES'],
    ['Engie Home', 'UTILITIES'],
    ['Veolia Eau', 'UTILITIES'],
    ['Orange', 'INTERNET'],
    ['SFR Fibre', 'INTERNET'],
    ['Free Mobile', 'INTERNET'],
    ['AXA Assurances', 'INSURANCE'],
    ['MAIF', 'INSURANCE'],
    ['Netflix', 'SUBSCRIPTION'],
    ['Spotify AB', 'SUBSCRIPTION'],
    ['Loyer appartement', 'HOUSING'],
    ['TotalEnergies', 'UTILITIES'],
    ['Uber Eats', 'FOOD'],
    ['Uber', 'TRANSPORT'],
    ['Pharmacie du centre', 'HEALTH'],
    ['Électricité de Strasbourg', 'UTILITIES'],
  ])('%s → %s', (provider, expected) => {
    expect(categorizeProvider(provider)).toBe(expected);
  });

  it('ne confond pas les motifs courts avec des sous-chaînes', () => {
    // "free" ne doit pas matcher "freelance", ni "edf" dans "redford"
    expect(categorizeProvider('Freelance Compta')).toBe('OTHER');
    expect(categorizeProvider('Redford Consulting')).toBe('OTHER');
  });

  it('retourne OTHER par défaut', () => {
    expect(categorizeProvider('')).toBe('OTHER');
    expect(categorizeProvider('Fournisseur inconnu')).toBe('OTHER');
  });
});
