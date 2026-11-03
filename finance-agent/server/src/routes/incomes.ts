import type { Income } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { monthlyBalance, monthsEndingAt } from '../lib/balance.js';
import { config } from '../lib/config.js';
import { fromDateString, todayIn, toDateString } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';

export const INCOME_CATEGORIES = ['SALARY', 'FREELANCE', 'BENEFITS', 'RENTAL', 'INVESTMENT', 'GIFT', 'OTHER'] as const;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date attendue au format AAAA-MM-JJ');
const incomeBody = z
  .object({
    label: z.string().trim().min(1, 'Intitulé requis').max(200),
    source: z.string().trim().max(200).nullish(),
    amount: z.coerce.number().positive('Le montant doit être positif').max(1_000_000_000),
    date,
    endDate: date.nullish(),
    recurrence: z.enum(['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY']).default('NONE'),
    category: z.enum(INCOME_CATEGORIES).default('OTHER'),
    notes: z.string().max(2000).nullish(),
  })
  .refine((b) => !b.endDate || b.endDate >= b.date, { message: 'La date de fin doit suivre la date de début', path: ['endDate'] });

export function serializeIncome(i: Income) {
  return {
    ...i,
    amount: Number(i.amount),
    date: toDateString(i.date),
    endDate: i.endDate ? toDateString(i.endDate) : null,
  };
}

export async function incomeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const incomes = await prisma.income.findMany({ where: { userId: req.user.sub }, orderBy: { date: 'desc' } });
    return incomes.map(serializeIncome);
  });

  app.post('/', async (req, reply) => {
    const b = incomeBody.parse(req.body);
    const income = await prisma.income.create({
      data: { ...b, userId: req.user.sub, date: fromDateString(b.date), endDate: b.endDate ? fromDateString(b.endDate) : null },
    });
    return reply.code(201).send(serializeIncome(income));
  });

  app.put('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = incomeBody.parse(req.body);
    const existing = await prisma.income.findFirst({ where: { id, userId: req.user.sub } });
    if (!existing) return reply.code(404).send({ error: 'Rentrée introuvable' });
    const income = await prisma.income.update({
      where: { id },
      data: { ...b, date: fromDateString(b.date), endDate: b.endDate ? fromDateString(b.endDate) : null },
    });
    return serializeIncome(income);
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { count } = await prisma.income.deleteMany({ where: { id, userId: req.user.sub } });
    if (!count) return reply.code(404).send({ error: 'Rentrée introuvable' });
    return reply.code(204).send();
  });

  // Bilan des N derniers mois (mois courant inclus) : rentrées, factures, solde
  app.get('/balance', async (req) => {
    const { months: count } = z.object({ months: z.coerce.number().int().min(1).max(24).default(6) }).parse(req.query);
    const months = monthsEndingAt(todayIn(config.tz).slice(0, 7), count);
    const start = fromDateString(`${months[0]}-01`);
    const [incomes, bills] = await Promise.all([
      prisma.income.findMany({ where: { userId: req.user.sub } }),
      prisma.bill.findMany({ where: { userId: req.user.sub, dueDate: { gte: start } }, select: { amount: true, dueDate: true } }),
    ]);
    return monthlyBalance(
      incomes.map(serializeIncome),
      bills.map((b) => ({ amount: Number(b.amount), dueDate: toDateString(b.dueDate) })),
      months,
    );
  });
}
