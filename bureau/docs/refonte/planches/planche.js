// Les planches de direction artistique : un dessin fixe (canvas 2D) de ce que sera Max. Pas le moteur final
// (qui sera en three.js), seulement de quoi juger la direction : la forme, la lumière, les couleurs, la mise en page.

export const COULEURS = {
  nuit: "#04060A",
  encre: "#0A101A",
  froid: "#6FE0FF", // l'information
  bleu: "#2E8BFF",
  blanc: "#EAF6FF",
  braise: "#FF3B2F", // l'alerte, l'urgence
  feu: "#FF7A45",
  or: "#FFD27A", // la réussite
  ambre: "#FFB36B", // le soir
};

/** Les états de Max : sa couleur, son agitation, sa forme. */
export const ETATS = {
  veille: { nom: "Veille", c1: COULEURS.bleu, c2: COULEURS.froid, energie: 0.15, pics: 0, anneau: 0, etincelles: 0, taille: 0.86, lum: 0.7 },
  ecoute: { nom: "Écoute", c1: COULEURS.froid, c2: COULEURS.blanc, energie: 0.3, pics: 0.05, anneau: 1, etincelles: 0, taille: 1, lum: 1 },
  reflexion: { nom: "Réflexion", c1: COULEURS.bleu, c2: COULEURS.blanc, energie: 0.45, pics: 0.08, anneau: 0, etincelles: 14, taille: 0.95, lum: 0.9 },
  parole: { nom: "Parole", c1: COULEURS.froid, c2: COULEURS.blanc, energie: 0.6, pics: 0.38, anneau: 0, etincelles: 0, taille: 1.05, lum: 1.15 },
  alerte: { nom: "Alerte", c1: COULEURS.braise, c2: COULEURS.feu, energie: 0.8, pics: 0.22, anneau: 2, etincelles: 0, taille: 1, lum: 1.1 },
  fete: { nom: "Réussite", c1: COULEURS.or, c2: COULEURS.blanc, energie: 0.7, pics: 0.12, anneau: 0, etincelles: 40, taille: 1.08, lum: 1.2 },
  soir: { nom: "Soir", c1: COULEURS.ambre, c2: "#FFE2BF", energie: 0.1, pics: 0, anneau: 0, etincelles: 0, taille: 0.8, lum: 0.55 },
};

