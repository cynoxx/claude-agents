import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { authRoutes } from './routes/auth.js';
import { billRoutes } from './routes/bills.js';
import { budgetRoutes } from './routes/budget.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { importRoutes } from './routes/import.js';
import { incomeRoutes } from './routes/incomes.js';
import { notificationRoutes } from './routes/notifications.js';
import { createMailer, type Mailer } from './services/mailer.js';

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
    mailer: Mailer;
  }
}

export interface AppOptions {
  logger?: boolean;
  mailer?: Mailer;
}

export async function buildApp(opts: AppOptions = {}) {
  const app = Fastify({ logger: opts.logger ?? false });

  app.decorate('mailer', opts.mailer ?? createMailer());

  await app.register(helmet);
  await app.register(cors, { origin: config.corsOrigin.split(','), credentials: true });
  await app.register(rateLimit, { global: false });
  await app.register(jwt, { secret: config.jwtSecret, sign: { expiresIn: `${config.sessionTimeoutMinutes}m` } });

  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
    } catch {
      await reply.code(401).send({ error: 'Non authentifié' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Données invalides', details: err.flatten().fieldErrors });
    }
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: status >= 500 ? 'Erreur interne' : (err as Error).message });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(billRoutes, { prefix: '/api/bills' });
  await app.register(budgetRoutes, { prefix: '/api/budget' });
  await app.register(notificationRoutes, { prefix: '/api/notifications' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(importRoutes, { prefix: '/api/import' });
  await app.register(incomeRoutes, { prefix: '/api/incomes' });

  return app;
}
