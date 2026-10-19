import type { Bill, Prisma, User } from '@prisma/client';
import { config } from '../lib/config.js';
import { daysBetween, todayIn, toDateString } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import type { Mailer } from './mailer.js';
import { budgetSummary } from './budgetService.js';

export interface ReminderPlan {
  /** Seuil atteint (7, 3, 0...) ou "overdue" si l'échéance est dépassée. */
  stage: number | 'overdue';
  daysUntil: number;
}

/**
 * Détermine quel rappel doit exister pour une facture non payée.
 * On prend le plus petit seuil déjà atteint : si le serveur était éteint le jour J-7,
 * le rappel est quand même créé à J-5 (et celui de J-3 suivra).
 */
export function planReminder(dueDate: string, today: string, reminderDays: number[]): ReminderPlan | null {
  const daysUntil = daysBetween(today, dueDate);
  if (daysUntil < 0) return { stage: 'overdue', daysUntil };
  const reached = reminderDays.filter((d) => d >= 0 && daysUntil <= d).sort((a, b) => a - b);
  if (reached.length === 0) return null;
  return { stage: reached[0]!, daysUntil };
}

const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

export function reminderText(bill: Pick<Bill, 'title' | 'provider' | 'amount'>, plan: ReminderPlan, dueDate: string) {
  const amount = eur.format(Number(bill.amount));
  const date = new Date(`${dueDate}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  const label = `${bill.title} (${bill.provider}, ${amount})`;
  if (plan.stage === 'overdue') {
    const n = -plan.daysUntil;
    return { title: `Facture en retard : ${bill.title}`, message: `${label} était à payer le ${date}, il y a ${n} jour${n > 1 ? 's' : ''}.` };
  }
  if (plan.daysUntil === 0) {
    return { title: `À payer aujourd'hui : ${bill.title}`, message: `${label} est à payer aujourd'hui.` };
  }
  const n = plan.daysUntil;
  return { title: `Échéance dans ${n} jour${n > 1 ? 's' : ''} : ${bill.title}`, message: `${label} est à payer le ${date}.` };
}

type NotifyUser = Pick<User, 'id' | 'email' | 'notifyEmail'>;

async function createOnce(
  user: NotifyUser,
  data: Omit<Prisma.NotificationUncheckedCreateInput, 'userId'> & { dedupKey: string },
  mailer: Mailer,
): Promise<boolean> {
  try {
    await prisma.notification.create({ data: { ...data, userId: user.id } });
  } catch (e) {
    // Violation d'unicité : le rappel existe déjà
    if ((e as { code?: string }).code === 'P2002') return false;
    throw e;
  }
  if (user.notifyEmail) {
    await mailer.send(user.email, data.title, data.message).catch((err) => console.error('[email] échec', err));
  }
  return true;
}

/** Crée les rappels de factures dus pour un utilisateur. Retourne le nombre créé. */
export async function generateBillReminders(userId: string, mailer: Mailer, now = new Date()): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const today = todayIn(config.tz, now);
  const maxDays = Math.max(0, ...user.billReminderDays);
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + maxDays);

  const bills = await prisma.bill.findMany({ where: { userId, paid: false, dueDate: { lte: horizon } } });
  let created = 0;
  for (const bill of bills) {
    const due = toDateString(bill.dueDate);
    const plan = planReminder(due, today, user.billReminderDays);
    if (!plan) continue;
    const { title, message } = reminderText(bill, plan, due);
    const ok = await createOnce(
      user,
      {
        title,
        message,
        type: 'BILL_REMINDER',
        dueDate: bill.dueDate,
        billId: bill.id,
        dedupKey: `bill:${bill.id}:${due}:${plan.stage}`,
      },
      mailer,
    );
    if (ok) created++;
  }
  return created;
}

const CATEGORY_LABELS: Record<string, string> = {
  HOUSING: 'Logement',
  UTILITIES: 'Énergie et eau',
  INTERNET: 'Internet et téléphone',
  INSURANCE: 'Assurances',
  TRANSPORT: 'Transport',
  FOOD: 'Alimentation',
  HEALTH: 'Santé',
  ENTERTAINMENT: 'Loisirs',
  SUBSCRIPTION: 'Abonnements',
  OTHER: 'Autres',
};

/** Alerte quand une catégorie dépasse le seuil (80 % par défaut) puis 100 % du budget du mois. */
export async function generateBudgetAlerts(userId: string, mailer: Mailer, now = new Date()): Promise<number> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const [year, month] = todayIn(config.tz, now).split('-').map(Number) as [number, number];
  const summary = await budgetSummary(userId, year, month);
  let created = 0;
  for (const line of summary) {
    if (line.limit <= 0) continue;
    const level = line.percentageUsed >= 100 ? 100 : line.percentageUsed >= user.budgetWarningThreshold ? user.budgetWarningThreshold : null;
    if (level === null) continue;
    const label = CATEGORY_LABELS[line.category] ?? line.category;
    const over = level === 100;
    const ok = await createOnce(
      user,
      {
        title: over ? `Budget dépassé : ${label}` : `Budget bientôt atteint : ${label}`,
        message: `${label} : ${eur.format(line.spent)} sur ${eur.format(line.limit)} (${Math.round(line.percentageUsed)} %) ce mois-ci.`,
        type: 'BUDGET_ALERT',
        dueDate: null,
        dedupKey: `budget:${userId}:${line.category}:${year}-${month}:${level}`,
      },
      mailer,
    );
    if (ok) created++;
  }
  return created;
}

export async function runForUser(userId: string, mailer: Mailer, now = new Date()) {
  const reminders = await generateBillReminders(userId, mailer, now);
  const budgetAlerts = await generateBudgetAlerts(userId, mailer, now);
  return { reminders, budgetAlerts };
}

export async function runForAllUsers(mailer: Mailer, now = new Date()) {
  const users = await prisma.user.findMany({ select: { id: true } });
  let total = 0;
  for (const u of users) {
    const r = await runForUser(u.id, mailer, now);
    total += r.reminders + r.budgetAlerts;
  }
  return total;
}

/** Lance le planificateur : au démarrage puis à intervalle régulier. */
export function startScheduler(mailer: Mailer, log: (msg: string) => void): () => void {
  const tick = () =>
    runForAllUsers(mailer)
      .then((n) => n > 0 && log(`[rappels] ${n} notification(s) créée(s)`))
      .catch((e) => console.error('[rappels] erreur', e));
  void tick();
  const timer = setInterval(tick, config.reminderIntervalMinutes * 60_000);
  return () => clearInterval(timer);
}

