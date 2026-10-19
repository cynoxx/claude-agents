// Factures trouvées dans les mails par le tri du matin (tâche programmée du chef
// d'orchestre). Elle les dépose, non chiffrées, dans data/users/<id>/finance/inbox ;
// à l'ouverture du coffre, on les range dans l'état chiffré puis on vide la boîte.
import type { Bill, BillCategory, Recurrence } from '../types';
import { BILL_CATEGORIES, categorizeProvider } from './categories';
import type { Backend, State } from './storage';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RECURRENCES: Recurrence[] = ['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY'];
const MAX_REMEMBERED = 500;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Une facture valable, ou null si le dépôt est incomplet (il reste alors dans la boîte). */
export function billFromInbox(mailId: string, d: Record<string, unknown>, now = new Date().toISOString()): Bill | null {
  const title = text(d.title);
  const provider = text(d.provider) || title;
  const amount = typeof d.amount === 'number' ? Math.round(d.amount * 100) / 100 : NaN;
  const dueDate = text(d.dueDate, 10);
  if (!title || !Number.isFinite(amount) || amount < 0 || !DATE_RE.test(dueDate)) return null;
  const category = BILL_CATEGORIES.includes(d.category as BillCategory) ? (d.category as BillCategory) : categorizeProvider(provider);
  const recurrence = RECURRENCES.includes(d.recurrence as Recurrence) ? (d.recurrence as Recurrence) : 'NONE';
  const paid = d.paid === true;
  const mailUrl = text(d.mailUrl, 500);
  return {
    id: `mail-${mailId}`,
    title,
    provider,
    amount,
    dueDate,
    category,
    recurrence,
    paid,
    paidDate: paid ? (DATE_RE.test(text(d.paidDate, 10)) ? text(d.paidDate, 10) : dueDate) : null,
    reference: text(d.reference, 100) || null,
    documentUrl: /^https:\/\//.test(mailUrl) ? mailUrl : null,
    attachment: null,
    notes: ['Ajoutée automatiquement depuis tes mails.', text(d.note, 300)].filter(Boolean).join(' '),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Range dans l'état les factures déposées, sans doublon. Renvoie le nombre ajouté et
 * les dépôts à retirer de la boîte, une fois le coffre enregistré par l'appelant.
 */
export async function importMailInbox(state: State, backend: Backend): Promise<{ added: number; done: string[] }> {
  let items;
  try {
    items = await backend.listInbox();
  } catch (e) {
    console.error('[factures des mails]', e);
    return { added: 0, done: [] };
  }
  const seen = new Set(state.importedMail ?? []);
  const toRemove: string[] = [];
  let added = 0;
  for (const { id, data } of items) {
    if (seen.has(id) || state.bills.some((b) => b.id === `mail-${id}`)) {
      toRemove.push(id);
      continue;
    }
    const bill = billFromInbox(id, data);
    if (!bill) continue;
    state.bills.push(bill);
    seen.add(id);
    toRemove.push(id);
    added++;
    state.notifications.unshift({
      id: `mail-${id}`,
      title: `Facture ajoutée depuis tes mails : ${bill.title}`,
      message: `${bill.provider}, ${eur.format(bill.amount)}, ${bill.paid ? 'déjà payée' : `à payer le ${new Date(`${bill.dueDate}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' })}`}. Vérifie-la dans Factures.`,
      type: 'BILL_REMINDER',
      dueDate: bill.dueDate,
      billId: bill.id,
      isRead: false,
      createdAt: new Date().toISOString(),
      dedupKey: `mail:${id}`,
    });
  }
  state.importedMail = [...seen].slice(-MAX_REMEMBERED);
  return { added, done: toRemove };
}
