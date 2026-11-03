// Argent au quotidien : solde lu chaque jour dans le mail Bankin, variations
// expliquées par les factures et rentrées connues, le reste demandé à l'utilisateur.
// Fichier sans effet de bord (testé), utilisé par les pages Aujourd'hui, Dépenses, Conseils.
import type { Bill, BillCategory, Income } from '../types';
import { occurrenceIn } from '../utils/balance';
import { addDays, daysBetween } from '../utils/dates';
import { categorizeProvider, normalize } from './categories';

export type SpendCategory = BillCategory | 'RESTAURANT' | 'SHOPPING' | 'CASH';

export const SPEND_LABELS: Record<SpendCategory, string> = {
  FOOD: 'Courses',
  RESTAURANT: 'Restos et sorties',
  TRANSPORT: 'Transport',
  SHOPPING: 'Shopping',
  ENTERTAINMENT: 'Loisirs',
  SUBSCRIPTION: 'Abonnements',
  HOUSING: 'Logement',
  UTILITIES: 'Énergie et eau',
  INTERNET: 'Téléphone et internet',
  INSURANCE: 'Assurances',
  HEALTH: 'Santé',
  CASH: 'Retraits',
  OTHER: 'Autres',
};

/** Choix proposés en un geste quand on répond à une question */
export const QUICK_CATEGORIES: SpendCategory[] = ['FOOD', 'RESTAURANT', 'TRANSPORT', 'SHOPPING', 'ENTERTAINMENT', 'SUBSCRIPTION', 'HEALTH', 'CASH', 'OTHER'];

export interface DayBalance {
  /** Jour du mail, YYYY-MM-DD (heure de Paris) */
  date: string;
  amount: number;
}

/**
 * Variation du solde entre deux mails Bankin (de `from` inclus à `to` exclu).
 * Négative : dépense. Positive : argent reçu.
 */
export interface Movement {
  id: string;
  from: string;
  to: string;
  amount: number;
  label: string;
  category: SpendCategory;
  /** pending : baisse inexpliquée, à préciser par l'utilisateur */
  status: 'pending' | 'done';
  /** auto : rangé sans question ; mail : retrouvé dans les mails ; me : précisé à la main ; bankin : opération exacte reçue par alerte Bankin */
  source: 'auto' | 'mail' | 'me' | 'bankin';
  /** Recherche dans les mails déjà faite (on ne la refait pas) */
  searched?: boolean;
  mailUrl?: string | null;
  /** Mail du même montant trouvé autour de ces dates : proposé, jamais classé sans accord */
  suggestion?: { label: string; subject: string; url: string | null } | null;
  createdAt: string;
}

export interface MoneyState {
  balances: DayBalance[];
  movements: Movement[];
  /** Mails « Notification transactions » déjà lus */
  alertMails?: string[];
}

const round = (n: number) => Math.round(n * 100) / 100;
/** En dessous, on ne pose pas de question (arrondis, frais minimes) */
export const THRESHOLD = 1;
/** Au premier relevé, seules les baisses récentes deviennent des questions */
export const ASK_WINDOW_DAYS = 10;

// ---------- Lecture du mail Bankin ----------

const ENTITIES: Record<string, string> = { '&amp;': '&', '&#39;': "'", '&quot;': '"', '&nbsp;': ' ', '&euro;': '€' };

