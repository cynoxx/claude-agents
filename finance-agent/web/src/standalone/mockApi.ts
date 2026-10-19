// Réplique dans le navigateur de l'API du serveur (mêmes routes, mêmes règles),
// pour faire tourner l'app sans backend, par exemple dans un artefact.
import type { Bill, BillCategory, Recurrence, User } from '../types';
import { addDays, daysBetween, localToday } from '../utils/dates';
import { BILL_CATEGORIES, categorizeProvider } from './categories';
import { getBackend, type Budget, type State, type StoredNotification } from './storage';

export class MockError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const round = (n: number) => Math.round(n * 100) / 100;
const eur = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

function monthBounds(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start, end };
}

const MONTHS_BY_RECURRENCE: Record<Recurrence, number> = { NONE: 0, MONTHLY: 1, QUARTERLY: 3, YEARLY: 12 };

const CATEGORY_LABELS: Record<string, string> = {
  HOUSING: 'Logement',
  UTILITIES: 'Énergie et eau',
  INTERNET: 'Internet et téléphone',
  INSURANCE: 'Assurances',
  TRANSPORT: 'Transport',
  FOOD: 'Alimentation',
  HEALTH: 'Santé',
  ENTERTAINMENT: 'Loisirs',
  SUBSCRIPTION: 'Abonnements',
  OTHER: 'Autres',
};

// ---------- Données d'exemple ----------

function demoState(): State {
  const today = localToday();
  const now = new Date().toISOString();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const ym = `${y}-${String(m).padStart(2, '0')}`;
  const recurring: Array<[string, string, number, number]> = [
    ['Loyer', 'Foncia', 850, 5],
    ['Électricité', 'EDF', 78.4, 12],
    ['Box internet', 'Free', 39.99, 16],
    ['Forfait mobile', 'Sosh', 15.99, 20],
    ['Assurance habitation', 'MAIF', 24.5, 8],
    ['Netflix', 'Netflix', 13.49, 22],
    ['Spotify', 'Spotify', 11.12, 25],
  ];
  const bills: Bill[] = [];
  const mk = (b: Partial<Bill> & Pick<Bill, 'title' | 'provider' | 'amount' | 'dueDate'>): Bill => ({
    id: uid(),
    paid: false,
    paidDate: null,
    category: categorizeProvider(b.provider),
    reference: null,
    documentUrl: null,
    notes: null,
    recurrence: 'NONE',
    createdAt: now,
    updatedAt: now,
    ...b,
  });
  const elec = [92.1, 85.3, 64.2, 58.9, 61.7, 78.4];
  for (let back = 5; back >= 0; back--) {
    for (const [title, provider, amount, day] of recurring) {
      const due = addMonths(`${ym}-${String(day).padStart(2, '0')}`, -back);
      const paid = due < today;
      bills.push(mk({ title, provider, amount: title === 'Électricité' ? elec[5 - back]! : amount, dueDate: due, recurrence: 'MONTHLY', paid, paidDate: paid ? due : null }));
    }
  }
  bills.push(mk({ title: 'Facture gaz', provider: 'Engie', amount: 96.3, dueDate: addDays(today, -2) }));
  bills.push(mk({ title: 'Assurance auto', provider: 'Direct Assurance', amount: 312, dueDate: addDays(today, 2), recurrence: 'YEARLY' }));
  const budgets: Budget[] = (
    [
      ['SUBSCRIPTION', 25],
      ['UTILITIES', 250],
      ['INTERNET', 60],
      ['HOUSING', 900],
    ] as const
  ).map(([category, limitAmount]) => ({ id: uid(), category, limitAmount, month: m, year: y }));
  const user: User = {
    id: 'moi',
    email: '',
    name: null,
    billReminderDays: [7, 3, 0],
    budgetWarningThreshold: 80,
    notifyEmail: false,
    notifyInApp: true,
    createdAt: now,
  };
  return { version: 1, demo: true, user, bills, budgets, notifications: [] };
}

function emptyState(user: User): State {
  return { version: 1, demo: false, user, bills: [], budgets: [], notifications: [] };
}

// ---------- État ----------

let state: State | null = null;

