import { useState } from 'react';

export interface MiniBar {
  key: string;
  /** Libellé discret sous la barre (initiale du jour, mois…) */
  label: string;
  /** Texte de l'infobulle */
  title: string;
  value: number;
  highlight?: boolean;
}

/**
 * Graphique en barres fines façon « activité de la semaine » : barres noires aux
 * extrémités arrondies, libellés gris discrets, barre courante en dégradé lumineux.
 * Le détail s'affiche au survol ou au toucher.
 */
export function MiniBars({ bars, height = 96, format }: { bars: MiniBar[]; height?: number; format: (n: number) => string }) {
  const [active, setActive] = useState<string | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);
  const shown = bars.find((b) => b.key === active) ?? bars.find((b) => b.highlight);

  return (
    <div>
      <div className="mb-3 h-5 text-center text-sm tabular-nums text-ink" aria-live="polite">
        {shown && (
          <>
            <span className="font-semibold">{format(shown.value)}</span> <span className="text-muted">· {shown.title}</span>
          </>
        )}
      </div>
      <div className="flex items-end justify-between gap-1 px-1" style={{ height }} role="list">
        {bars.map((b) => {
          // Une valeur nulle reste visible sous forme de point
          const h = max > 0 && b.value > 0 ? Math.max(10, (b.value / max) * height) : 6;
          return (
            <button
              key={b.key}
              role="listitem"
              aria-label={`${b.title} : ${format(b.value)}`}
              onMouseEnter={() => setActive(b.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(b.key)}
              onBlur={() => setActive(null)}
              onClick={() => setActive(b.key)}
              className="group flex h-full flex-1 items-end justify-center focus:outline-none"
            >
              <span
                className={`block w-[7px] rounded-full transition-opacity ${
                  b.value <= 0 ? (b.highlight ? 'bg-ink/50' : 'bg-stub') : b.highlight ? 'bar-highlight' : 'bg-ink'
                } ${active && active !== b.key ? 'opacity-40' : ''}`}
                style={{ height: h }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-1 px-1">
        {bars.map((b) => (
          <span key={b.key} className={`flex-1 text-center text-[11px] uppercase tracking-wide ${b.highlight ? 'text-ink' : 'text-muted'}`}>
            {b.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Barres horizontales fines (répartition par catégorie). */
export function ThinBars({ rows, format }: { rows: { key: string; label: string; value: number }[]; format: (n: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.key}>
          <div className="mb-1 flex justify-between text-xs">
            <span className="text-ink">{r.label}</span>
            <span className="tabular-nums text-muted">{format(r.value)}</span>
          </div>
          <div className="h-[7px] rounded-full bg-track">
            <div className="h-full rounded-full bg-ink" style={{ width: `${max ? Math.max(3, (r.value / max) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
