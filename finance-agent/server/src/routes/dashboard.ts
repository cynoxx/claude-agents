import type { FastifyInstance } from 'fastify';
import { config } from '../lib/config.js';
import { addDays, addMonths, fromDateString, monthBounds, todayIn, toDateString } from '../lib/dates.js';
import { prisma } from '../lib/prisma.js';
import { serializeBill } from '../services/billService.js';
import { budgetSummary } from '../services/budgetService.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  app.get('/', async (req) => {
    const userId = req.user.sub;
    const today = todayIn(config.tz);
    const [year, month] = today.split('-').map(Number) as [number, number];
    const { start: monthStart, end: monthEnd } = monthBounds(year, month);
    const weekEnd = addDays(today, 7);

    const [unpaid, recentPaid, upcomingReminders, unreadCount, budget] = await Promise.all([
      prisma.bill.findMany({ where: { userId, paid: false }, orderBy: { dueDate: 'asc' } }),
      prisma.bill.findMany({ where: { userId, paid: true }, orderBy: [{ paidDate: 'desc' }, { updatedAt: 'desc' }], take: 8 }),
      prisma.notification.findMany({ where: { userId, isRead: false }, orderBy: { createdAt: 'desc' }, take: 8 }),
      prisma.notification.count({ where: { userId, isRead: false } }),
      budgetSummary(userId, year, month),
    ]);

    const bills = unpaid.map(serializeBill);
    const overdueBills = bills.filter((b) => b.dueDate < today);
    const billsDueThisWeek = bills.filter((b) => b.dueDate >= today && b.dueDate <= weekEnd);
    const billsDueThisMonth = bills.filter((b) => b.dueDate >= today && b.dueDate <= monthEnd);
    const totalAmountDue = round(bills.reduce((s, b) => s + b.amount, 0));
    const totalOverdue = round(overdueBills.reduce((s, b) => s + b.amount, 0));

    // Évolution sur 6 mois : total des factures par mois d'échéance
    const trendStart = addMonths(monthStart, -5);
    const history = await prisma.bill.findMany({
      where: { userId, dueDate: { gte: fromDateString(trendStart), lte: fromDateString(monthEnd) } },
      select: { dueDate: true, amount: true, category: true },
    });
    const monthlyTrend = Array.from({ length: 6 }, (_, i) => {
      const key = addMonths(trendStart, i).slice(0, 7);
      const total = history.filter((h) => toDateString(h.dueDate).startsWith(key)).reduce((s, h) => s + Number(h.amount), 0);
      return { month: key, total: round(total) };
    });

    return {
      today,
      billsDueThisWeek,
      billsDueThisMonth,
      overdueBills,
      totalAmountDue,
      totalOverdue,
      budgetSummary: budget,
      recentTransactions: recentPaid.map(serializeBill),
      upcomingReminders: upcomingReminders.map((n) => ({ ...n, dueDate: n.dueDate ? toDateString(n.dueDate) : null })),
      unreadNotifications: unreadCount,
      monthlyTrend,
    };
  });
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
