import bcrypt from 'bcryptjs';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { prisma } from '../lib/prisma.js';

const credentials = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Au moins 8 caractères').max(200),
});

const registerBody = credentials.extend({ name: z.string().trim().max(100).optional() });

const settingsBody = z.object({
  name: z.string().trim().max(100).nullable().optional(),
  billReminderDays: z.array(z.number().int().min(0).max(60)).min(1).max(10).optional(),
  budgetWarningThreshold: z.number().int().min(1).max(100).optional(),
  notifyEmail: z.boolean().optional(),
  notifyInApp: z.boolean().optional(),
});

const publicUser = {
  id: true,
  email: true,
  name: true,
  billReminderDays: true,
  budgetWarningThreshold: true,
  notifyEmail: true,
  notifyInApp: true,
  createdAt: true,
} as const;

export async function authRoutes(app: FastifyInstance) {
  const authLimit = { config: { rateLimit: { max: config.authRateLimit, timeWindow: '1 minute' } } };
  const sign = (user: { id: string; email: string }) => app.jwt.sign({ sub: user.id, email: user.email });

  app.post('/auth/register', authLimit, async (req, reply) => {
    const body = registerBody.parse(req.body);
    const exists = await prisma.user.findUnique({ where: { email: body.email } });
    if (exists) return reply.code(409).send({ error: 'Un compte existe déjà avec cet email' });
    const user = await prisma.user.create({
      data: { email: body.email, name: body.name, passwordHash: await bcrypt.hash(body.password, 12) },
      select: publicUser,
    });
    return reply.code(201).send({ token: sign(user), user });
  });

  app.post('/auth/login', authLimit, async (req, reply) => {
    const body = credentials.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user || !(await bcrypt.compare(body.password, user.passwordHash))) {
      return reply.code(401).send({ error: 'Email ou mot de passe incorrect' });
    }
    const { passwordHash: _, updatedAt: __, ...rest } = user;
    return { token: sign(user), user: rest };
  });

  // Prolonge la session tant que l'utilisateur est actif (expiration après 30 min d'inactivité)
  app.post('/auth/refresh', { preHandler: app.authenticate }, async (req) => {
    return { token: sign({ id: req.user.sub, email: req.user.email }) };
  });

  app.get('/auth/me', { preHandler: app.authenticate }, async (req, reply) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.sub }, select: publicUser });
    if (!user) return reply.code(401).send({ error: 'Non authentifié' });
    return user;
  });

  app.put('/settings', { preHandler: app.authenticate }, async (req) => {
    const body = settingsBody.parse(req.body);
    if (body.billReminderDays) body.billReminderDays = [...new Set(body.billReminderDays)].sort((a, b) => b - a);
    return prisma.user.update({ where: { id: req.user.sub }, data: body, select: publicUser });
  });
}
