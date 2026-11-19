// Le Bureau, second écran : les pôles de sa vie posés en arc sur un sol de lumière, reliés à Max par des fils.
// L'arc de chaque pôle dit l'avancement de la semaine. À gauche, les quêtes du jour ; à droite, la sanction et l'équipe.
// Remplace le pixel art : un clic sur un pôle ouvre sa fiche sur l'écran de Max.
import type { ClientMessage, EtatBureau, RegleId } from "../../shared/protocol.ts";
import { arc, poles, regles } from "./presence-pur.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const PHASES_EN_COURS = new Set(["planification", "travail", "relecture", "pause"]);
const PHASES: Record<string, string> = { planification: "Max prépare le plan", travail: "Les robots travaillent", relecture: "Relecture", pause: "En pause", terminee: "Terminée", echec: "Échec" };

/** Les positions des pôles (en % de l'écran) : un arc ouvert vers le bas, le centre plus haut que les bords. */
export function positions(n: number): { x: number; y: number }[] {
  if (n <= 0) return [];
  const c = (n - 1) / 2;
  return Array.from({ length: n }, (_, i) => {
    const d = c ? Math.abs(i - c) / c : 0;
    return { x: n === 1 ? 50 : 16 + (68 * i) / (n - 1), y: 55 + 20 * d * d };
  });
}

export class Salle {
  private el: HTMLElement;
  private dernier = new Map<string, string>();
  private orbe: Orbe;

