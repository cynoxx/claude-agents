import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';
import { startScheduler } from './services/notificationService.js';

const app = await buildApp({ logger: true });
const stop = startScheduler(app.mailer, (m) => app.log.info(m));

const shutdown = async () => {
  stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