// un hasard reproductible : la même planche à chaque rendu
function hasard(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

/** Le « spectre » d'une voix, figé : des bosses lisses autour de la sphère. */
function spectre(angle, r) {
  return 0.5 + 0.5 * Math.sin(angle * 3 + 1.2) * Math.sin(angle * 7 + r * 4) * Math.cos(angle * 2 - 0.6);
}

/** Dessine Max : un cœur de lumière, une sphère de particules, des filaments. */
export function dessinerMax(ctx, cx, cy, R, etat, graine = 7) {
  const e = ETATS[etat];
  const h = hasard(graine);
  const r = R * e.taille;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // le halo
  for (const [k, a] of [[3.4, 0.1], [2.1, 0.16], [1.2, 0.3]]) {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * k);
    g.addColorStop(0, rgba(e.c1, a * e.lum));
    g.addColorStop(1, rgba(e.c1, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.fill();
  }

  // les filaments : des arcs de lumière qui traversent la sphère
  const nFil = 26;
  for (let i = 0; i < nFil; i++) {
    const a0 = h() * Math.PI * 2;
    const a1 = a0 + Math.PI * (0.5 + h() * 0.9);
    const r0 = r * (0.86 + h() * 0.2);
    const pli = r * (h() - 0.5) * 1.5;
    const x0 = cx + Math.cos(a0) * r0, y0 = cy + Math.sin(a0) * r0 * 0.96;
    const x1 = cx + Math.cos(a1) * r0, y1 = cy + Math.sin(a1) * r0 * 0.96;
    const mx = cx + Math.cos((a0 + a1) / 2) * pli, my = cy + Math.sin((a0 + a1) / 2) * pli;
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, rgba(e.c1, 0));
    g.addColorStop(0.5, rgba(i % 5 === 0 ? e.c2 : e.c1, (0.2 + h() * 0.3) * e.lum));
    g.addColorStop(1, rgba(e.c1, 0));
    ctx.strokeStyle = g;
    ctx.lineWidth = R * (0.004 + h() * 0.008);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(mx, my, x1, y1);
    ctx.stroke();
  }

  // la sphère de particules (spirale de Fibonacci, vue légèrement de dessus)
  const N = 2600;
  const or = Math.PI * (3 - Math.sqrt(5));
  const tilt = etat === "ecoute" ? 0.5 : 0.28;
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const rr = Math.sqrt(1 - y * y);
    const th = i * or;
    let x = Math.cos(th) * rr, z = Math.sin(th) * rr, yy = y;
    // bascule
    const y2 = yy * Math.cos(tilt) - z * Math.sin(tilt);
    const z2 = yy * Math.sin(tilt) + z * Math.cos(tilt);
    const ang = Math.atan2(y2, x);
    // la voix pousse la matière vers l'extérieur ; le reste respire
    const pousse = 1 + e.pics * spectre(ang, rr) * (0.5 + 0.5 * z2) + (h() - 0.5) * 0.06 * e.energie;
    const px = cx + x * r * pousse;
    const py = cy + y2 * r * pousse;
    const prof = (z2 + 1) / 2; // 0 derrière, 1 devant
    const t = 0.25 + prof * 0.75;
    ctx.fillStyle = rgba(h() < 0.12 ? e.c2 : e.c1, (0.1 + prof * 0.55) * e.lum);
    const s = R * 0.006 * (0.5 + t) * (h() < 0.04 ? 2.4 : 1);
    ctx.beginPath();
    ctx.arc(px, py, s, 0, Math.PI * 2);
    ctx.fill();
  }

  // le cœur
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.5);
  g.addColorStop(0, rgba(COULEURS.blanc, 0.95 * e.lum));
  g.addColorStop(0.25, rgba(e.c2, 0.5 * e.lum));
  g.addColorStop(1, rgba(e.c1, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.5, 0, Math.PI * 2);
  ctx.fill();

  // les anneaux : l'écoute (un anneau tourné vers toi), l'alerte (deux, serrés)
  for (let k = 0; k < e.anneau; k++) {
    ctx.strokeStyle = rgba(e.c2, 0.55 - k * 0.2);
    ctx.lineWidth = R * 0.008;
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * (1.28 + k * 0.16), r * (0.34 + k * 0.05), -0.12, 0, Math.PI * 2);
    ctx.stroke();
  }

  // les étincelles : des idées qui passent (réflexion), une gerbe (réussite)
  for (let i = 0; i < e.etincelles; i++) {
    const a = h() * Math.PI * 2;
    const d = r * (1.15 + h() * (etat === "fete" ? 1.3 : 0.5));
    const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
    const l = R * (0.03 + h() * 0.07);
    const gg = ctx.createLinearGradient(x, y, x - Math.cos(a) * l, y - Math.sin(a) * l);
    gg.addColorStop(0, rgba(e.c2, 0.9));
    gg.addColorStop(1, rgba(e.c1, 0));
    ctx.strokeStyle = gg;
    ctx.lineWidth = R * 0.007;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - Math.cos(a) * l, y - Math.sin(a) * l);
    ctx.stroke();
  }
  ctx.restore();
}

/** Le fond : noir profond, un sol en perspective, une poussière de lumière. */
export function dessinerFond(ctx, L, H, o = {}) {
  const teinte = o.teinte ?? COULEURS.bleu;
  ctx.fillStyle = COULEURS.nuit;
  ctx.fillRect(0, 0, L, H);
  const g = ctx.createRadialGradient(L / 2, H * (o.horizon ?? 0.62), 0, L / 2, H * 0.62, L * 0.7);
  g.addColorStop(0, rgba(teinte, 0.13));
  g.addColorStop(1, rgba(teinte, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, L, H);
  // le sol : une grille qui fuit vers l'horizon (la profondeur)
  const hz = H * (o.horizon ?? 0.62);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let i = 1; i <= 16; i++) {
    const t = i / 16;
    const y = hz + (H - hz) * t * t;
    ctx.strokeStyle = rgba(teinte, 0.03 + t * 0.09);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(L, y);
    ctx.stroke();
  }
  for (let i = -18; i <= 18; i++) {
    const g2 = ctx.createLinearGradient(0, hz, 0, H);
    g2.addColorStop(0, rgba(teinte, 0));
    g2.addColorStop(1, rgba(teinte, 0.1));
    ctx.strokeStyle = g2;
    ctx.beginPath();
    ctx.moveTo(L / 2 + i * 14, hz);
    ctx.lineTo(L / 2 + i * 190, H);
    ctx.stroke();
  }
  const h = hasard(o.graine ?? 3);
  for (let i = 0; i < 260; i++) {
    ctx.fillStyle = rgba(COULEURS.blanc, h() * 0.35);
    ctx.fillRect(h() * L, h() * hz, 1.2, 1.2);
  }
  ctx.restore();
}

/** Un arc de progression (un pôle, un compte à rebours). */
export function arc(ctx, cx, cy, r, part, couleur, ep = 4) {
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  ctx.strokeStyle = rgba(couleur, 0.14);
  ctx.lineWidth = ep;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = rgba(couleur, 0.95);
  ctx.shadowColor = couleur;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * part);
  ctx.stroke();
  ctx.restore();
}

export { rgba, hasard };
