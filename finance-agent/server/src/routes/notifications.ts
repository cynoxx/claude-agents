import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { toDateString } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const q = z.object({ unread: z.enum(['true', 'false']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }).parse(req.query);
    const items = await prisma.notification.findMany({
      where: { userId: req.user.sub, ...(q.unread === 'true' && { isRead: false }) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    const unreadCount = await prisma.notification.count({ where: { userId: req.user.sub, isRead: false } });
    return { items: items.map((n) => ({ ...n, dueDate: n.dueDate ? toDateString(n.dueDate) : null })), unreadCount };
  });

  app.patch('/:id/read', async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { count } = await prisma.notification.updateMany({ where: { id, userId: req.user.sub }, data: { isRead: true } });
    if (!count) return reply.code(404).send({ error: 'Notification introuvable' });
    return { ok: true };
  });

  app.patch('/read-all', async (req) => {
    const { count } = await prisma.notification.updateMany({ where: { userId: req.user.sub, isRead: false }, data: { isRead: true } });
    return { updated: count };
  });
}
