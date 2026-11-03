import type { FastifyInstance } from 'fastify';
import { NotConfiguredEmailScanner, type EmailScanner } from '../services/emailScanner.js';

export async function importRoutes(app: FastifyInstance, opts: { scanner?: EmailScanner }) {
  app.addHook('preHandler', app.authenticate);
  const scanner = opts.scanner ?? new NotConfiguredEmailScanner();

  app.post('/email', async () => {
    const detected = await scanner.scanForBills();
    return { detected };
  });
}