  constructor(private envoyer: (m: ClientMessage) => void) {
    this.el = document.createElement("section");
    this.el.id = "salle";
    this.el.className = "salle";
    this.el.setAttribute("aria-label", "Le Bureau");
    this.el.innerHTML = `
<canvas class="salle-fond" aria-hidden="true"></canvas>
<header class="salle-haut"><div class="salle-marque">MAX <span>·</span> LE BUREAU</div><div class="salle-menu-place"></div></header>
<svg class="salle-fils" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
<canvas class="salle-orbe" aria-hidden="true"></canvas>
<div class="salle-poles"></div>
<section class="pr-carte verre salle-quetes" aria-label="Quêtes du jour"></section>
<div class="salle-droite"><section class="pr-carte verre braise salle-sanction" hidden></section><section class="pr-carte verre salle-equipe"></section></div>`;
    document.body.appendChild(this.el);
    // le menu de l'ancien bureau (résultat, quêtes passées, dossier, retour à Max) garde ses boutons
    const menu = document.querySelector(".hud-menu");
    if (menu) this.el.querySelector(".salle-menu-place")!.replaceWith(menu);
    this.orbe = new Orbe(this.el.querySelector<HTMLCanvasElement>(".salle-orbe")!);
    new Sol2(this.el.querySelector<HTMLCanvasElement>(".salle-fond")!);

    this.el.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const p = t.closest<HTMLElement>("[data-pole]");
      if (p) {
        this.envoyer({ type: "vue", vue: "jarvis" });
        this.envoyer({ type: "pole", pole: p.dataset.pole! });
        return;
      }
      const r = t.closest<HTMLElement>("[data-regle]");
      if (r) this.envoyer({ type: "regle", regle: r.dataset.regle as RegleId, tenue: r.dataset.tenue !== "oui" });
      const s = t.closest<HTMLElement>("[data-sanction]");
      if (s) this.envoyer({ type: "sanction", action: s.dataset.sanction === "annuler" ? "annuler" : "faite" });
    });
  }

  rendre(e: EtatBureau): void {
    this.orbe.etat(e.assistant?.etat ?? "veille");
    const liste = poles(e);
    const pos = positions(liste.length);
    this.poser(".salle-poles", "poles", liste
      .map((p, i) => `<button type="button" class="salle-pole ${p.ton}" data-pole="${echapper(p.id)}" style="left:${pos[i].x}%;top:${pos[i].y}%" title="Ouvrir la fiche ${echapper(p.nom)}">
  <span class="sp-sol"></span>
  <svg viewBox="0 0 100 100" class="sp-anneau"><circle cx="50" cy="50" r="42" class="sp-piste"/><path d="${arc(p.avance)}" class="sp-arc"/></svg>
  <span class="sp-pct chiffre">${Math.round(p.avance * 100)}<small>%</small></span>
  <span class="sp-nom">${echapper(p.nom)}</span><span class="sp-ligne">${echapper(p.ligne)}</span></button>`)
      .join(""));
    // les fils de lumière, de Max à chaque pôle
    this.poser(".salle-fils", "fils", liste
      .map((p, i) => `<path class="${p.ton}" d="M 50 24 Q ${(50 + pos[i].x) / 2} ${pos[i].y - 18} ${pos[i].x} ${pos[i].y - 7}" vector-effect="non-scaling-stroke"/>`)
      .join(""));

    const plan = e.plan;
    if (plan) {
      const rs = regles(plan);
      const faites = rs.filter((r) => r.tenue).length;
      this.poser(".salle-quetes", "quetes", `<div class="etiquette">Quêtes du jour · ${faites} / ${rs.length}</div>
${rs.map((r) => `<button type="button" class="salle-quete${r.tenue ? " tenue" : ""}" data-regle="${echapper(r.id)}" data-tenue="${r.tenue ? "oui" : "non"}"><i></i><span>${echapper(r.texte)}</span></button>`).join("")}
<div class="pr-ligne"><span>Blocs d'études visés</span><span class="chiffre">${plan.blocs}</span></div>
<div class="pr-ligne"><span>Réveil demain</span><span class="chiffre">${echapper(plan.reveilDemain)}</span></div>`);
    } else {
      this.poser(".salle-quetes", "quetes", `<div class="etiquette">Quêtes du jour</div><p class="pr-sous">Pas encore de plan : dis « Max, on reprend le contrôle ».</p>`);
    }

    const s = plan?.sanction;
    const carteS = this.el.querySelector<HTMLElement>(".salle-sanction")!;
    carteS.hidden = s?.statut !== "en-cours";
    if (s?.statut === "en-cours") {
      this.poser(".salle-sanction", "sanction", `<div class="etiquette">Sanction en cours</div><div class="pr-titre moyen">${echapper(s.texte.replace(/^Zone de pénalité\s*:\s*/i, ""))}</div><div class="pr-sous">${s.motif.length ? `Hier : ${s.motif.map(echapper).join(" · ")}` : ""}</div><div class="pr-boutons"><button type="button" data-sanction="faite">C'est fait</button><button type="button" class="discret" data-sanction="annuler">Annuler</button></div>`);
    }

    const m = e.mission;
    const enCours = !!m && PHASES_EN_COURS.has(m.phase);
    this.poser(".salle-equipe", "equipe", m
      ? `<div class="etiquette">L'équipe${enCours ? " · au travail" : ""}</div><div class="pr-titre moyen">${echapper(m.titre)}</div><div class="pr-sous">${echapper(PHASES[m.phase] ?? m.phase)} · étape ${m.etape}/${m.totalEtapes}</div>
${m.robots.slice(0, 4).map((r) => `<div class="pr-ligne"><span>${echapper(r.nom)}</span><span class="discret">${echapper(r.statut)}</span></div>`).join("")}`
      : `<div class="etiquette">L'équipe</div><p class="pr-sous">Aucune mission en cours. Dis « Max, lance une mission : … ».</p>`);
  }

  private poser(selecteur: string, cle: string, html: string): void {
    if (this.dernier.get(cle) === html) return;
    this.dernier.set(cle, html);
    const el = this.el.querySelector(selecteur);
    if (el) el.innerHTML = html;
  }
}

