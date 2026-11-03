// Lecture des mails depuis la page, avec le connecteur Gmail de la personne qui l'ouvre.
// Seuls deux usages : le solde du mail Bankin « Balance quotidienne », et la recherche
// d'un mail qui expliquerait une baisse (reçu, facture) du même montant.
import { addDays, localToday } from '../utils/dates';
import { answer, categorizeLabel, mergeBalances, movementFromOperation, parseBankinAlert, parisDate, parseBankinSnippet, reconcile, SPEND_LABELS, type DayBalance, type MoneyState, type Movement, type SpendCategory } from './money';
import type { State } from './storage';
import { getBackend } from './storage';
import { currentState, scheduleSave } from './vault';

const SERVER = 'Gmail';
const TOOL = 'search_threads';
const MAX_SEARCHES = 6;

interface Mcp {
  callTool(server: string, tool: string, input?: unknown, opts?: unknown): Promise<{ payload?: unknown }>;
}
interface Sample {
  (input: string, opts?: Record<string, unknown>): Promise<{ text: string }>;
  json<T>(input: string, opts?: Record<string, unknown>): Promise<T>;
}
type Runtime = { use(name: string): Promise<unknown> };
const runtime = () => (window as unknown as { claude?: Runtime }).claude;

let mcpPromise: Promise<Mcp | null> | null = null;
export function getMcp(): Promise<Mcp | null> {
  mcpPromise ??= runtime()?.use ? (runtime()!.use('mcp') as Promise<Mcp | null>).catch(() => null) : Promise.resolve(null);
  return mcpPromise;
}
let samplePromise: Promise<Sample | null> | null = null;
export function getSample(): Promise<Sample | null> {
  samplePromise ??= runtime()?.use ? (runtime()!.use('sample') as Promise<Sample | null>).catch(() => null) : Promise.resolve(null);
  return samplePromise;
}

interface GmailMessage {
  id?: string;
  date?: string;
  snippet?: string;
  subject?: string;
  sender?: string;
  viewUrl?: string;
  addressDisplayNames?: { displayName?: string; emailAddress?: string }[];
}
interface GmailSearch {
  threads?: { id?: string; viewUrl?: string; messages?: GmailMessage[] }[];
  nextPageToken?: string;
}

async function search(mcp: Mcp, query: string, pageSize = 50, pageToken?: string): Promise<GmailSearch> {
  const res = await mcp.callTool(SERVER, TOOL, { query, pageSize, ...(pageToken ? { pageToken } : {}) });
  const p = res.payload;
  return p && typeof p === 'object' ? (p as GmailSearch) : {};
}

export type SyncResult =
  | { ok: true; added: number; last: DayBalance | null }
  | { ok: false; reason: 'unavailable' | 'not_connected' | 'denied' | 'reauth' | 'error'; message?: string };

function reason(e: unknown): SyncResult {
  const code = (e as { code?: string })?.code;
  if (code === 'server_not_connected' || code === 'selection_required' || code === 'server_not_found') return { ok: false, reason: 'not_connected' };
  if (code === 'needs_reauth') return { ok: false, reason: 'reauth' };
  if (code === 'not_in_manifest' || code === 'approval_required' || code === 'not_granted' || code === 'blocked_by_policy' || code === 'consent_required')
    return { ok: false, reason: 'denied' };
  if (code === 'capability_disabled' || code === 'capability_removed') return { ok: false, reason: 'unavailable' };
  return { ok: false, reason: 'error', message: (e as { message?: string })?.message };
}

export function money(s: State): MoneyState {
  s.money ??= { balances: [], movements: [] };
  return s.money;
}

/** Recalcule les variations après un changement (relevé, réponse, facture ajoutée). */
export function refreshMovements(s: State = currentState()) {
  // Mise à jour sur place : les références déjà prises sur s.money restent valables
  Object.assign(money(s), reconcile(money(s), s.bills, s.incomes ?? [], localToday()));
}

let running: Promise<SyncResult> | null = null;

/** Lit les nouveaux soldes Bankin, recalcule les variations, cherche les dépenses dans les mails. */
export function syncBankin(): Promise<SyncResult> {
  running ??= doSync().finally(() => (running = null));
  return running;
}

async function doSync(): Promise<SyncResult> {
  const s = currentState();
  const m = money(s);
  // 1. Soldes déjà relevés par le tri du matin (fonctionne même sans accès Gmail depuis la page)
  const stored = await (await getBackend()).listBalances().catch(() => []);
  if (stored.length) {
    m.balances = mergeBalances(m.balances, stored);
    refreshMovements(s);
    scheduleSave();
  }
  // 2. Mails Bankin plus récents, lus directement
  const mcp = await getMcp();
  if (!mcp) return stored.length ? { ok: true, added: stored.length, last: m.balances.at(-1) ?? null } : { ok: false, reason: 'unavailable' };
  const lastKnown = m.balances.at(-1)?.date;
  const since = lastKnown ? `after:${addDays(lastKnown, -2).replaceAll('-', '/')}` : 'newer_than:75d';
  const found: DayBalance[] = [];
  try {
    let token: string | undefined;
    for (let page = 0; page < (lastKnown ? 2 : 3); page++) {
      const res = await search(mcp, `from:ne-pas-repondre@bankin.com subject:"Balance quotidienne" ${since}`, 50, token);
      for (const t of res.threads ?? [])
        for (const msg of t.messages ?? []) {
          if (!msg.date || !msg.snippet || !/bankin/i.test(msg.sender ?? '')) continue;
          const amount = parseBankinSnippet(msg.snippet);
          if (amount !== null) found.push({ date: parisDate(msg.date), amount });
        }
      token = res.nextPageToken;
      if (!token) break;
    }
  } catch (e) {
    // Les soldes du tri du matin suffisent à afficher la page
    if (stored.length) return { ok: true, added: 0, last: m.balances.at(-1) ?? null };
    return reason(e);
  }
  await readAlerts(mcp).catch((e) => console.error('[alertes Bankin]', e));
  // refreshMovements remplace l'objet : on relit l'état à jour
  const cur = money(s);
  const before = cur.balances.length;
  cur.balances = mergeBalances(cur.balances, found);
  refreshMovements(s);
  scheduleSave();
  await lookInMails(mcp).catch((e) => console.error('[mails]', e));
  return { ok: true, added: cur.balances.length - before, last: money(currentState()).balances.at(-1) ?? null };
}