/** Montant du solde dans l'aperçu du mail « Balance quotidienne », ou null. */
export function parseBankinSnippet(snippet: string): number | null {
  const s = snippet.replace(/&[#a-z0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ').replace(/[  ]/g, ' ');
  // Dernier montant « 1 234,56 € » avant « Consulter » (un seul compte suivi)
  const head = s.split(/Consulter/i)[0] ?? s;
  const all = [...head.matchAll(/([-−–]?\s?\d{1,3}(?:[ .]\d{3})*|[-−–]?\s?\d+),(\d{2})\s?€/g)];
  const m = all.at(-1);
  if (!m) return null;
  const neg = /^[-−–]/.test(m[1]!.trim());
  const units = m[1]!.replace(/[^\d]/g, '');
  const n = Number(`${units}.${m[2]}`);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const parisDay = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** "2026-11-03T07:02:15Z" → "2026-11-03" à l'heure de Paris */
export const parisDate = (iso: string) => parisDay.format(new Date(iso));

/** Ajoute les soldes lus (un par jour, le plus récent l'emporte), triés par date. */
export function mergeBalances(existing: DayBalance[], incoming: DayBalance[]): DayBalance[] {
  const byDay = new Map(existing.map((b) => [b.date, b]));
  for (const b of incoming) byDay.set(b.date, { date: b.date, amount: round(b.amount) });
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ---------- Explication des variations ----------

/** Date d'une dépense connue : jour du paiement, à défaut l'échéance */
export const billDay = (b: Bill) => b.paidDate ?? b.dueDate;

function incomesBetween(incomes: Income[], from: string, to: string): number {
  let total = 0;
  const months = new Set<string>();
  for (let d = from; d < to; d = addDays(d, 1)) months.add(d.slice(0, 7));
  for (const inc of incomes)
    for (const m of months) {
      const d = occurrenceIn(inc, m);
      if (d && d >= from && d < to) total += inc.amount;
    }
  return total;
}

/**
 * Recalcule les variations entre soldes successifs. Ce qui n'est expliqué ni par une
 * facture payée, ni par une rentrée, ni par une réponse déjà donnée devient :
 * une question (baisse récente), « Non précisé » (baisse ancienne) ou « Argent reçu ».
 * Idempotent : appelé après chaque relevé ou chaque réponse.
 */
export function reconcile(state: MoneyState, bills: Bill[], incomes: Income[], today: string, now = new Date().toISOString()): MoneyState {
  const { balances } = state;
  // Anciennes versions : une dépense « trouvée dans les mails » était classée sans accord.
  // Elle redevient une question, avec le mail proposé.
  const legacy = new Map<string, Movement['suggestion']>();
  for (const m of state.movements)
    if (m.status === 'done' && m.source === 'mail') legacy.set(`${m.from}_${m.to}`, { label: m.label, subject: '', url: m.mailUrl ?? null });
  // Les lignes rangées automatiquement sont recalculées à chaque fois
  const keep = state.movements.filter((m) => m.status === 'done' && m.source !== 'auto' && m.source !== 'mail');
  const pendingByWindow = new Map(state.movements.filter((m) => m.status === 'pending').map((m) => [`${m.from}_${m.to}`, m]));
  const proofBills = bills.filter(isProofBill);
  const proofIncomes = incomes.filter(isProofIncome);
  const out: Movement[] = [...keep];
  for (let i = 1; i < balances.length; i++) {
    const { date: from, amount: before } = balances[i - 1]!;
    const { date: to, amount: after } = balances[i]!;
    const key = `${from}_${to}`;
    // Seules les opérations prouvées expliquent une variation : reçus et relevés, pas les
    // échéances prévues (une rentrée attendue qui n'est pas arrivée créerait une fausse baisse)
    const paid = proofBills.filter((b) => billDay(b) >= from && billDay(b) < to).reduce((t, b) => t + b.amount, 0);
    const received = incomesBetween(proofIncomes, from, to);
    // Réponses, alertes Bankin et dépenses ajoutées à la main tombant dans cet intervalle
    const answered = keep.filter((m) => lastDayOf(m) >= from && lastDayOf(m) < to).reduce((t, m) => t + m.amount, 0);
    const rest = round(after - before - (received - paid) - answered);
    if (Math.abs(rest) < THRESHOLD) continue;
    const prev = pendingByWindow.get(key);
    if (rest > 0) {
      out.push({ id: `${key}_in`, from, to, amount: rest, label: 'Argent reçu', category: 'OTHER', status: 'done', source: 'auto', createdAt: now });
    } else if (prev || legacy.has(key) || daysBetween(to, today) <= ASK_WINDOW_DAYS) {
      const base: Movement = prev ?? { id: key, from, to, amount: rest, label: '', category: 'OTHER', status: 'pending', source: 'auto', searched: legacy.has(key), createdAt: now };
      out.push({ ...base, amount: rest, suggestion: base.suggestion === undefined ? (legacy.get(key) ?? undefined) : base.suggestion });
    } else {
      out.push({ id: `${key}_old`, from, to, amount: rest, label: 'Non précisé', category: 'OTHER', status: 'done', source: 'auto', createdAt: now });
    }
  }
  out.sort((a, b) => b.to.localeCompare(a.to) || a.id.localeCompare(b.id));
  return { ...state, balances, movements: out };
}

/** Facture qui prouve un débit : reçu ou prélèvement lu dans un mail, ligne de relevé importé. */
export const isProofBill = (b: Bill) => b.paid && (b.id.startsWith('mail-') || (b.notes ?? '').startsWith('Importée depuis ton relevé'));
/** Rentrée prouvée : ligne de relevé importé (les rentrées prévues ne comptent pas). */
export const isProofIncome = (i: Income) => i.recurrence === 'NONE' && (i.notes ?? '').startsWith('Importée depuis ton relevé');

/**
 * Réponse à une question : la dépense est rangée ; si le montant indiqué est plus
 * petit que la baisse, le reste redevient une question au prochain recalcul.
 */
export function answer(m: Movement, label: string, category: SpendCategory, amount = -m.amount, source: Movement['source'] = 'me', now = new Date().toISOString()): Movement {
  const value = Math.min(Math.abs(amount), Math.abs(m.amount));
  return {
    ...m,
    id: `${m.from}_${m.to}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    amount: -round(value),
    label: label.trim() || SPEND_LABELS[category],
    category,
    status: 'done',
    source,
    suggestion: undefined,
    createdAt: now,
  };
}

// ---------- Catégories ----------

const EXTRA_RULES: Array<{ category: SpendCategory; patterns: string[] }> = [
  { category: 'RESTAURANT', patterns: ['resto', 'restaurant', 'mcdo', 'mcdonald', 'burger', 'kfc', 'kebab', 'pizza', 'sushi', 'tacos', 'bar ', 'cafe', 'starbucks', 'brasserie', 'boulangerie', 'snack', 'crous resto', 'uber eats', 'deliveroo', 'soiree', 'boite', 'verre'] },
  { category: 'SHOPPING', patterns: ['amazon', 'zara', 'h&m', 'shein', 'vinted', 'decathlon', 'action', 'primark', 'nike', 'adidas', 'vetement', 'fringue', 'chaussure', 'shopping', 'cadeau', 'ikea', 'aliexpress', 'temu'] },
  { category: 'CASH', patterns: ['retrait', 'dab', 'especes', 'liquide', 'cash'] },
  { category: 'FOOD', patterns: ['courses', 'supermarche', 'spar', 'super u', 'geant', 'leader price', 'netto', 'aldi'] },
  { category: 'TRANSPORT', patterns: ['essence', 'bus', 'train', 'avion', 'air corsica', 'corsica linea', 'bateau', 'ferry', 'taxi', 'parking'] },
  { category: 'ENTERTAINMENT', patterns: ['jeu', 'cine', 'sport', 'salle', 'fortnite', 'psn'] },
];

/** Devine la catégorie d'une dépense décrite en quelques mots ("kebab", "Amazon", "essence"). */
export function categorizeLabel(label: string): SpendCategory {
  const name = ` ${normalize(label)} `;
  const extra = EXTRA_RULES.flatMap((r) => r.patterns.map((p) => ({ p, category: r.category })))
    .sort((a, b) => b.p.length - a.p.length)
    .find(({ p }) => (p.length <= 4 ? new RegExp(`[^a-z0-9]${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^a-z0-9]`).test(name) : name.includes(p)));
  const provider = categorizeProvider(label);
  // Un nom de fournisseur précis (Spotify, EDF...) l'emporte sur un mot général
  if (provider !== 'OTHER' && !(extra && extra.p.length > 5)) return provider;
  return extra?.category ?? provider;
}

// ---------- Dépenses du mois ----------

export interface Spend {
  id: string;
  date: string;
  label: string;
  amount: number;
  category: SpendCategory;
  kind: 'bill' | 'movement';
  pending?: boolean;
  source?: Movement['source'];
}

/** Toutes les sorties d'un mois (YYYY-MM) : factures payées + variations rangées ou en attente. */
export function spendsOf(month: string, bills: Bill[], movements: Movement[]): Spend[] {
  // Une facture marquée payée à la main et la baisse du solde qui lui correspond ne comptent qu'une fois
  const twin = (b: Bill) =>
    !isProofBill(b) && movements.some((m) => m.amount < 0 && Math.abs(-m.amount - b.amount) < 0.01 && Math.abs(daysBetween(lastDayOf(m), billDay(b))) <= 3);
  const fromBills: Spend[] = bills
    .filter((b) => b.paid && billDay(b).startsWith(month) && !twin(b))
    .map((b) => ({ id: b.id, date: billDay(b), label: b.provider || b.title, amount: b.amount, category: b.category, kind: 'bill' }));
  const fromMoves: Spend[] = movements
    .filter((m) => m.amount < 0 && lastDayOf(m).startsWith(month))
    .map((m) => ({
      id: m.id,
      date: lastDayOf(m),
      label: m.status === 'pending' ? 'À préciser' : m.label,
      amount: -m.amount,
      category: m.category,
      kind: 'movement',
      pending: m.status === 'pending',
      source: m.source,
    }));
  return [...fromBills, ...fromMoves].sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount);
}

/** Jour auquel on rattache une variation : la veille du mail qui l'a montrée */
export const lastDayOf = (m: Pick<Movement, 'from' | 'to'>) => (daysBetween(m.from, m.to) > 1 ? addDays(m.to, -1) : m.from);

export function byCategory(spends: Spend[]): { key: SpendCategory; label: string; value: number }[] {
  const totals = new Map<SpendCategory, number>();
  for (const s of spends) totals.set(s.category, (totals.get(s.category) ?? 0) + s.amount);
  return [...totals.entries()].map(([key, value]) => ({ key, label: SPEND_LABELS[key], value: round(value) })).sort((a, b) => b.value - a.value);
}

export const total = (spends: { amount: number }[]) => round(spends.reduce((t, s) => t + s.amount, 0));

/** Entrées d'un mois : rentrées déclarées + hausses de solde non expliquées */
export function incomeOf(month: string, incomes: Income[], movements: Movement[]): number {
  const declared = incomes.reduce((t, i) => t + (occurrenceIn(i, month) ? i.amount : 0), 0);
  const seen = movements.filter((m) => m.amount > 0 && lastDayOf(m).startsWith(month)).reduce((t, m) => t + m.amount, 0);
  return round(declared + seen);
}

// ---------- Reste à dépenser ----------

export function endOfMonth(day: string): string {
  const [y, m] = day.split('-').map(Number) as [number, number];
  return `${day.slice(0, 7)}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}

export interface DailyAllowance {
  balance: number;
  upcomingBills: number;
  upcomingIncome: number;
  savingsGoal: number;
  daysLeft: number;
  perDay: number;
}

/**
 * Ce qu'on peut dépenser par jour jusqu'à la fin du mois : solde, moins les factures
 * encore à payer ce mois-ci, plus les rentrées attendues, moins l'épargne visée.
 */
export function dailyAllowance(balance: number, today: string, bills: Bill[], incomes: Income[], savingsGoal: number | null): DailyAllowance {
  const end = endOfMonth(today);
  const upcomingBills = round(bills.filter((b) => !b.paid && b.dueDate >= today && b.dueDate <= end).reduce((t, b) => t + b.amount, 0));
  const upcomingIncome = round(
    incomes.reduce((t, i) => {
      const d = occurrenceIn(i, today.slice(0, 7));
      return t + (d && d > today ? i.amount : 0);
    }, 0),
  );
  const goal = Math.max(0, savingsGoal ?? 0);
  const daysLeft = daysBetween(today, end) + 1;
  const perDay = round(Math.max(0, balance - upcomingBills + upcomingIncome - goal) / daysLeft);
  return { balance, upcomingBills, upcomingIncome, savingsGoal: goal, daysLeft, perDay };
}

// ---------- Conseils ----------

export interface Insight {
  id: string;
  /** warn : à corriger ; good : ce qui va bien ; info : à savoir */
  tone: 'warn' | 'good' | 'info';
  title: string;
  detail: string;
}

const eur = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

/** Constats simples sur le mois en cours, comparé aux trois précédents. */
export function insights(opts: {
  today: string;
  bills: Bill[];
  incomes: Income[];
  movements: Movement[];
  balances: DayBalance[];
  savingsGoal: number | null;
  subscriptionsMonthly: number;
  subscriptionsCount: number;
}): Insight[] {
  const { today, bills, incomes, movements, balances } = opts;
  const month = today.slice(0, 7);
  const out: Insight[] = [];
  const prevMonths = [1, 2, 3].map((k) => {
    const d = new Date(`${month}-15T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - k);
    return d.toISOString().slice(0, 7);
  });
  const spends = spendsOf(month, bills, movements);
  const spent = total(spends);
  const day = Number(today.slice(8, 10));
  const daysInMonth = Number(endOfMonth(today).slice(8, 10));
  const history = prevMonths.map((m) => total(spendsOf(m, bills, movements))).filter((v) => v > 0);
  const avg = history.length ? history.reduce((a, b) => a + b, 0) / history.length : 0;

  // Rythme du mois
  if (avg > 0 && day >= 5) {
    const projected = (spent / day) * daysInMonth;
    if (projected > avg * 1.1)
      out.push({
        id: 'pace',
        tone: 'warn',
        title: `Tu dépenses plus vite que d'habitude`,
        detail: `${eur(spent)} en ${day} jours. À ce rythme, ${eur(projected)} sur le mois, contre ${eur(avg)} en moyenne.`,
      });
    else out.push({ id: 'pace', tone: 'good', title: 'Rythme de dépenses sous contrôle', detail: `${eur(spent)} en ${day} jours, ta moyenne mensuelle est de ${eur(avg)}.` });
  }

  // Catégorie qui dérape
  const cats = byCategory(spends);
  for (const c of cats.slice(0, 4)) {
    const past = prevMonths.map((m) => total(spendsOf(m, bills, movements).filter((s) => s.category === c.key)));
    const pastAvg = past.reduce((a, b) => a + b, 0) / (history.length || 1);
    if (history.length && c.value > pastAvg * 1.3 && c.value - pastAvg > 20) {
      out.push({
        id: `cat-${c.key}`,
        tone: 'warn',
        title: `${c.label} : ${eur(c.value)} ce mois-ci`,
        detail: pastAvg > 0 ? `C'est ${eur(c.value - pastAvg)} de plus que ta moyenne (${eur(pastAvg)}).` : `Tu n'avais presque rien dépensé dans cette catégorie les mois précédents.`,
      });
      break;
    }
  }

  // Petites dépenses
  const small = spends.filter((s) => s.amount < 10 && s.kind === 'movement' && !s.pending);
  if (small.length >= 5)
    out.push({
      id: 'small',
      tone: 'warn',
      title: `${small.length} petites dépenses font ${eur(total(small))}`,
      detail: `Les achats de moins de 10 € passent inaperçus mais s'additionnent. Fixe-toi une limite par semaine.`,
    });

  // Plus grosse dépense
  const biggest = [...spends].filter((s) => !s.pending).sort((a, b) => b.amount - a.amount)[0];
  if (biggest && spent > 0 && biggest.amount / spent > 0.3 && spends.length > 2)
    out.push({ id: 'big', tone: 'info', title: `Ta plus grosse dépense : ${biggest.label}`, detail: `${eur(biggest.amount)}, soit ${Math.round((biggest.amount / spent) * 100)} % du mois.` });

  // Abonnements
  if (opts.subscriptionsCount > 0)
    out.push({
      id: 'subs',
      tone: opts.subscriptionsMonthly > 30 ? 'warn' : 'info',
      title: `${opts.subscriptionsCount} abonnement${opts.subscriptionsCount > 1 ? 's' : ''} : ${eur(opts.subscriptionsMonthly)} par mois`,
      detail: `Soit ${eur(opts.subscriptionsMonthly * 12)} par an. Garde seulement ceux que tu utilises chaque semaine.`,
    });

  // Solde bas
  const last = balances.at(-1);
  if (last) {
    const allowance = dailyAllowance(last.amount, today, bills, incomes, opts.savingsGoal);
    if (allowance.perDay < 5)
      out.push({
        id: 'low',
        tone: 'warn',
        title: `Fin de mois serrée`,
        detail: `Après tes factures à venir${allowance.savingsGoal ? ' et ton épargne' : ''}, il te reste ${eur(allowance.perDay)} par jour jusqu'au ${Number(endOfMonth(today).slice(8))}.`,
      });
  }

  // Bilan entrées / sorties
  const income = incomeOf(month, incomes, movements);
  if (income > 0 && day >= 20) {
    const saved = income - spent;
    out.push(
      saved >= (opts.savingsGoal ?? 0)
        ? { id: 'net', tone: 'good', title: `Tu es dans le vert : ${eur(saved)} de côté ce mois-ci`, detail: `Entrées ${eur(income)}, sorties ${eur(spent)}.` }
        : { id: 'net', tone: 'warn', title: `Sorties supérieures à ton objectif`, detail: `Entrées ${eur(income)}, sorties ${eur(spent)}${opts.savingsGoal ? `, objectif d'épargne ${eur(opts.savingsGoal)}` : ''}.` },
    );
  }

  const pending = movements.filter((m) => m.status === 'pending');
  if (pending.length)
    out.push({ id: 'pending', tone: 'info', title: `${pending.length} baisse${pending.length > 1 ? 's' : ''} à préciser`, detail: `Dis-moi ce que c'était pour que les catégories restent justes.` });

  const order = { warn: 0, info: 1, good: 2 } as const;
  return out.sort((a, b) => order[a.tone] - order[b.tone]);
}

// ---------- Alertes de transactions Bankin ----------

export interface BankinOperation {
  label: string;
  /** négatif : dépense */
  amount: number;
  date: string;
  bankinCategory: string;
}

const MONTHS = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre'];

const toAmount = (raw: string) => {
  const neg = /^[-−–]/.test(raw.trim());
  const [units, cents] = raw.split(',') as [string, string];
  const n = Number(`${units.replace(/[^\d]/g, '')}.${cents.replace(/[^\d]/g, '').slice(0, 2)}`);
  return neg ? -n : n;
};

/**
 * Opérations du mail Bankin « Notification transactions » (texte brut du mail) :
 * une ligne « libellé | montant », puis la date, puis le compte et la catégorie Bankin.
 */
export function parseBankinAlert(text: string): BankinOperation[] {
  const lines = text
    .replace(/\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/[\u00a0\u202f]/g, ' ')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^\|[\s|]*\|$/.test(l));
  const ops: BankinOperation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const row = /^\|\s*(.+?)\s*\|\s*\|\s*([-−–+]?\s?\d[\d .]*,\d{2})\s?€\s*\|$/.exec(lines[i]!);
    if (!row) continue;
    const dateLine = lines[i + 1] ?? '';
    const d = /(\d{1,2})\s+([a-zéû]+)\s+(\d{4})/i.exec(normalize(dateLine));
    if (!d) continue;
    const month = MONTHS.indexOf(d[2]!);
    if (month < 0) continue;
    const date = `${d[3]}-${String(month + 1).padStart(2, '0')}-${d[1]!.padStart(2, '0')}`;
    const meta = (lines[i + 2] ?? '').replace(/^\|\s*|\s*\|$/g, '');
    // « Mr Prénom Nom Catégorie » : la catégorie Bankin suit le titulaire du compte
    const bankinCategory = meta.replace(/^(mr|mme|mlle|m\.|monsieur|madame)\s+\S+\s+\S+\s*/i, '').trim();
    ops.push({ label: row[1]!.replace(/\s*\.\.\.$/, '').replace(/\s+/g, ' ').trim(), amount: toAmount(row[2]!), date, bankinCategory });
    i += 2;
  }
  return ops;
}

const BANKIN_CATEGORIES: Array<[RegExp, SpendCategory]> = [
  [/restau|fast.?food|bar|cafe/, 'RESTAURANT'],
  [/aliment|supermarche|courses/, 'FOOD'],
  [/shopping|vetement|high.?tech|achat/, 'SHOPPING'],
  [/abonnement|multimedia|internet|telephon/, 'SUBSCRIPTION'],
  [/transport|auto|carburant|essence|peage|parking|train|avion/, 'TRANSPORT'],
  [/loisir|sortie|sport|voyage|culture/, 'ENTERTAINMENT'],
  [/sante|pharmacie|medecin|mutuelle/, 'HEALTH'],
  [/logement|loyer|energie|electricite|eau/, 'HOUSING'],
  [/retrait|especes|dab/, 'CASH'],
  [/assurance/, 'INSURANCE'],
];

/** Catégorie d'une opération Bankin : celle de Bankin si elle parle, sinon le libellé. */
export function categorizeOperation(op: Pick<BankinOperation, 'label' | 'bankinCategory'>): SpendCategory {
  // La catégorie donnée par Bankin d'abord ; le nom du commerçant seulement si elle ne dit rien
  const cat = normalize(op.bankinCategory);
  const matches = BANKIN_CATEGORIES.filter(([re]) => re.test(cat)).map(([, c]) => c);
  if (matches.length === 1) return matches[0]!;
  // Catégorie large (« Alimentation & Restau. ») : le commerçant tranche, sinon la première
  const fromLabel = categorizeLabel(op.label);
  if (matches.length > 1) return matches.includes(fromLabel) ? fromLabel : matches.includes('FOOD') ? 'FOOD' : matches[0]!;
  return fromLabel;
}

/** Opération exacte → ligne rangée (rattachée au jour de l'opération). */
export function movementFromOperation(op: BankinOperation, id: string, now = new Date().toISOString()): Movement {
  const label = op.label.trim();
  return {
    id,
    from: op.date,
    to: addDays(op.date, 1),
    amount: op.amount,
    label: label || op.bankinCategory || 'Opération',
    category: op.amount > 0 ? 'OTHER' : categorizeOperation(op),
    status: 'done',
    source: 'bankin',
    createdAt: now,
  };
}
