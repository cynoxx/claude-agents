// Lecture d'un relevé bancaire exporté (CSV de La Banque Postale, de Bankin ou d'une
// autre banque, ou fichier OFX) et préparation de l'import : les débits deviennent des
// factures payées, les crédits des rentrées ponctuelles. Tout se passe dans le navigateur.

export interface BankTransaction {
  /** YYYY-MM-DD */
  date: string;
  label: string;
  /** Négatif pour une dépense */
  amount: number;
}

export interface ParsedStatement {
  format: 'csv' | 'ofx';
  transactions: BankTransaction[];
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Texte du fichier : UTF-8, ou Windows-1252 pour les exports des banques françaises. */
export function decodeStatement(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** "1 234,56", "-12.30", "+5,00 €", "1.234,56" → nombre ; NaN si ce n'en est pas un. */
export function parseAmount(raw: string): number {
  let s = raw.replace(/["\s  €]|EUR/gi, '');
  if (!s) return NaN;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || s.endsWith('-');
  s = s.replace(/[()+-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
  const n = Number(s);
  return round(negative ? -n : n);
}

/** "02/11/2026", "2/11/26", "2026-11-02", "20261102" → "2026-11-02" ; null sinon. */
export function parseDate(raw: string): string | null {
  const s = raw.trim().replace(/^"|"$/g, '');
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
    const month = Number(m[2]);
    const day = Number(m[1]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  return null;
}

function splitLine(line: string, sep: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === sep && !quoted) {
      cells.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  cells.push(cur.trim());
  return cells;
}

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/** Rôle d'une colonne d'après son en-tête. */
function columnRole(header: string): 'date' | 'label' | 'amount' | 'debit' | 'credit' | null {
  const h = norm(header);
  if (/date (de )?valeur|value date/.test(h)) return null;
  if (/^date|date (de l'?)?operation|date comptable|booking/.test(h)) return 'date';
  if (/debit/.test(h)) return 'debit';
  if (/credit/.test(h)) return 'credit';
  if (/montant|amount|somme/.test(h) && !/franc/.test(h)) return 'amount';
  if (/libelle|description|intitule|label|detail|operation|nature|wording|beneficiaire|payee/.test(h)) return 'label';
  return null;
}

function parseCsv(text: string): BankTransaction[] {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    const line = lines[i]!;
    const sep = [';', '\t', ','].sort((a, b) => line.split(b).length - line.split(a).length)[0]!;
    const headers = splitLine(line, sep);
    if (headers.length < 2) continue;
    const roles = headers.map(columnRole);
    const col = (r: string) => roles.indexOf(r as never);
    const date = col('date');
    const amount = col('amount');
    const debit = col('debit');
    const credit = col('credit');
    if (date < 0 || (amount < 0 && debit < 0 && credit < 0)) continue;
    // Libellé : la colonne reconnue, sinon les autres colonnes de texte réunies
    const labelCols = roles.map((r, k) => (r === 'label' ? k : -1)).filter((k) => k >= 0);
    const out: BankTransaction[] = [];
    for (const row of lines.slice(i + 1)) {
      if (!row.trim()) continue;
      const cells = splitLine(row, sep);
      const d = parseDate(cells[date] ?? '');
      if (!d) continue;
      let value = amount >= 0 ? parseAmount(cells[amount] ?? '') : NaN;
      if (!Number.isFinite(value)) {
        const deb = debit >= 0 ? parseAmount(cells[debit] ?? '') : NaN;
        const cre = credit >= 0 ? parseAmount(cells[credit] ?? '') : NaN;
        if (Number.isFinite(deb) && deb !== 0) value = -Math.abs(deb);
        else if (Number.isFinite(cre) && cre !== 0) value = Math.abs(cre);
      }
      if (!Number.isFinite(value) || value === 0) continue;
      const label = labelCols
        .map((k) => cells[k] ?? '')
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      out.push({ date: d, label: label || 'Opération', amount: value });
    }
    if (out.length) return out;
  }
  return [];
}

function parseOfx(text: string): BankTransaction[] {
  const out: BankTransaction[] = [];
  const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1]?.trim() ?? '';
  for (const block of text.split(/<STMTTRN>/i).slice(1)) {
    const date = parseDate(tag(block, 'DTPOSTED'));
    const amount = parseAmount(tag(block, 'TRNAMT'));
    if (!date || !Number.isFinite(amount) || amount === 0) continue;
    const label = [tag(block, 'NAME'), tag(block, 'MEMO')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    out.push({ date, label: label || 'Opération', amount });
  }
  return out;
}

export function parseStatement(text: string): ParsedStatement {
  if (/<OFX>|<STMTTRN>/i.test(text)) return { format: 'ofx', transactions: parseOfx(text) };
  return { format: 'csv', transactions: parseCsv(text) };
}

/** Nom lisible du commerçant : sans "ACHAT CB", numéro de carte ni date. */
export function merchantName(label: string): string {
  const cleaned = label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(achat|paiement|prlv|prelevement|prelvt|carte|cb|sepa|virement|vir|recu|emis|instantane|europeen|permanent)\b\.?/gi, ' ')
    .replace(/\b(de|du|des|par|en faveur de)\b/gi, ' ')
    .replace(/\b(carte|numero|n°|no)\s*\S*\d\S*/gi, ' ')
    .replace(/\b(s\.?a\.?r\.?l|sas|s\.?a|et cie|s\.?c\.?a|europe)\b\.?/gi, ' ')
    .replace(/\b[x*]{0,4}\d{4,}\b/gi, ' ')
    .replace(/\b\d{1,2}[/.]\d{1,2}([/.]\d{2,4})?\b/g, ' ')
    .replace(/\b(paypal|sumup|zettle|stripe)\s*\*\s*/gi, '')
    .replace(/\*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const name = cleaned || label.trim() || 'Opération';
  return name
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (c) => c.toUpperCase())
    .slice(0, 80);
}

/** Clé stable d'une opération : un même relevé importé deux fois n'ajoute rien. */
export function transactionKey(t: BankTransaction, occurrence: number): string {
  return `releve:${t.date}:${t.amount.toFixed(2)}:${norm(t.label).replace(/[^a-z0-9]/g, '').slice(0, 40)}:${occurrence}`;
}

export interface ExistingBill {
  amount: number;
  dueDate: string;
  paidDate: string | null;
  reference: string | null;
}
export interface ExistingIncome {
  amount: number;
  date: string;
  notes: string | null;
}

export interface ImportPlan {
  expenses: Array<BankTransaction & { key: string; provider: string }>;
  incomes: Array<BankTransaction & { key: string; provider: string }>;
  /** Déjà importées, ou déjà saisies à la main (même montant à 3 jours près) */
  skipped: number;
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

export function planImport(transactions: BankTransaction[], bills: ExistingBill[], incomes: ExistingIncome[]): ImportPlan {
  const known = new Set<string>();
  for (const b of bills) if (b.reference?.startsWith('releve:')) known.add(b.reference);
  for (const i of incomes) {
    const key = /releve:[^\s]+/.exec(i.notes ?? '')?.[0];
    if (key) known.add(key);
  }
  // Factures saisies ailleurs (à la main, depuis les mails) : chacune n'absorbe qu'une opération
  const manualBills = bills.filter((b) => !b.reference?.startsWith('releve:')).map((b) => ({ ...b, used: false }));
  const manualIncomes = incomes.filter((i) => !/releve:/.test(i.notes ?? '')).map((i) => ({ ...i, used: false }));

  const plan: ImportPlan = { expenses: [], incomes: [], skipped: 0 };
  const seen = new Map<string, number>();
  const sorted = [...transactions].sort((a, b) => a.date.localeCompare(b.date));
  for (const t of sorted) {
    const base = transactionKey(t, 0);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    const key = transactionKey(t, n);
    if (known.has(key)) {
      plan.skipped++;
      continue;
    }
    const provider = merchantName(t.label);
    if (t.amount < 0) {
      const amount = -t.amount;
      const twin = manualBills.find((b) => !b.used && Math.abs(b.amount - amount) < 0.005 && daysApart(b.paidDate ?? b.dueDate, t.date) <= 3);
      if (twin) {
        twin.used = true;
        plan.skipped++;
        continue;
      }
      plan.expenses.push({ ...t, key, provider });
    } else {
      const twin = manualIncomes.find((i) => !i.used && Math.abs(i.amount - t.amount) < 0.005 && daysApart(i.date, t.date) <= 3);
      if (twin) {
        twin.used = true;
        plan.skipped++;
        continue;
      }
      plan.incomes.push({ ...t, key, provider });
    }
  }
  return plan;
}
