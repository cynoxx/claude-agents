import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addDays, todayIn } from '../src/lib/dates.js';
import { prisma } from '../src/lib/prisma.js';
import { generateBillReminders, runForAllUsers } from '../src/services/notificationService.js';
import { registerUser, resetDb, setupApp } from './helpers.js';

let ctx: Awaited<ReturnType<typeof setupApp>>;
const today = todayIn('Europe/Paris');

beforeAll(async () => {
  ctx = await setupApp();
});
afterAll(async () => {
  await ctx.app.close();
  await prisma.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  ctx.mailer.sent.length = 0;
});

const bill = (over: Record<string, unknown> = {}) => ({
  title: 'Électricité',
  provider: 'EDF',
  amount: 82.5,
  dueDate: addDays(today, 20),
  ...over,
});

describe('authentification', () => {
  it('inscrit, connecte et renvoie le profil', async () => {
    const { app } = ctx;
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'Jojo@Test.fr', password: 'motdepasse123' } });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.email).toBe('jojo@test.fr');
    expect(reg.json().user.billReminderDays).toEqual([7, 3, 0]);
    expect(reg.json().user).not.toHaveProperty('passwordHash');

    const dup = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'jojo@test.fr', password: 'motdepasse123' } });
    expect(dup.statusCode).toBe(409);

    const bad = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jojo@test.fr', password: 'mauvais-mdp' } });
    expect(bad.statusCode).toBe(401);

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'jojo@test.fr', password: 'motdepasse123' } });
    expect(login.statusCode).toBe(200);
    const auth = { authorization: `Bearer ${login.json().token}` };

    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: auth });
    expect(me.json().email).toBe('jojo@test.fr');

    const refresh = await app.inject({ method: 'POST', url: '/api/auth/refresh', headers: auth });
    expect(refresh.json().token).toBeTypeOf('string');
  });

  it('refuse les mots de passe trop courts et les requêtes sans jeton', async () => {
    const short = await ctx.app.inject({ method: 'POST', url: '/api/auth/register', payload: { email: 'a@b.fr', password: 'court' } });
    expect(short.statusCode).toBe(400);
    const anon = await ctx.app.inject({ method: 'GET', url: '/api/bills' });
    expect(anon.statusCode).toBe(401);
  });

  it('met à jour les réglages d’alerte', async () => {
    const { auth } = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { billReminderDays: [1, 14, 1], budgetWarningThreshold: 90 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().billReminderDays).toEqual([14, 1]);
    expect(res.json().budgetWarningThreshold).toBe(90);
  });
});

