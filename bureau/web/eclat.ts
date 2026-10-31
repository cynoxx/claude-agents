// Une explosion d'étincelles (niveau supérieur, quête accomplie) : quelques centaines de particules qui jaillissent
// du centre, freinées par l'air et tirées par la gravité, avec leur traîne. Une toile posée par-dessus tout, retirée
// à la fin (environ 1,8 s). Rien si l'utilisateur préfère moins d'animations.

export function eclat(couleurs = ["198, 236, 255", "79, 183, 255", "255, 255, 255"], n = 220): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const toile = document.createElement("canvas");
  toile.className = "sys-eclat";
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  toile.width = innerWidth * dpr;
  toile.height = innerHeight * dpr;
  document.body.appendChild(toile);
  const c = toile.getContext("2d")!;
  const cx = toile.width / 2;
  const cy = toile.height / 2;
  const v0 = Math.min(toile.width, toile.height) * 1.6;
  const p = Array.from({ length: n }, () => {
    const a = Math.random() * Math.PI * 2;
    const v = v0 * (0.25 + Math.random() * 0.75);
    return { x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vie: 0.9 + Math.random() * 0.9, t: (1 + Math.random() * 2) * dpr, coul: couleurs[Math.floor(Math.random() * couleurs.length)] };
  });
  const debut = performance.now();
  let avant = debut;
  const boucle = (t: number) => {
    const dt = Math.min(0.05, (t - avant) / 1000);
    avant = t;
    const s = (t - debut) / 1000;
    // la traîne : l'image précédente s'efface un peu
    c.globalCompositeOperation = "destination-out";
    c.fillStyle = `rgba(0, 0, 0, ${1 - Math.exp(-dt * 10)})`;
    c.fillRect(0, 0, toile.width, toile.height);
    c.globalCompositeOperation = "lighter";
    for (const q of p) {
      if (s > q.vie) continue;
      const frein = Math.exp(-dt * 3.2);
      q.vx *= frein;
      q.vy = q.vy * frein + 900 * dpr * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      c.fillStyle = `rgba(${q.coul}, ${1 - s / q.vie})`;
      c.fillRect(q.x, q.y, q.t, q.t);
    }
    // l'éclair du début
    if (s < 0.25) {
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, v0 * 0.35);
      g.addColorStop(0, `rgba(255, 255, 255, ${0.5 * (1 - s / 0.25)})`);
      g.addColorStop(1, "rgba(255, 255, 255, 0)");
      c.fillStyle = g;
      c.fillRect(0, 0, toile.width, toile.height);
    }
    if (s < 1.9) requestAnimationFrame(boucle);
    else toile.remove();
  };
  requestAnimationFrame(boucle);
}