/** Max en petit, au-dessus des pôles : une sphère de points qui tourne, dessinée seulement quand le Bureau est affiché. */
class Orbe {
  private ctx: CanvasRenderingContext2D;
  private points: [number, number, number][] = [];
  private humeur = "veille";

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    const n = 900;
    const or = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < n; i++) {
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(1 - y * y);
      this.points.push([Math.cos(or * i) * r, y, Math.sin(or * i) * r]);
    }
    let dernier = 0;
    const boucle = (ms: number) => {
      requestAnimationFrame(boucle);
      if (document.hidden || document.body.dataset.vue !== "bureau" || ms - dernier < 33) return;
      dernier = ms;
      this.dessiner(ms / 1000);
    };
    requestAnimationFrame(boucle);
  }

  etat(e: string): void {
    this.humeur = e;
  }

  private dessiner(t: number): void {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.round(r.width * dpr);
    if (this.canvas.width !== w) {
      this.canvas.width = w;
      this.canvas.height = w;
    }
    const g = this.ctx;
    g.clearRect(0, 0, w, w);
    const c = w / 2;
    const parle = this.humeur === "parle";
    const R = w * (0.36 + (parle ? Math.sin(t * 9) * 0.015 : Math.sin(t * 1.4) * 0.008));
    const halo = g.createRadialGradient(c, c, 0, c, c, w / 2);
    halo.addColorStop(0, "rgba(234, 246, 255, 0.85)");
    halo.addColorStop(0.12, "rgba(111, 224, 255, 0.45)");
    halo.addColorStop(0.5, "rgba(46, 139, 255, 0.12)");
    halo.addColorStop(1, "rgba(46, 139, 255, 0)");
    g.fillStyle = halo;
    g.fillRect(0, 0, w, w);
    const a = t * (parle ? 0.6 : 0.25);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    for (const [x, y, z] of this.points) {
      const xr = x * ca - z * sa;
      const zr = x * sa + z * ca;
      const prof = (zr + 1) / 2;
      g.fillStyle = `rgba(111, 224, 255, ${0.15 + prof * 0.7})`;
      const s = (0.6 + prof * 1.2) * dpr;
      g.fillRect(c + xr * R - s / 2, c + y * R - s / 2, s, s);
    }
  }
}

/** Le fond du Bureau : la même nuit que l'écran de Max, sans animation (dessinée à chaque redimensionnement). */
class Sol2 {
  constructor(canvas: HTMLCanvasElement) {
    const dessiner = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      const g = canvas.getContext("2d")!;
      const W = canvas.width;
      const H = canvas.height;
      const ciel = g.createRadialGradient(W / 2, H * 0.25, 0, W / 2, H * 0.25, Math.max(W, H) * 0.8);
      ciel.addColorStop(0, "#0b1d2e");
      ciel.addColorStop(0.5, "#06101b");
      ciel.addColorStop(1, "#020408");
      g.fillStyle = ciel;
      g.fillRect(0, 0, W, H);
      let graine = 11;
      const hasard = () => ((graine = (graine * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < (W * H) / (10000 * dpr * dpr); i++) {
        g.fillStyle = `rgba(234, 246, 255, ${0.1 + hasard() * 0.4})`;
        g.fillRect(hasard() * W, hasard() * H * 0.6, dpr, dpr);
      }
      const hy = H * 0.52;
      g.lineWidth = dpr;
      g.save();
      g.beginPath();
      g.rect(0, hy, W, H - hy);
      g.clip();
      for (let i = -24; i <= 24; i++) {
        const grad = g.createLinearGradient(0, hy, 0, H);
        grad.addColorStop(0, "rgba(111, 224, 255, 0)");
        grad.addColorStop(1, "rgba(111, 224, 255, 0.12)");
        g.strokeStyle = grad;
        g.beginPath();
        g.moveTo(W / 2, hy - H * 0.1);
        g.lineTo(W / 2 + (i / 24) * W * 1.6, H);
        g.stroke();
      }
      for (let k = 1; k < 16; k++) {
        const p = Math.pow(k / 16, 2.2);
        g.strokeStyle = `rgba(111, 224, 255, ${0.03 + p * 0.1})`;
        g.beginPath();
        g.moveTo(0, hy + p * (H - hy));
        g.lineTo(W, hy + p * (H - hy));
        g.stroke();
      }
      g.restore();
    };
    new ResizeObserver(dessiner).observe(canvas);
  }
}