/**
 * Alertes « Notification transactions » de Bankin : chaque opération y figure avec son
 * libellé exact, son montant, sa date et sa catégorie Bankin. Elles sont rangées telles
 * quelles, et la baisse du solde correspondante n'est plus une question.
 */
async function readAlerts(mcp: Mcp) {
  const m = money(currentState());
  const seen = new Set(m.alertMails ?? []);
  const since = seen.size ? 'newer_than:20d' : 'newer_than:75d';
  const res = await search(mcp, `from:ne-pas-repondre@bankin.com subject:"Notification transactions" ${since}`, 50);
  const ids = (res.threads ?? []).map((t) => t.id).filter((id): id is string => !!id && !seen.has(id)).slice(0, 25);
  let added = 0;
  for (const id of ids) {
    let text = '';
    try {
      const r = await mcp.callTool(SERVER, 'get_thread', { threadId: id, messageFormat: 'PLAIN_TEXT' });
      const p = r.payload as { messages?: { plaintextBody?: string }[] } | undefined;
      text = (p?.messages ?? []).map((x) => x.plaintextBody ?? '').join('\n');
    } catch {
      return; // accès refusé ou connecteur indisponible : on réessaiera au prochain relevé
    }
    const ops = parseBankinAlert(text);
    const list = money(currentState()).movements;
    ops.forEach((op, n) => {
      const mid = `bk_${id}_${n}`;
      if (!list.some((x) => x.id === mid)) {
        list.push(movementFromOperation(op, mid));
        added++;
      }
    });
    seen.add(id);
  }
  m.alertMails = [...seen].slice(-1000);
  if (added) {
    refreshMovements();
    scheduleSave();
  }
}

const fmt = (n: number) => n.toFixed(2);

/** Pour chaque baisse en attente, cherche un mail du même montant (reçu, facture) autour de ces dates. */
async function lookInMails(mcp: Mcp) {
  const s = currentState();
  const m = money(s);
  const todo = m.movements.filter((x) => x.status === 'pending' && !x.searched).slice(0, MAX_SEARCHES);
  for (const mv of todo) {
    const value = Math.abs(mv.amount);
    const after = addDays(mv.from, -2).replaceAll('-', '/');
    const before = addDays(mv.to, 1).replaceAll('-', '/');
    const q = `after:${after} before:${before} -from:bankin.com ("${fmt(value).replace('.', ',')}" OR "${fmt(value)}")`;
    let hit: { label: string; subject: string; url: string | null } | null = null;
    try {
      const res = await search(mcp, q, 5);
      for (const t of res.threads ?? []) {
        const msg = t.messages?.[0];
        if (!msg) continue;
        const name = msg.addressDisplayNames?.[0]?.displayName || (msg.sender ?? '').split('@')[1]?.split('.')[0] || '';
        hit = { label: name.trim(), subject: (msg.subject ?? '').trim(), url: msg.viewUrl ?? t.viewUrl ?? null };
        break;
      }
    } catch {
      return; // le connecteur ne répond plus : on retentera au prochain relevé
    }
    // L'état a pu changer pendant la recherche (réponse de l'utilisateur)
    const cur = money(currentState()).movements.find((x) => x.id === mv.id && x.status === 'pending');
    if (!cur) continue;
    if (hit && hit.label) {
      const category = categorizeLabel(`${hit.label} ${hit.subject}`);
      const done: Movement = { ...answer(cur, hit.label, category, value, 'mail'), mailUrl: hit.url };
      const list = money(currentState()).movements;
      list.splice(list.indexOf(cur), 1, done);
    } else cur.searched = true;
  }
  refreshMovements();
  scheduleSave();
}

/** Catégorie d'une réponse libre : règles locales, puis Claude si elles ne suffisent pas. */
export async function guessCategory(label: string): Promise<SpendCategory> {
  const local = categorizeLabel(label);
  if (local !== 'OTHER' || !label.trim()) return local;
  const sample = await getSample();
  if (!sample) return local;
  const keys = Object.keys(SPEND_LABELS) as SpendCategory[];
  try {
    const r = await sample.json<{ category?: string }>(
      `Classe cette dépense d'un étudiant en France dans une catégorie. Dépense : "${label.slice(0, 120)}".\nCatégories : ${keys
        .map((k) => `${k} (${SPEND_LABELS[k]})`)
        .join(', ')}.\nRéponds uniquement en JSON : {"category": "CLE"}`,
      { modelTier: 'quick' },
    );
    return keys.includes(r?.category as SpendCategory) ? (r.category as SpendCategory) : local;
  } catch {
    return local;
  }
}

/** Le tri du matin ne reposera pas la question pour ce jour-là. */
export function markAnswered(m: Pick<Movement, 'to'>) {
  void getBackend()
    .then((b) => b.markAnswered(m.to))
    .catch(() => {});
}
