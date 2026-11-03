import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { money, refreshMovements, syncBankin, type SyncResult } from '../../standalone/bankin';
import type { Movement } from '../../standalone/money';
import { currentState, onStateChange, scheduleSave, stateVersion } from '../../standalone/vault';
import { localToday } from '../../utils/dates';
import { EMPTY_PLAN } from '../../utils/plan';
import { groupSubscriptions } from '../../utils/subscriptions';

/** État du coffre, relu à chaque modification. */
export function useVault() {
  const version = useSyncExternalStore(onStateChange, stateVersion);
  const qc = useQueryClient();
  // Les anciennes pages (Factures, Revenus...) lisent via React Query : on les prévient
  useEffect(() => {
    if (version) void qc.invalidateQueries();
  }, [version, qc]);
  return useMemo(() => {
    const s = currentState();
    const today = localToday();
    const subs = groupSubscriptions(s.bills, today).filter((x) => x.active);
    return {
      version,
      today,
      state: s,
      bills: s.bills,
      incomes: s.incomes ?? [],
      money: money(s),
      plan: s.plan ?? EMPTY_PLAN,
      subscriptionsMonthly: Math.round(subs.reduce((t, x) => t + x.monthly, 0) * 100) / 100,
      subscriptionsCount: subs.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}

/** Remplace une ligne de variation (réponse, correction) puis recalcule. */
export function replaceMovement(old: Movement, next: Movement | Movement[] | null) {
  const s = currentState();
  const list = money(s).movements;
  const i = list.findIndex((m) => m.id === old.id);
  if (i >= 0) list.splice(i, 1, ...(next ? (Array.isArray(next) ? next : [next]) : []));
  else if (next) list.push(...(Array.isArray(next) ? next : [next]));
  refreshMovements(s);
  scheduleSave();
}

export function addMovement(m: Movement) {
  const s = currentState();
  money(s).movements.push(m);
  refreshMovements(s);
  scheduleSave();
}

/** Relevé Bankin : une fois à l'ouverture, puis à la demande. */
let syncedOnce = false;
let lastResult: SyncResult | null = null;
export function useBankinSync() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(lastResult);
  const run = useCallback(async () => {
    setBusy(true);
    try {
      lastResult = await syncBankin();
      setResult(lastResult);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (syncedOnce) return;
    syncedOnce = true;
    void run();
  }, [run]);
  return { busy, result, run };
}
