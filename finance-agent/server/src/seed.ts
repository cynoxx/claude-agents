// Données de démonstration : `npm run seed` (compte demo@example.com / demo12345)
import bcrypt from 'bcryptjs';
import { categorizeProvider } from './lib/categories.js';
import { config } from './lib/config.js';
import { addDays, addMonths, fromDateString, todayIn } from './lib/dates.js';
import { prisma } from './lib/prisma.js';
import { createMailer } from './services/mailer.js';
import { runForUser } from './services/notificationService.js';

const today = todayIn(config.tz);
const email = 'demo@example.com';

await prisma.user.deleteMany({ where: { email } });
const user = await prisma.user.create({ data: { email, name: 'Démo', passwordHash: await bcrypt.hash('demo12345', 12) } });

const recurring: Array<[string, string, number, number]> = [
  ['Loyer', 'Foncia', 850, 5],
  ['Électricité', 'EDF', 78.4, 12],
  ['Box internet', 'Free', 39.99, 16],
  ['Forfait mobile', 'Sosh', 15.99, 20],
  ['Assurance habitation', 'MAIF', 24.5, 8],
  ['Netflix', 'Netflix', 13.49, 22],
  ['Spotify', 'Spotify', 11.12, 25],
];

const [y, m] = today.split('-').map(Number) as [number, number];
for (let back = 5; back >= 0; back--) {
  for (const [title, provider, amount, day] of recurring) {
    const due = addMonths(`${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, -back);
    const paid = due < today;
    await prisma.bill.create({
      data: {
        userId: user.id,
        title,
        provider,
        amount: Math.round(amount * (1 + (Math.random() - 0.5) * (title === 'Électricité' ? 0.4 : 0)) * 100) / 100,
        dueDate: fromDateString(due),
        category: categorizeProvider(provider),
        recurrence: 'MONTHLY',
        paid,
        paidDate: paid ? fromDateString(due) : null,
      },
    });
  }
}
// Une facture en retard et une échéance proche
await prisma.bill.create({ data: { userId: user.id, title: 'Facture gaz', provider: 'Engie', amount: 96.3, dueDate: fromDateString(addDays(today, -2)), category: 'UTILITIES' } });
await prisma.bill.create({ data: { userId: user.id, title: 'Assurance auto', provider: 'Direct Assurance', amount: 312, dueDate: fromDateString(addDays(today, 2)), category: 'INSURANCE', recurrence: 'YEARLY' } });

for (const [category, limitAmount] of [['SUBSCRIPTION', 25], ['UTILITIES', 250], ['INTERNET', 60], ['HOUSING', 900]] as const) {
  await prisma.budget.create({ data: { userId: user.id, category, limitAmount, month: m, year: y } });
}

const r = await runForUser(user.id, createMailer());
console.log(`Compte ${email} / demo12345 créé (${r.reminders} rappels, ${r.budgetAlerts} alertes budget)`);
await prisma.$disconnect();
