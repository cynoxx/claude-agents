import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

const url = process.env.TEST_DATABASE_URL ?? 'postgresql://finance:finance@localhost:5432/finance_test';

// Repart d'une base de test vide puis applique les migrations
export default async function setup() {
  const db = new PrismaClient({ datasources: { db: { url } } });
  await db.$executeRawUnsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await db.$executeRawUnsafe('CREATE SCHEMA public');
  await db.$disconnect();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'ignore' });
}
