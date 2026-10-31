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

/**
 * Des particules arrivent de tous les bords de l'écran et se posent sur le contour d'un rectangle (la fenêtre du
 * Système qui s'ouvre) : le cadre se dessine en lumière, puis tout s'éteint quand la vraie fenêtre est là.
 */
export function convergence(cadre: { x: number; y: number; l: number; h: number }, dureeMs = 750, n = 320): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const toile = document.createElement("canvas");
  toile.className = "sys-eclat sys-eclat-haut";
  const dpr = Math.min(1.5, devicePixelRatio || 1);
  toile.width = innerWidth * dpr;
  toile.height = innerHeight * dpr;
  document.body.appendChild(toile);
  const c = toile.getContext("2d")!;
  const per = 2 * (cadre.l + cadre.h);
  const p = Array.from({ length: n }, (_, i) => {
    // la cible : un point du contour, réparti régulièrement
    let d = (i / n) * per;
    let tx: number, ty: number;
    if (d < cadre.l) [tx, ty] = [cadre.x + d, cadre.y];
    else if ((d -= cadre.l) < cadre.h) [tx, ty] = [cadre.x + cadre.l, cadre.y + d];
    else if ((d -= cadre.h) < cadre.l) [tx, ty] = [cadre.x + cadre.l - d, cadre.y + cadre.h];
    else [tx, ty] = [cadre.x, cadre.y + cadre.h - (d - cadre.l)];
    // le départ : loin, dans toutes les directions
    const a = Math.random() * Math.PI * 2;
    const r = Math.max(innerWidth, innerHeight) * (0.6 + Math.random() * 0.5);
    return { x0: innerWidth / 2 + Math.cos(a) * r, y0: innerHeight / 2 + Math.sin(a) * r, tx, ty, retard: Math.random() * 0.35 };
  });
  const debut = performance.now();
  const boucle = (t: number) => {
    const s = (t - debut) / dureeMs;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, innerWidth, innerHeight);
    c.globalCompositeOperation = "lighter";
    for (const q of p) {
      const u = Math.max(0, Math.min(1, (s - q.retard) / (1 - q.retard)));
      if (u <= 0) continue;
      const e = 1 - (1 - u) ** 4;
      const x = q.x0 + (q.tx - q.x0) * e;
      const y = q.y0 + (q.ty - q.y0) * e;
      const px = q.x0 + (q.tx - q.x0) * Math.max(0, e - 0.035);
      const py = q.y0 + (q.ty - q.y0) * Math.max(0, e - 0.035);
      // une traînée de lumière derrière chaque particule
      c.strokeStyle = `rgba(160, 225, 255, ${0.7 * (1 - u * 0.5)})`;
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(px, py);
      c.lineTo(x, y);
      c.stroke();
      c.fillStyle = "rgba(235, 250, 255, 0.95)";
      c.fillRect(x - 1, y - 1, 2, 2);
    }
    // le cadre s'allume quand tout est arrivé, puis s'éteint
    const allume = Math.max(0, Math.min(1, (s - 0.85) / 0.15)) * Math.max(0, 1 - (s - 1) / 0.5);
    if (allume > 0) {
      c.strokeStyle = `rgba(200, 240, 255, ${allume})`;
      c.lineWidth = 2;
      c.shadowColor = "rgba(79, 183, 255, 1)";
      c.shadowBlur = 18;
      c.strokeRect(cadre.x, cadre.y, cadre.l, cadre.h);
      c.shadowBlur = 0;
    }
    if (s < 1.5) requestAnimationFrame(boucle);
    else toile.remove();
  };
  requestAnimationFrame(boucle);
}
