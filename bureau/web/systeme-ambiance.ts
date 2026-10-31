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
  // une onde du Système là où tu cliques
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.addEventListener(
    "pointerdown",
    (e) => {
      const o = document.createElement("i");
      o.className = "sys-onde";
      o.style.left = `${e.clientX}px`;
      o.style.top = `${e.clientY}px`;
      document.body.appendChild(o);
      window.setTimeout(() => o.remove(), 650);
    },
    { passive: true },
  );
}
