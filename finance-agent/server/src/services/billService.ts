import type { Bill, Recurrence } from '@prisma/client';
import { addMonths, toDateString, fromDateString } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';

const MONTHS_BY_RECURRENCE: Record<Recurrence, number> = { NONE: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

export function nextDueDate(dueDate: string, recurrence: Recurrence): string | null {
  const months = MONTHS_BY_RECURRENCE[recurrence];
  return months ? addMonths(dueDate, months) : null;
}

/** Sérialisation JSON : montants en nombre, dates en YYYY-MM-DD. */
export function serializeBill(b: Bill) {
  return {
    ...b,
    amount: Number(b.amount),
    dueDate: toDateString(b.dueDate),
    paidDate: b.paidDate ? toDateString(b.paidDate) : null,
  };
}

/**
 * Marque une facture comme payée. Pour une facture récurrente, crée l'échéance suivante
 * (si elle n'existe pas déjà) avec le même montant, à ajuster ensuite si besoin.
 */
export async function payBill(bill: Bill, paidDate: string) {
  return prisma.$transaction(async (tx) => {
    const updated = await tx.bill.update({ where: { id: bill.id }, data: { paid: true, paidDate: fromDateString(paidDate) } });
    let next: Bill | null = null;
    const nextDate = nextDueDate(toDateString(bill.dueDate), bill.recurrence);
    if (nextDate && !bill.paid) {
      const exists = await tx.bill.findFirst({
        where: { userId: bill.userId, provider: bill.provider, title: bill.title, dueDate: fromDateString(nextDate) },
      });
      if (!exists) {
        next = await tx.bill.create({
          data: {
            userId: bill.userId,
            title: bill.title,
            amount: bill.amount,
            dueDate: fromDateString(nextDate),
            category: bill.category,
            provider: bill.provider,
            reference: bill.reference,
            recurrence: bill.recurrence,
          },
        });
      }
    }
    return { bill: updated, next };
  });
}
