import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { billService } from "../../services/billService";
import { incomeService } from "../../services/incomeService";
import { planService } from "../../services/planService";
import type { IncomeInput } from "../../types";
import { monthsEndingAt } from "../../utils/balance";
import { CATEGORIES, RECURRENCES } from "../../utils/categories";
import { localToday } from "../../utils/dates";
import { eur } from "../../utils/format";
import {
  AID_STATUS,
  AIDS,
  categoryDrift,
  IDEAS,
  monthlyCost,
  recurringBills,
  type AidStatus,
  type PlanState,
} from "../../utils/plan";
import { IncomeForm } from "../Incomes/IncomeForm";
import { PageTitle } from "../Layout/Layout";
import {
  Card,
  CardHeader,
  EmptyState,
  ErrorMessage,
  Input,
  Select,
  Spinner,
} from "../ui";

/** Programme pour gagner plus et dépenser moins : épargne, abonnements, aides, pistes. */
export function PlanPage() {
  const qc = useQueryClient();
  const plan = useQuery({ queryKey: ["plan"], queryFn: planService.get });
  const bills = useQuery({
    queryKey: ["bills", { status: "all" }],
    queryFn: () => billService.list({ status: "all" }),
  });
  const balance = useQuery({
    queryKey: ["balance", 6],
    queryFn: () => incomeService.balance(6),
  });
  const save = useMutation({
    mutationFn: planService.save,
    onMutate: (next) => qc.setQueryData(["plan"], next),
    onSuccess: (saved) => qc.setQueryData(["plan"], saved),
  });
  const [incomePreset, setIncomePreset] = useState<Partial<IncomeInput> | null>(
    null,
  );

  if (plan.isLoading || bills.isLoading || balance.isLoading)
    return <Spinner />;
  if (plan.error || bills.error || balance.error)
    return <ErrorMessage error={plan.error ?? bills.error ?? balance.error} />;

  const p = plan.data!;
  const update = (patch: Partial<PlanState>) => save.mutate({ ...p, ...patch });
  const month = localToday().slice(0, 7);
  const current = balance.data![balance.data!.length - 1]!;
  const recurring = recurringBills(bills.data!);
  const drift = categoryDrift(
    bills.data!,
    month,
    monthsEndingAt(month, 4).slice(0, 3),
  ).slice(0, 5);
  const done = IDEAS.filter((i) => p.ideas[i.id]).length;

  return (
    <>
      <PageTitle
        title="Plan"
        subtitle="Gagner un peu plus, dépenser un peu moins, sans y passer des heures"
      />

      <div className="grid items-start gap-4 lg:grid-cols-2 [&>*]:min-w-0">
        <SavingsCard
          goal={p.savingsGoal}
          income={current.income}
          expenses={current.expenses}
          onGoal={(savingsGoal) => update({ savingsGoal })}
        />

        <Card>
          <CardHeader
            title="Où part l’argent ce mois-ci"
            action={
              <span className="text-xs text-muted">
                face à ta moyenne des 3 mois d’avant
              </span>
            }
          />
          {drift.length === 0 ? (
            <EmptyState>
              Pas encore de dépenses. Importe un relevé depuis{" "}
              <Link to="/factures" className="underline underline-offset-2">
                Factures
              </Link>{" "}
              pour les voir ici.
            </EmptyState>
          ) : (
            <ul className="space-y-3 px-5 pb-5 pt-2 text-sm">
              {drift.map((d) => {
                const over = d.average > 0 && d.current > d.average * 1.2;
                const max = Math.max(
                  ...drift.map((x) => Math.max(x.current, x.average)),
                  1,
                );
                return (
                  <li key={d.category}>
                    <div className="flex justify-between gap-3">
                      <span>{CATEGORIES[d.category].label}</span>
                      <span className="tabular-nums">
                        {eur(d.current)}{" "}
                        <span className="text-xs text-muted">
                          / moy. {eur(d.average)}
                        </span>
                      </span>
                    </div>
                    <div className="relative mt-1.5 h-[7px] rounded-full bg-track">
                      <div
                        className={`h-full rounded-full ${over ? "bg-orange-500" : "bg-ink"}`}
                        style={{
                          width: `${Math.max(2, (d.current / max) * 100)}%`,
                        }}
                      />
                      {d.average > 0 && (
                        <div
                          className="absolute top-[-3px] h-[13px] w-[2px] rounded-full bg-muted"
                          style={{ left: `${(d.average / max) * 100}%` }}
                        />
                      )}
                    </div>
                    {over && (
                      <div className="mt-1 text-xs text-orange-400">
                        {Math.round((d.current / d.average - 1) * 100)} %
                        au-dessus de d’habitude
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <SubscriptionsCard
          bills={recurring}
          toCancel={p.toCancel}
          onToggle={(id) =>
            update({ toCancel: { ...p.toCancel, [id]: !p.toCancel[id] } })
          }
        />

        <Card>
          <CardHeader
            title="Aides à demander"
            action={
              <span className="text-xs text-muted">
                {AIDS.filter((a) => p.aids[a.id] === "GRANTED").length}{" "}
                obtenue(s)
              </span>
            }
          />
          <ul className="divide-y divide-white/5">
            {AIDS.map((a) => {
              const status = p.aids[a.id] ?? "TODO";
              return (
                <li
                  key={a.id}
                  className={`px-5 py-3 ${status === "NOT_ELIGIBLE" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <a
                        href={a.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm font-medium hover:underline"
                      >
                        {a.title} ↗
                      </a>
                      <p className="mt-0.5 text-xs text-muted">
                        {a.description}
                      </p>
                      {status === "GRANTED" && a.recurring && (
                        <button
                          type="button"
                          onClick={() =>
                            setIncomePreset({
                              label: a.title,
                              category: "BENEFITS",
                              recurrence: "MONTHLY",
                            })
                          }
                          className="mt-1.5 text-xs text-ink underline underline-offset-2"
                        >
                          Ajouter le montant à mes revenus
                        </button>
                      )}
                    </div>
                    <div className="w-32 shrink-0">
                      <Select
                        aria-label={`Statut : ${a.title}`}
                        value={status}
                        onChange={(e) =>
                          update({
                            aids: {
                              ...p.aids,
                              [a.id]: e.target.value as AidStatus,
                            },
                          })
                        }
                        className="py-1 text-xs"
                      >
                        {Object.entries(AID_STATUS).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </Select>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Pistes"
            action={
              <span className="text-xs text-muted">
                {done} sur {IDEAS.length} en place
              </span>
            }
          />
          <div className="grid gap-x-6 px-5 pb-4 sm:grid-cols-2">
            {(["earn", "save"] as const).map((kind) => (
              <div key={kind}>
                <div className="pb-1 pt-2 text-xs text-muted">
                  {kind === "earn" ? "Gagner plus" : "Dépenser moins"}
                </div>
                <ul>
                  {IDEAS.filter((i) => i.kind === kind).map((i) => (
                    <li key={i.id}>
                      <label className="flex cursor-pointer items-start gap-3 py-2">
                        <input
                          type="checkbox"
                          checked={!!p.ideas[i.id]}
                          onChange={() =>
                            update({
                              ideas: { ...p.ideas, [i.id]: !p.ideas[i.id] },
                            })
                          }
                          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-ink)]"
                        />
                        <span
                          className={
                            p.ideas[i.id]
                              ? "text-muted line-through decoration-white/30"
                              : ""
                          }
                        >
                          <span className="block text-sm">{i.title}</span>
                          <span className="block text-xs text-muted">
                            {i.description}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <IncomeForm
        open={incomePreset !== null}
        onClose={() => setIncomePreset(null)}
        income={null}
        preset={incomePreset ?? undefined}
      />
    </>
  );
}

function SavingsCard({
  goal,
  income,
  expenses,
  onGoal,
}: {
  goal: number | null;
  income: number;
  expenses: number;
  onGoal: (g: number | null) => void;
}) {
  const [draft, setDraft] = useState(goal ? String(goal) : "");
  useEffect(() => setDraft(goal ? String(goal) : ""), [goal]);
  const commit = () => {
    const n = Number(draft.replace(",", "."));
    const next = Number.isFinite(n) && n > 0 ? n : null;
    if (next !== goal) onGoal(next);
  };
  const left = income - expenses;
  const reached = goal ? Math.max(0, Math.min(left, goal)) : 0;
  const pct = goal ? Math.min(100, (reached / goal) * 100) : 0;

  return (
    <Card>
      <CardHeader title="Objectif d’épargne du mois" />
      <div className="space-y-3 px-5 pb-5 pt-2 text-sm">
        <label className="flex items-center gap-3">
          <span className="text-muted">Mettre de côté</span>
          <span className="w-24 shrink-0">
            <Input
              inputMode="decimal"
              placeholder="ex. 50"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => e.key === "Enter" && commit()}
              className="py-1 text-right"
            />
          </span>
          <span className="text-muted">€ par mois</span>
        </label>
        {goal ? (
          income > 0 ? (
            <>
              <div className="h-[7px] rounded-full bg-track">
                <div
                  className={`h-full rounded-full ${left < goal ? "bg-orange-500" : "bg-ink"}`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
              <p className="tabular-nums">
                {left >= goal
                  ? `Objectif tenu : il te reste ${eur(left)} ce mois-ci, dont ${eur(goal)} à mettre de côté.`
                  : left > 0
                    ? `Il reste ${eur(left)} ce mois-ci : il manque ${eur(goal - left)} pour l’objectif.`
                    : `Les dépenses dépassent déjà les entrées de ${eur(-left)} ce mois-ci.`}
              </p>
              <p className="text-xs text-muted">
                Pour tenir l’objectif, garde tes dépenses du mois sous{" "}
                {eur(Math.max(0, income - goal))}.
              </p>
            </>
          ) : (
            <p className="text-xs text-muted">
              Ajoute tes rentrées dans{" "}
              <Link to="/revenus" className="underline underline-offset-2">
                Revenus
              </Link>{" "}
              pour suivre l’objectif.
            </p>
          )
        ) : (
          <p className="text-xs text-muted">
            Même 20 ou 30 € par mois font une vraie réserve en un an.
          </p>
        )}
      </div>
    </Card>
  );
}

function SubscriptionsCard({
  bills,
  toCancel,
  onToggle,
}: {
  bills: ReturnType<typeof recurringBills>;
  toCancel: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  const key = (b: (typeof bills)[number]) =>
    `${b.provider.toLowerCase()}|${b.recurrence}`;
  const perMonth = bills.reduce((t, b) => t + monthlyCost(b), 0);
  const saved = bills
    .filter((b) => toCancel[key(b)])
    .reduce((t, b) => t + monthlyCost(b), 0);
  return (
    <Card>
      <CardHeader
        title="Abonnements et prélèvements"
        action={
          <span className="text-xs tabular-nums text-muted">
            {eur(perMonth)} / mois
          </span>
        }
      />
      {bills.length === 0 ? (
        <EmptyState>Aucun abonnement enregistré pour l’instant.</EmptyState>
      ) : (
        <>
          <ul className="divide-y divide-white/5">
            {bills.map((b) => (
              <li key={b.id}>
                <label className="flex cursor-pointer items-center gap-3 px-5 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate ${toCancel[key(b)] ? "text-muted line-through decoration-white/30" : ""}`}
                    >
                      {b.provider}
                    </span>
                    <span className="block text-xs text-muted">
                      {eur(b.amount)} ·{" "}
                      {RECURRENCES[b.recurrence].toLowerCase()}
                    </span>
                  </span>
                  <span className="text-xs text-muted">À résilier</span>
                  <input
                    type="checkbox"
                    checked={!!toCancel[key(b)]}
                    onChange={() => onToggle(key(b))}
                    className="h-4 w-4 accent-[var(--color-ink)]"
                  />
                </label>
              </li>
            ))}
          </ul>
          <div className="border-t border-white/5 px-5 py-3 text-sm">
            {saved > 0 ? (
              <span>
                Économie en résiliant :{" "}
                <span className="font-semibold tabular-nums">
                  {eur(saved * 12)} par an
                </span>
              </span>
            ) : (
              <span className="text-xs text-muted">
                Coche ce dont tu te sers peu pour voir ce que tu économiserais
                sur un an : {eur(perMonth * 12)} en tout aujourd’hui.
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
