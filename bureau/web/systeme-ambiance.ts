// L'ambiance du Système, partout dans l'app : le compte à rebours de la quête quotidienne (jusqu'à minuit, comme
// dans Solo Leveling), et une onde de lumière à chaque clic.

/** Le temps qu'il reste avant minuit, « HH:MM:SS ». */
export function tempsRestant(maintenant = new Date()): string {
  const minuit = new Date(maintenant);
  minuit.setHours(24, 0, 0, 0);
  const s = Math.max(0, Math.floor((minuit.getTime() - maintenant.getTime()) / 1000));
  const deux = (n: number) => String(n).padStart(2, "0");
  return `${deux(Math.floor(s / 3600))}:${deux(Math.floor((s % 3600) / 60))}:${deux(s % 60)}`;
}

export function brancherAmbianceSysteme(): void {
  // le compte à rebours, dans toutes les fenêtres de quête affichées
  const tic = () => {
    const t = tempsRestant();
    document.querySelectorAll<HTMLElement>("[data-chrono]").forEach((el) => {
      if (el.textContent !== t) el.textContent = t;
    });
  };
  tic();
  window.setInterval(tic, 1000);
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  // la profondeur : les couches de l'ambiance suivent la souris (variables CSS, une fois par image au plus)
  let attente = 0;
  window.addEventListener(
    "pointermove",
    (e) => {
      if (attente) return;
      attente = requestAnimationFrame(() => {
        attente = 0;
        const r = document.documentElement.style;
        r.setProperty("--sys-px", ((e.clientX / innerWidth - 0.5) * 2).toFixed(3));
        r.setProperty("--sys-py", ((e.clientY / innerHeight - 0.5) * 2).toFixed(3));
      });
    },
    { passive: true },
  );
  // une onde du Système là où tu cliques
  document.addEventListener("pointerdown", (e) => onde(e.clientX, e.clientY), { passive: true });
}

/** Une onde de lumière du Système à cet endroit de l'écran (un clic, de la souris ou de la main). */
export function onde(x: number, y: number): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const o = document.createElement("i");
  o.className = "sys-onde";
  o.style.left = `${x}px`;
  o.style.top = `${y}px`;
  document.body.appendChild(o);
  window.setTimeout(() => o.remove(), 650);
}
