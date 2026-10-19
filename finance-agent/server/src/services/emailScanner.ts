import type { BillCategory } from '@prisma/client';
import { categorizeProvider } from '../lib/categories.js';

/** Facture détectée dans un email, avant validation par l'utilisateur. */
export interface DetectedBill {
  title: string;
  provider: string;
  amount: number;
  dueDate: string | null;
  category: BillCategory;
  reference: string | null;
  sourceMessageId?: string;
}

/**
 * Contrat du scanner d'emails (priorité 6 de la spec).
 * L'implémentation branchée sur la boîte mail (Gmail API ou IMAP) arrivera dans une
 * prochaine livraison : elle nécessite l'accès à la messagerie de l'utilisateur.
 */
export interface EmailScanner {
  scanForBills(): Promise<DetectedBill[]>;
  extractBillInfo(email: string): DetectedBill | null;
  categorizeProvider(companyName: string): BillCategory;
}

export class NotConfiguredEmailScanner implements EmailScanner {
  async scanForBills(): Promise<DetectedBill[]> {
    throw Object.assign(new Error("Le scanner d'emails n'est pas encore connecté à une boîte mail"), { statusCode: 501 });
  }
  extractBillInfo(): DetectedBill | null {
    return null;
  }
  categorizeProvider(companyName: string): BillCategory {
    return categorizeProvider(companyName);
  }
}
