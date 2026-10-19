import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { LogMailer } from '../src/services/mailer.js';

export async function setupApp() {
  const mailer = new LogMailer();
  const app = await buildApp({ mailer });
  return { app, mailer };
}

export async function resetDb() {
  await prisma.notification.deleteMany();
  await prisma.bill.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.adminDocument.deleteMany();
  await prisma.user.deleteMany();
}

let counter = 0;
export async function registerUser(app: Awaited<ReturnType<typeof buildApp>>, email = `user${++counter}@test.fr`) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email, password: 'motdepasse123' } });
  const body = res.json();
  return { token: body.token as string, user: body.user, auth: { authorization: `Bearer ${body.token}` } };
}
