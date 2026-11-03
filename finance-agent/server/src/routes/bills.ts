import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { BILL_CATEGORIES, categorizeProvider } from '../lib/categories.js';
import { config } from '../lib/config.js';
import { fromDateString, todayIn } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { payBill, serializeBill } from '../services/billService.js';
import { runForUser } from '../services/notificationService.js';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ');

const billBody = z.object({
  title: z.string().trim().min(1).max(200),
  amount: z.coerce.number().nonnegative().max(1_000_000_000),
  dueDate: dateStr,
  category: z.enum(BILL_CATEGORIES).optional(),
  provider: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200).nullish(),
  documentUrl: z.string().trim().url().max(2000).nullish(),
  notes: z.string().max(5000).nullish(),
  recurrence: z.enum(['NONE', 'MONTHLY', 'QUARTERLY', 'YEARLY']).optional(),
  paid: z.boolean().optional(),
  paidDate: dateStr.nullish(),
});

const listQuery = z.object({
  status: z.enum(['all', 'paid', 'unpaid', 'overdue']).default('all'),
  category: z.enum(BILL_CATEGORIES).optional(),
  from: dateStr.optional(),
  to: dateStr.optional(),
  q: z.string().trim().max(200).optional(),
  sort: z.enum(['dueDate', 'amount', 'provider', 'title', 'createdAt']).default('dueDate'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

const idParam = z.object({ id: z.string().min(1) });

export async function billRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const findOwned = async (userId: string, id: string) => {
    const bill = await prisma.bill.findFirst({ where: { id, userId } });
    if (!bill) throw Object.assign(new Error('Facture introuvable'), { statusCode: 404 });
    return bill;
  };

  // Recalcule les rappels après une modification, sans bloquer la réponse en cas d'erreur
  const refreshReminders = (userId: string) =>
    runForUser(userId, app.mailer).catch((e) => app.log.error(e, 'rappels'));

  app.get('/', async (req) => {
    const q = listQuery.parse(req.query);
    const today = fromDateString(todayIn(config.tz));
    const where: Prisma.BillWhereInput = { userId: req.user.sub };
    if (q.status === 'paid') where.paid = true;
    if (q.status === 'unpaid') where.paid = false;
    if (q.status === 'overdue') Object.assign(where, { paid: false, dueDate: { lt: today } });
    if (q.category) where.category = q.category;
    if (q.from || q.to) {
      where.dueDate = {
        ...(where.dueDate as object | undefined),
        ...(q.from && { gte: fromDateString(q.from) }),
        ...(q.to && { lte: fromDateString(q.to) }),
      };
    }
    if (q.q) {
      where.OR = [
        { provider: { contains: q.q, mode: 'insensitive' } },
        { title: { contains: q.q, mode: 'insensitive' } },
        { reference: { contains: q.q, mode: 'insensitive' } },
      ];
    }
    const bills = await prisma.bill.findMany({ where, orderBy: [{ [q.sort]: q.order }, { id: 'asc' }] });
    return bills.map(serializeBill);
  });

  app.get('/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    return serializeBill(await findOwned(req.user.sub, id));
  });

  app.post('/', async (req, reply) => {
    const body = billBody.parse(req.body);
    const bill = await prisma.bill.create({
      data: {
        userId: req.user.sub,
        title: body.title,
        amount: body.amount,
        dueDate: fromDateString(body.dueDate),
        category: body.category ?? categorizeProvider(body.provider),
        provider: body.provider,
        reference: body.reference ?? null,
        documentUrl: body.documentUrl ?? null,
        notes: body.notes ?? null,
        recurrence: body.recurrence ?? 'NONE',
        paid: body.paid ?? false,
        paidDate: body.paid ? fromDateString(body.paidDate ?? todayIn(config.tz)) : null,
      },
    });
    await refreshReminders(req.user.sub);
    return reply.code(201).send(serializeBill(bill));
  });

  app.put('/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    await findOwned(req.user.sub, id);
    const body = billBody.partial().parse(req.body);
    const data: Prisma.BillUpdateInput = {
      ...body,
      dueDate: body.dueDate ? fromDateString(body.dueDate) : undefined,
      paidDate: body.paidDate === undefined ? undefined : body.paidDate ? fromDateString(body.paidDate) : null,
    };
    if (body.paid === false) data.paidDate = null;
    if (body.paid === true && !body.paidDate) data.paidDate = fromDateString(todayIn(config.tz));
    const bill = await prisma.bill.update({ where: { id }, data });
    await refreshReminders(req.user.sub);
    return serializeBill(bill);
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await findOwned(req.user.sub, id);
    await prisma.bill.delete({ where: { id } });
    return reply.code(204).send();
  });

  app.patch('/:id/pay', async (req) => {
    const { id } = idParam.parse(req.params);
    const { paidDate } = z.object({ paidDate: dateStr.optional() }).parse(req.body ?? {});
    const bill = await findOwned(req.user.sub, id);
    const result = await payBill(bill, paidDate ?? todayIn(config.tz));
    await refreshReminders(req.user.sub);
    return { bill: serializeBill(result.bill), next: result.next ? serializeBill(result.next) : null };
  });
}