async function getState(): Promise<State> {
  if (state) return state;
  const backend = await getBackend();
  const loaded = await backend.load().catch(() => null);
  state = loaded ?? demoState();
  runReminders(state);
  return state;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** Enregistre après une action ; les données d'exemple ne sont jamais enregistrées. */
function persist() {
  if (!state || state.demo) return;
  clearTimeout(saveTimer);
  const snapshot = state;
  saveTimer = setTimeout(() => {
    getBackend()
      .then((b) => b.save(snapshot))
      .catch((e) => console.error('[enregistrement]', e));
  }, 400);
}

/** Toute modification sort du mode exemple : on repart des données affichées. */
function mutate(s: State) {
  s.demo = false;
  persist();
}

export async function storageInfo() {
  const s = await getState();
  return { demo: s.demo, kind: (await getBackend()).kind };
}

/** Efface les exemples et repart d'une app vide. */
export async function startFresh() {
  const s = await getState();
  state = emptyState(s.user);
  mutate(state);
}

// ---------- Règles métier (identiques au serveur) ----------

function planReminder(dueDate: string, today: string, days: number[]) {
  const daysUntil = daysBetween(today, dueDate);
  if (daysUntil < 0) return { stage: 'overdue' as const, daysUntil };
  const reached = days.filter((d) => d >= 0 && daysUntil <= d).sort((a, b) => a - b);
  return reached.length ? { stage: reached[0]!, daysUntil } : null;
}

function reminderText(bill: Bill, plan: { stage: number | 'overdue'; daysUntil: number }) {
  const date = new Date(`${bill.dueDate}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  const label = `${bill.title} (${bill.provider}, ${eur.format(bill.amount)})`;
  if (plan.stage === 'overdue') {
    const n = -plan.daysUntil;
    return { title: `Facture en retard : ${bill.title}`, message: `${label} était à payer le ${date}, il y a ${n} jour${n > 1 ? 's' : ''}.` };
  }
  if (plan.daysUntil === 0) return { title: `À payer aujourd'hui : ${bill.title}`, message: `${label} est à payer aujourd'hui.` };
  const n = plan.daysUntil;
  return { title: `Échéance dans ${n} jour${n > 1 ? 's' : ''} : ${bill.title}`, message: `${label} est à payer le ${date}.` };
}

function addNotification(s: State, n: Omit<StoredNotification, 'id' | 'isRead' | 'createdAt'>): boolean {
  if (s.notifications.some((x) => x.dedupKey === n.dedupKey)) return false;
  s.notifications.unshift({ ...n, id: uid(), isRead: false, createdAt: new Date().toISOString() });
  return true;
}

function budgetSummary(s: State, year: number, month: number) {
  const { start, end } = monthBounds(year, month);
  const spent = new Map<string, number>();
  for (const b of s.bills) if (b.dueDate >= start && b.dueDate <= end) spent.set(b.category, (spent.get(b.category) ?? 0) + b.amount);
  const byCat = new Map(s.budgets.filter((b) => b.year === year && b.month === month).map((b) => [b.category as string, b]));
  return BILL_CATEGORIES.filter((c) => byCat.has(c) || spent.has(c)).map((category) => {
    const budget = byCat.get(category);
    const limit = budget?.limitAmount ?? 0;
    const sp = round(spent.get(category) ?? 0);
    return { budgetId: budget?.id ?? null, category, spent: sp, limit, percentageUsed: limit > 0 ? Math.round((sp / limit) * 1000) / 10 : 0 };
  });
}

function runReminders(s: State) {
  const today = localToday();
  let created = 0;
  for (const bill of s.bills) {
    if (bill.paid) continue;
    const plan = planReminder(bill.dueDate, today, s.user.billReminderDays);
    if (!plan) continue;
    const { title, message } = reminderText(bill, plan);
    if (addNotification(s, { title, message, type: 'BILL_REMINDER', dueDate: bill.dueDate, billId: bill.id, dedupKey: `bill:${bill.id}:${bill.dueDate}:${plan.stage}` }))
      created++;
  }
  const [y, m] = today.split('-').map(Number) as [number, number];
  for (const line of budgetSummary(s, y, m)) {
    if (line.limit <= 0) continue;
    const t = s.user.budgetWarningThreshold;
    const level = line.percentageUsed >= 100 ? 100 : line.percentageUsed >= t ? t : null;
    if (level === null) continue;
    const label = CATEGORY_LABELS[line.category]!;
    if (
      addNotification(s, {
        title: level === 100 ? `Budget dépassé : ${label}` : `Budget bientôt atteint : ${label}`,
        message: `${label} : ${eur.format(line.spent)} sur ${eur.format(line.limit)} (${Math.round(line.percentageUsed)} %) ce mois-ci.`,
        type: 'BUDGET_ALERT',
        dueDate: null,
        billId: null,
        dedupKey: `budget:${line.category}:${y}-${m}:${level}`,
      })
    )
      created++;
  }
  return created;
}

// ---------- Validation ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateBill(body: Record<string, unknown>, partial: boolean) {
  const errors: Record<string, string[]> = {};
  const need = (k: string) => !partial || k in body;
  if (need('title') && !(typeof body.title === 'string' && body.title.trim())) errors.title = ['Intitulé requis'];
  if (need('provider') && !(typeof body.provider === 'string' && body.provider.trim())) errors.provider = ['Fournisseur requis'];
  if (need('amount') && !(typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0)) errors.amount = ['Montant positif attendu'];
  if (need('dueDate') && !(typeof body.dueDate === 'string' && DATE_RE.test(body.dueDate))) errors.dueDate = ['Format attendu : AAAA-MM-JJ'];
  if (body.documentUrl && !/^https?:\/\//.test(String(body.documentUrl))) errors.documentUrl = ['Lien http(s) attendu'];
  if (body.category && !BILL_CATEGORIES.includes(body.category as BillCategory)) errors.category = ['Catégorie inconnue'];
  if (Object.keys(errors).length) throw new MockError(400, 'Données invalides', errors);
}

// ---------- Routes ----------

type Handler = (s: State, params: Record<string, string>, query: URLSearchParams, body: Record<string, unknown>) => unknown;

const routes: Array<{ method: string; re: RegExp; keys: string[]; handler: Handler }> = [];
function route(method: string, pattern: string, handler: Handler) {
  const keys: string[] = [];
  const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, re, keys, handler });
}

const findBill = (s: State, id: string) => {
  const b = s.bills.find((x) => x.id === id);
  if (!b) throw new MockError(404, 'Facture introuvable');
  return b;
};

route('GET', '/auth/me', (s) => s.user);
route('PUT', '/settings', (s, _p, _q, body) => {
  if (Array.isArray(body.billReminderDays)) body.billReminderDays = [...new Set(body.billReminderDays as number[])].sort((a, b) => b - a);
  Object.assign(s.user, body);
  runReminders(s);
  mutate(s);
  return s.user;
});

route('GET', '/bills', (s, _p, q) => {
  const today = localToday();
  const status = q.get('status') ?? 'all';
  const term = q.get('q')?.toLowerCase();
  let list = s.bills.filter((b) => {
    if (status === 'paid' && !b.paid) return false;
    if (status === 'unpaid' && b.paid) return false;
    if (status === 'overdue' && (b.paid || b.dueDate >= today)) return false;
    if (q.get('category') && b.category !== q.get('category')) return false;
    if (q.get('from') && b.dueDate < q.get('from')!) return false;
    if (q.get('to') && b.dueDate > q.get('to')!) return false;
    if (term && ![b.provider, b.title, b.reference ?? ''].some((v) => v.toLowerCase().includes(term))) return false;
    return true;
  });
  const sort = (q.get('sort') ?? 'dueDate') as keyof Bill;
  const dir = q.get('order') === 'desc' ? -1 : 1;
  list = [...list].sort((a, b) => {
    const x = a[sort] ?? '';
    const y = b[sort] ?? '';
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * dir || a.id.localeCompare(b.id);
  });
  return list;
});

route('GET', '/bills/:id', (s, p) => findBill(s, p.id!));

route('POST', '/bills', (s, _p, _q, body) => {
  validateBill(body, false);
  const now = new Date().toISOString();
  const paid = Boolean(body.paid);
  const bill: Bill = {
    id: uid(),
    title: String(body.title).trim(),
    provider: String(body.provider).trim(),
    amount: Number(body.amount),
    dueDate: String(body.dueDate),
    category: (body.category as BillCategory) ?? categorizeProvider(String(body.provider)),
    reference: (body.reference as string) || null,
    documentUrl: (body.documentUrl as string) || null,
    notes: (body.notes as string) || null,
    recurrence: (body.recurrence as Recurrence) ?? 'NONE',
    paid,
    paidDate: paid ? ((body.paidDate as string) ?? localToday()) : null,
    createdAt: now,
    updatedAt: now,
  };
  s.bills.push(bill);
  runReminders(s);
  mutate(s);
  return bill;
});

route('PUT', '/bills/:id', (s, p, _q, body) => {
  const bill = findBill(s, p.id!);
  validateBill(body, true);
  const { id: _id, createdAt: _c, ...rest } = body as Partial<Bill>;
  Object.assign(bill, rest, { updatedAt: new Date().toISOString() });
  if (body.paid === false) bill.paidDate = null;
  if (body.paid === true && !body.paidDate) bill.paidDate = bill.paidDate ?? localToday();
  runReminders(s);
  mutate(s);
  return bill;
});

route('DELETE', '/bills/:id', (s, p) => {
  findBill(s, p.id!);
  s.bills = s.bills.filter((b) => b.id !== p.id);
  s.notifications = s.notifications.filter((n) => n.billId !== p.id);
  mutate(s);
  return undefined;
});

route('PATCH', '/bills/:id/pay', (s, p, _q, body) => {
  const bill = findBill(s, p.id!);
  const wasPaid = bill.paid;
  bill.paid = true;
  bill.paidDate = (body.paidDate as string) ?? localToday();
  bill.updatedAt = new Date().toISOString();
  let next: Bill | null = null;
  const months = MONTHS_BY_RECURRENCE[bill.recurrence];
  if (months && !wasPaid) {
    const due = addMonths(bill.dueDate, months);
    if (!s.bills.some((b) => b.provider === bill.provider && b.title === bill.title && b.dueDate === due)) {
      next = { ...bill, id: uid(), dueDate: due, paid: false, paidDate: null, notes: null, documentUrl: null, createdAt: bill.updatedAt };
      s.bills.push(next);
    }
  }
  runReminders(s);
  mutate(s);
  return { bill, next };
});

route('GET', '/budget', (s, _p, q) => {
  const today = localToday();
  const year = Number(q.get('year') ?? today.slice(0, 4));
  const month = Number(q.get('month') ?? today.slice(5, 7));
  return { year, month, lines: budgetSummary(s, year, month) };
});

route('POST', '/budget', (s, _p, _q, body) => {
  const { category, month, year } = body as { category: BillCategory; month: number; year: number };
  const limitAmount = Number(body.limitAmount);
  if (!(limitAmount > 0)) throw new MockError(400, 'Données invalides', { limitAmount: ['Montant positif attendu'] });
  const existing = s.budgets.find((b) => b.category === category && b.month === month && b.year === year);
  if (existing) existing.limitAmount = limitAmount;
  else s.budgets.push({ id: uid(), category, limitAmount, month, year });
  runReminders(s);
  mutate(s);
  return existing ?? s.budgets.at(-1);
});

route('DELETE', '/budget/:id', (s, p) => {
  s.budgets = s.budgets.filter((b) => b.id !== p.id);
  mutate(s);
  return undefined;
});

route('GET', '/notifications', (s, _p, q) => {
  const items = q.get('unread') === 'true' ? s.notifications.filter((n) => !n.isRead) : s.notifications;
  return { items: items.slice(0, Number(q.get('limit') ?? 50)), unreadCount: s.notifications.filter((n) => !n.isRead).length };
});

route('PATCH', '/notifications/read-all', (s) => {
  const unread = s.notifications.filter((n) => !n.isRead);
  unread.forEach((n) => (n.isRead = true));
  mutate(s);
  return { updated: unread.length };
});

route('PATCH', '/notifications/:id/read', (s, p) => {
  const n = s.notifications.find((x) => x.id === p.id);
  if (!n) throw new MockError(404, 'Notification introuvable');
  n.isRead = true;
  mutate(s);
  return { ok: true };
});

route('GET', '/dashboard', (s) => {
  const today = localToday();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const { start: monthStart, end: monthEnd } = monthBounds(y, m);
  const weekEnd = addDays(today, 7);
  const unpaid = s.bills.filter((b) => !b.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const overdueBills = unpaid.filter((b) => b.dueDate < today);
  const trendStart = addMonths(monthStart, -5);
  return {
    today,
    billsDueThisWeek: unpaid.filter((b) => b.dueDate >= today && b.dueDate <= weekEnd),
    billsDueThisMonth: unpaid.filter((b) => b.dueDate >= today && b.dueDate <= monthEnd),
    overdueBills,
    totalAmountDue: round(unpaid.reduce((t, b) => t + b.amount, 0)),
    totalOverdue: round(overdueBills.reduce((t, b) => t + b.amount, 0)),
    budgetSummary: budgetSummary(s, y, m),
    recentTransactions: s.bills
      .filter((b) => b.paid)
      .sort((a, b) => (b.paidDate ?? '').localeCompare(a.paidDate ?? '') || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 8),
    upcomingReminders: s.notifications.filter((n) => !n.isRead).slice(0, 8),
    unreadNotifications: s.notifications.filter((n) => !n.isRead).length,
    monthlyTrend: Array.from({ length: 6 }, (_, i) => {
      const key = addMonths(trendStart, i).slice(0, 7);
      return { month: key, total: round(s.bills.filter((b) => b.dueDate.startsWith(key)).reduce((t, b) => t + b.amount, 0)) };
    }),
  };
});

export async function mockFetch(method: string, path: string, body: unknown): Promise<unknown> {
  const s = await getState();
  const [pathname, qs] = path.split('?');
  const query = new URLSearchParams(qs ?? '');
  for (const { method: m, re, keys, handler } of routes) {
    if (m !== method) continue;
    const match = re.exec(pathname!);
    if (!match) continue;
    const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(match[i + 1]!)]));
    // Copie profonde : React Query ne doit pas recevoir d'objets que l'on mute ensuite
    const result = handler(s, params, query, (body ?? {}) as Record<string, unknown>);
    return result === undefined ? undefined : structuredClone(result);
  }
  throw new MockError(404, `Route inconnue : ${method} ${pathname}`);
}
