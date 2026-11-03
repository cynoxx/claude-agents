import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BILL_CATEGORIES } from '../lib/categories.js';
import { config } from '../lib/config.js';
import { todayIn } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { budgetSummary } from '../services/budgetService.js';
import { runForUser } from '../services/notificationService.js';

const budgetBody = z.object({
  category: z.enum(BILL_CATEGORIES),
  limitAmount: z.coerce.number().positive().max(1_000_000_000),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});

function currentMonth() {
  const [year, month] = todayIn(config.tz).split('-').map(Number) as [number, number];
  return { year, month };
}

export async function budgetRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  // Budget du mois (par défaut le mois courant) avec les dépenses réelles
  app.get('/', async (req) => {
    const now = currentMonth();
    const q = z
      .object({ month: z.coerce.number().int().min(1).max(12).default(now.month), year: z.coerce.number().int().default(now.year) })
      .parse(req.query);
    return { month: q.month, year: q.year, lines: await budgetSummary(req.user.sub, q.year, q.month) };
  });

  // Crée ou remplace la limite d'une catégorie pour un mois
  app.post('/', async (req, reply) => {
    const body = budgetBody.parse(req.body);
    const budget = await prisma.budget.upsert({
      where: { userId_category_month_year: { userId: req.user.sub, category: body.category, month: body.month, year: body.year } },
      create: { ...body, userId: req.user.sub },
      update: { limitAmount: body.limitAmount },
    });
    await runForUser(req.user.sub, app.mailer).catch((e) => app.log.error(e));
    return reply.code(201).send({ ...budget, limitAmount: Number(budget.limitAmount) });
  });

  app.put('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { limitAmount } = budgetBody.pick({ limitAmount: true }).parse(req.body);
    const existing = await prisma.budget.findFirst({ where: { id, userId: req.user.sub } });
    if (!existing) return reply.code(404).send({ error: 'Budget introuvable' });
    const budget = await prisma.budget.update({ where: { id }, data: { limitAmount } });
    await runForUser(req.user.sub, app.mailer).catch((e) => app.log.error(e));
    return { ...budget, limitAmount: Number(budget.limitAmount) };
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { count } = await prisma.budget.deleteMany({ where: { id, userId: req.user.sub } });
    if (!count) return reply.code(404).send({ error: 'Budget introuvable' });
    return reply.code(204).send();
  });
}