describe('factures', () => {
  it('fait le CRUD complet avec catégorisation automatique', async () => {
    const { app } = ctx;
    const { auth } = await registerUser(app);

    const created = await app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill() });
    expect(created.statusCode).toBe(201);
    const b = created.json();
    expect(b).toMatchObject({ category: 'UTILITIES', amount: 82.5, paid: false, dueDate: addDays(today, 20) });

    const updated = await app.inject({ method: 'PUT', url: `/api/bills/${b.id}`, headers: auth, payload: { amount: 90, category: 'HOUSING' } });
    expect(updated.json()).toMatchObject({ amount: 90, category: 'HOUSING' });

    const one = await app.inject({ method: 'GET', url: `/api/bills/${b.id}`, headers: auth });
    expect(one.json().title).toBe('Électricité');

    const del = await app.inject({ method: 'DELETE', url: `/api/bills/${b.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({ method: 'GET', url: `/api/bills/${b.id}`, headers: auth });
    expect(gone.statusCode).toBe(404);
  });

  it('valide les données', async () => {
    const { auth } = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ dueDate: '19/10/2026', amount: -5 }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toHaveProperty('dueDate');
    expect(res.json().details).toHaveProperty('amount');
  });

  it('isole les factures entre utilisateurs', async () => {
    const a = await registerUser(ctx.app);
    const b = await registerUser(ctx.app);
    const created = (await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: a.auth, payload: bill() })).json();
    for (const [method, url] of [
      ['GET', `/api/bills/${created.id}`],
      ['PUT', `/api/bills/${created.id}`],
      ['DELETE', `/api/bills/${created.id}`],
      ['PATCH', `/api/bills/${created.id}/pay`],
    ] as const) {
      const res = await ctx.app.inject({ method, url, headers: b.auth, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(404);
    }
    const list = await ctx.app.inject({ method: 'GET', url: '/api/bills', headers: b.auth });
    expect(list.json()).toEqual([]);
  });

  it('filtre, recherche et trie', async () => {
    const { auth } = await registerUser(ctx.app);
    const add = (p: Record<string, unknown>) => ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill(p) });
    await add({ title: 'Box', provider: 'Orange', amount: 40, dueDate: addDays(today, 5) });
    await add({ title: 'Facture gaz', provider: 'Engie', amount: 120, dueDate: addDays(today, -3) });
    await add({ title: 'Netflix', provider: 'Netflix', amount: 13.49, dueDate: addDays(today, 10), paid: true });

    const get = async (qs: string) => (await ctx.app.inject({ method: 'GET', url: `/api/bills?${qs}`, headers: auth })).json() as Array<{ title: string }>;
    expect((await get('status=overdue')).map((b) => b.title)).toEqual(['Facture gaz']);
    expect((await get('status=paid')).map((b) => b.title)).toEqual(['Netflix']);
    expect((await get('status=unpaid')).length).toBe(2);
    expect((await get('category=INTERNET')).map((b) => b.title)).toEqual(['Box']);
    expect((await get('q=orAN')).map((b) => b.title)).toEqual(['Box']);
    expect((await get('sort=amount&order=desc')).map((b) => b.title)).toEqual(['Facture gaz', 'Box', 'Netflix']);
    expect((await get(`from=${today}&to=${addDays(today, 7)}`)).map((b) => b.title)).toEqual(['Box']);
  });

  it('marque payée et crée l’échéance suivante pour une facture récurrente', async () => {
    const { auth } = await registerUser(ctx.app);
    const created = (await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ dueDate: '2026-01-31', recurrence: 'MONTHLY' }) })).json();
    const paid = await ctx.app.inject({ method: 'PATCH', url: `/api/bills/${created.id}/pay`, headers: auth, payload: { paidDate: '2026-01-30' } });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().bill).toMatchObject({ paid: true, paidDate: '2026-01-30' });
    expect(paid.json().next).toMatchObject({ dueDate: '2026-02-28', paid: false, recurrence: 'MONTHLY', amount: 82.5 });

    // Payer une deuxième fois ne recrée pas d'échéance
    const again = await ctx.app.inject({ method: 'PATCH', url: `/api/bills/${created.id}/pay`, headers: auth });
    expect(again.json().next).toBeNull();
    const all = await ctx.app.inject({ method: 'GET', url: '/api/bills', headers: auth });
    expect(all.json()).toHaveLength(2);
  });

  it('remet une facture à payer via PUT', async () => {
    const { auth } = await registerUser(ctx.app);
    const created = (await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ paid: true }) })).json();
    expect(created.paidDate).toBe(today);
    const res = await ctx.app.inject({ method: 'PUT', url: `/api/bills/${created.id}`, headers: auth, payload: { paid: false } });
    expect(res.json()).toMatchObject({ paid: false, paidDate: null });
  });
});

describe('notifications', () => {
  it('crée un rappel une seule fois et envoie un email', async () => {
    const { auth, user } = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ dueDate: addDays(today, 3) }) });

    // La création de la facture a déjà déclenché le rappel J-3
    let list = (await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: auth })).json();
    expect(list.unreadCount).toBe(1);
    expect(list.items[0]).toMatchObject({ type: 'BILL_REMINDER', title: 'Échéance dans 3 jours : Électricité' });
    expect(ctx.mailer.sent).toHaveLength(1);

    // Relancer le planificateur ne duplique rien
    expect(await runForAllUsers(ctx.mailer)).toBe(0);
    expect(await generateBillReminders(user.id, ctx.mailer)).toBe(0);

    // Deux jours plus tard : J-1, on reste sur le seuil J-3 déjà envoyé
    const in2days = new Date(Date.now() + 2 * 86_400_000);
    expect(await generateBillReminders(user.id, ctx.mailer, in2days)).toBe(0);
    // Le jour J : nouveau rappel
    const in3days = new Date(Date.now() + 3 * 86_400_000);
    expect(await generateBillReminders(user.id, ctx.mailer, in3days)).toBe(1);
    // Le lendemain : facture en retard
    const in4days = new Date(Date.now() + 4 * 86_400_000);
    expect(await generateBillReminders(user.id, ctx.mailer, in4days)).toBe(1);

    list = (await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: auth })).json();
    expect(list.items.map((n: { title: string }) => n.title)).toEqual([
      'Facture en retard : Électricité',
      "À payer aujourd'hui : Électricité",
      'Échéance dans 3 jours : Électricité',
    ]);

    const read = await ctx.app.inject({ method: 'PATCH', url: `/api/notifications/${list.items[0].id}/read`, headers: auth });
    expect(read.statusCode).toBe(200);
    const all = await ctx.app.inject({ method: 'PATCH', url: '/api/notifications/read-all', headers: auth });
    expect(all.json().updated).toBe(2);
  });

  it('ne rappelle pas une facture payée et respecte la préférence email', async () => {
    const { auth } = await registerUser(ctx.app);
    await ctx.app.inject({ method: 'PUT', url: '/api/settings', headers: auth, payload: { notifyEmail: false } });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ dueDate: today, paid: true }) });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ dueDate: today, title: 'Box', provider: 'Free' }) });
    const list = (await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: auth })).json();
    expect(list.items.map((n: { title: string }) => n.title)).toEqual(["À payer aujourd'hui : Box"]);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('alerte au seuil budgétaire puis au dépassement', async () => {
    const { auth } = await registerUser(ctx.app);
    const [year, month] = today.split('-').map(Number);
    const monthDay = (d: number) => `${today.slice(0, 8)}${String(d).padStart(2, '0')}`;
    await ctx.app.inject({ method: 'POST', url: '/api/budget', headers: auth, payload: { category: 'SUBSCRIPTION', limitAmount: 50, month, year } });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ provider: 'Netflix', amount: 42, dueDate: monthDay(1), paid: true }) });
    let titles = (await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: auth })).json().items.map((n: { title: string }) => n.title);
    expect(titles).toContain('Budget bientôt atteint : Abonnements');

    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ provider: 'Spotify', amount: 11, dueDate: monthDay(2), paid: true }) });
    titles = (await ctx.app.inject({ method: 'GET', url: '/api/notifications', headers: auth })).json().items.map((n: { title: string }) => n.title);
    expect(titles.filter((t: string) => t.startsWith('Budget'))).toEqual(['Budget dépassé : Abonnements', 'Budget bientôt atteint : Abonnements']);
  });
});

describe('budget et dashboard', () => {
  it('calcule le budget vs réel et le tableau de bord', async () => {
    const { auth } = await registerUser(ctx.app);
    const [year, month] = today.split('-').map(Number);
    const monthDay = (d: number) => `${today.slice(0, 8)}${String(d).padStart(2, '0')}`;
    const created = (await ctx.app.inject({ method: 'POST', url: '/api/budget', headers: auth, payload: { category: 'UTILITIES', limitAmount: 200, month, year } })).json();
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ amount: 50, dueDate: monthDay(1), paid: true }) });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ title: 'Box', provider: 'Orange', amount: 30, dueDate: addDays(today, 2) }) });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ title: 'Assurance', provider: 'MAIF', amount: 300, dueDate: addDays(today, -1) }) });

    const budget = (await ctx.app.inject({ method: 'GET', url: '/api/budget', headers: auth })).json();
    expect(budget.lines.find((l: { category: string }) => l.category === 'UTILITIES')).toMatchObject({ spent: 50, limit: 200, percentageUsed: 25, budgetId: created.id });

    const put = await ctx.app.inject({ method: 'PUT', url: `/api/budget/${created.id}`, headers: auth, payload: { limitAmount: 100 } });
    expect(put.json().limitAmount).toBe(100);

    const dash = (await ctx.app.inject({ method: 'GET', url: '/api/dashboard', headers: auth })).json();
    expect(dash.today).toBe(today);
    expect(dash.billsDueThisWeek.map((b: { title: string }) => b.title)).toEqual(['Box']);
    expect(dash.overdueBills.map((b: { title: string }) => b.title)).toEqual(['Assurance']);
    expect(dash.totalAmountDue).toBe(330);
    expect(dash.totalOverdue).toBe(300);
    expect(dash.recentTransactions).toHaveLength(1);
    expect(dash.monthlyTrend).toHaveLength(6);
    expect(dash.monthlyTrend[5].month).toBe(today.slice(0, 7));
    expect(dash.unreadNotifications).toBeGreaterThan(0);

    const del = await ctx.app.inject({ method: 'DELETE', url: `/api/budget/${created.id}`, headers: auth });
    expect(del.statusCode).toBe(204);
  });

  it("répond 501 tant que le scanner d'emails n'est pas branché", async () => {
    const { auth } = await registerUser(ctx.app);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/import/email', headers: auth });
    expect(res.statusCode).toBe(501);
  });
});

describe('rentrées et bilan', () => {
  it('gère les rentrées et calcule le bilan du mois', async () => {
    const { auth } = await registerUser(ctx.app);
    const other = await registerUser(ctx.app);
    const month = today.slice(0, 7);
    const salary = { label: 'Salaire', source: 'Employeur', amount: 2100, date: `${month}-01`, recurrence: 'MONTHLY', category: 'SALARY' };
    const created = await ctx.app.inject({ method: 'POST', url: '/api/incomes', headers: auth, payload: salary });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    await ctx.app.inject({ method: 'POST', url: '/api/incomes', headers: auth, payload: { label: 'Vente', amount: 40, date: `${month}-02` } });
    await ctx.app.inject({ method: 'POST', url: '/api/bills', headers: auth, payload: bill({ amount: 600, dueDate: `${month}-03` }) });

    const bad = await ctx.app.inject({ method: 'POST', url: '/api/incomes', headers: auth, payload: { ...salary, endDate: '2000-01-01' } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.endDate).toBeDefined();

    const list = (await ctx.app.inject({ method: 'GET', url: '/api/incomes', headers: auth })).json();
    expect(list).toHaveLength(2);
    expect(list.find((i: { id: string }) => i.id === id)).toMatchObject({ amount: 2100, endDate: null, category: 'SALARY' });

    const balance = (await ctx.app.inject({ method: 'GET', url: '/api/incomes/balance?months=3', headers: auth })).json();
    expect(balance).toHaveLength(3);
    expect(balance[2]).toEqual({ month, income: 2140, expenses: 600, balance: 1540 });

    const put = await ctx.app.inject({ method: 'PUT', url: `/api/incomes/${id}`, headers: auth, payload: { ...salary, amount: 2200 } });
    expect(put.json().amount).toBe(2200);
    // Les rentrées des autres utilisateurs restent inaccessibles
    expect((await ctx.app.inject({ method: 'PUT', url: `/api/incomes/${id}`, headers: other.auth, payload: salary })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/incomes/${id}`, headers: other.auth })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'DELETE', url: `/api/incomes/${id}`, headers: auth })).statusCode).toBe(204);
  });
});
