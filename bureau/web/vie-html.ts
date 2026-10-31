// Les blocs de l'écran pour ta vie : le cap du jour, les projets d'un pôle, le Studio et le journal (sans DOM, testables).
import type { AutomatismeVue, EtatBureau, PlanVue, Plateforme, ProjetVie, StudioVue, VieVue } from "../shared/protocol.ts";

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ICONE: Record<Plateforme, string> = { tiktok: "♪ TikTok", youtube: "▶ Shorts", instagram: "◎ Reels" };
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];

/** « 2026-11-03 19:30 » → « aujourd'hui 19:30 », « demain 16:30 », « jeu. 21:00 ». */
export function quand(q: string, maintenant = new Date()): string {
  const [jour, heure] = q.split(" ");
  const d = new Date(`${jour}T12:00:00`);
  const auj = new Date(maintenant);
  auj.setHours(12, 0, 0, 0);
  const n = Math.round((d.getTime() - auj.getTime()) / 86_400_000);
  return `${n <= 0 ? "aujourd'hui" : n === 1 ? "demain" : JOURS[d.getDay()]} ${heure ?? ""}`.trim();
}

/** Les jours avant une échéance (« J-3 », « aujourd'hui », « en retard »). */
export function avant(echeance: string, maintenant = new Date()): { texte: string; urgent: boolean } {
  const auj = new Date(maintenant);
  auj.setHours(12, 0, 0, 0);
  const n = Math.round((Date.parse(`${echeance}T12:00:00`) - auj.getTime()) / 86_400_000);
  return { texte: n < 0 ? "en retard" : n === 0 ? "aujourd'hui" : `J-${n}`, urgent: n <= 2 };
}

const ligneProjet = (p: ProjetVie, maintenant: Date, avecDomaine = false) => {
  const e = p.echeance ? avant(p.echeance, maintenant) : null;
  return `<li class="vp-projet" data-statut="${p.statut}"><div class="vp-nom">${echapper(p.nom)}${avecDomaine ? ` <small>${echapper(p.categorie)}</small>` : ""}${
    e ? ` <span class="vp-echeance${e.urgent ? " urgent" : ""}">${e.texte}</span>` : ""
  }${p.statut !== "actif" ? ` <span class="vp-statut">${p.statut === "pause" ? "en pause" : "fini"}</span>` : ""}</div>${
    p.prochaineAction ? `<div class="vp-action">→ ${echapper(p.prochaineAction)}</div>` : ""
  }${p.statut === "actif" && p.prochaineAction ? `<button type="button" class="vp-fait" data-action="etape" data-projet="${echapper(p.nom)}" title="Étape faite : Max te donne la suivante">✓</button>` : ""}</li>`;
};

/** Les projets d'un ou plusieurs domaines, rangés par catégorie. */
export function htmlProjets(vie: VieVue | undefined, domaines: string[], maintenant = new Date()): string {
  if (!vie) return "";
  const projets = vie.projets.filter((p) => domaines.includes(p.domaine) && p.statut !== "fini");
  const cats = [...new Set(projets.map((p) => p.categorie))];
  return `<h3>Projets</h3>${
    cats.length
      ? cats.map((c) => `<div class="vp-cat"><h4>${echapper(c)}</h4><ul class="vp-liste">${projets.filter((p) => p.categorie === c).map((p) => ligneProjet(p, maintenant)).join("")}</ul></div>`).join("")
      : `<p class="j-petit">Aucun projet ici. Dis « Max, nouveau projet… » : il le range et te donne la première étape.</p>`
  }`;
}

/** Le Studio : les prochaines publications (publier en un clic), les vidéos en montage ou ratées. */
export function htmlStudio(s: StudioVue | undefined, maintenant = new Date()): string {
  if (!s) return `<h3>Studio vidéo</h3><p class="j-petit">Le Studio a besoin d'iCloud Drive sur ce Mac (dossier « Max Studio »).</p>`;
  const montage = s.videos.filter((v) => v.statut === "montage");
  const ratees = s.videos.filter((v) => v.statut === "erreur").slice(-2);
  const prochaines = s.prochaines.map(
    (p) =>
      `<li class="vs-pub"><span class="vs-quand">${quand(p.quand, maintenant)}</span><span class="vs-titre">${echapper(p.titre)} <small>${echapper(p.compte)} · ${ICONE[p.plateforme]}</small></span><span class="vs-boutons"><button type="button" data-action="publier" data-video="${p.id}" data-plateforme="${p.plateforme}">Publier</button><button type="button" class="vs-ok" data-action="publiee" data-video="${p.id}" data-plateforme="${p.plateforme}" title="C'est posté">✓</button></span></li>`,
  );
  return `<h3>Studio vidéo <small>· une par jour</small></h3>${
    montage.length ? `<p class="vs-montage">⚙️ Montage en cours : ${montage.map((v) => echapper(v.titre)).join(", ")}…</p>` : ""
  }${prochaines.length ? `<ul class="vs-liste">${prochaines.join("")}</ul>` : `<p class="j-petit">Rien de prévu. Dis « Max, écris-moi la loi suivante », enregistre-toi, et dépose l'audio dans Max Studio › Asclepium › voix.</p>`}${ratees
    .map((v) => `<p class="j-petit qf-rouge">⚠️ ${echapper(v.titre)} : ${echapper(v.erreur ?? "")}</p>`)
    .join("")}`;
}

/** Le cap du jour, à l'accueil : les prochaines actions qui comptent, et la prochaine vidéo à poster. */
export function htmlCap(e: Pick<EtatBureau, "vie" | "studio">, maintenant = new Date()): string {
  const focus = e.vie?.focus ?? [];
  const pub = e.studio?.prochaines[0];
  if (!focus.length && !pub) return `<h3>Cap du jour</h3><p class="j-petit">Dis « Max, c'est quoi le programme ? »</p>`;
  return `<h3>Cap du jour</h3><ol class="vp-cap">${focus
    .map((p) => {
      const ec = p.echeance ? avant(p.echeance, maintenant) : null;
      return `<li><span class="vp-cap-action">${echapper(p.prochaineAction ?? p.nom)}</span><small>${echapper(p.nom)}${ec ? ` · <b class="${ec.urgent ? "urgent" : ""}">${ec.texte}</b>` : ""}</small></li>`;
    })
    .join("")}</ol>${pub ? `<p class="vp-pub">🎬 ${echapper(pub.titre)} · ${ICONE[pub.plateforme]} ${quand(pub.quand, maintenant)}</p>` : ""}`;
}

/** Le journal du jour, à l'accueil. */
export function htmlJournal(vie: VieVue | undefined): string {
  const j = vie?.journal;
  const humeur = j?.humeur ? " " + "●".repeat(j.humeur) + "○".repeat(5 - j.humeur) : "";
  if (!j) return `<p class="j-petit">Rien encore aujourd'hui. Raconte à Max, ou écris ici.</p>`;
  const notes = j.notes.slice(-3).map((n) => `<li><span>${n.heure}</span> ${echapper(n.texte)}</li>`);
  return `${j.bilan ? `<p class="vj-bilan">${echapper(j.bilan)}<span class="vj-humeur">${humeur}</span></p>` : ""}${notes.length ? `<ol class="vj-notes">${notes.join("")}</ol>` : ""}`;
}

/** Les automatismes de Max, à l'accueil : l'heure, fait ou pas aujourd'hui, et de quoi les couper ou les lancer. */
export function htmlAutomatismes(liste: AutomatismeVue[] | undefined): string {
  if (!liste?.length) return "";
  return `<ul class="va-liste">${liste
    .map(
      (a) =>
        `<li class="va" data-actif="${a.actif ? "oui" : "non"}" title="${echapper(a.description)}${a.resultat ? `\n\nDernier : ${echapper(a.resultat)}` : ""}"><span class="va-heure">${a.heure}</span><span class="va-nom">${echapper(a.nom)}${
          a.enCours ? " ⚙️" : a.faitAujourdhui ? " ✓" : ""
        }</span><button type="button" data-auto="lancer" data-id="${a.id}" title="Le lancer maintenant" aria-label="Lancer ${echapper(a.nom)}">▶</button><button type="button" data-auto="${a.actif ? "couper" : "activer"}" data-id="${a.id}" class="va-interrupteur" aria-pressed="${a.actif}" aria-label="${a.actif ? "Couper" : "Activer"} ${echapper(a.nom)}"></button></li>`,
    )
    .join("")}</ul>`;
}

/** Les idées de business du jour (fiche Business). */
export function htmlIdees(i: EtatBureau["ideesDuJour"]): string {
  if (!i?.idees.length) return `<h3>Idées du jour</h3><p class="j-petit">Max t'en propose 3 chaque jour à 12 h 30.</p>`;
  return `<h3>Idées du jour</h3><ul class="vi-liste">${i.idees
    .map((x) => `<li><b>${echapper(x.titre)}</b><span>${echapper(x.accroche)}</span><small>→ ${echapper(x.premierPas)}</small></li>`)
    .join("")}</ul>`;
}

/** Le plan de reconstruction, à l'accueil : les 3 règles à cocher, l'objectif de blocs, le réveil, la série. */
export function htmlPlan(p: PlanVue | undefined, blocsFaits = 0): string {
  if (!p) return "";
  const n = p.regles.filter((r) => p.aujourdhui[r.id]).length;
  const blocs = Math.min(blocsFaits, p.blocs);
  const accomplie = n === 3 && blocs >= p.blocs;
  return `<h3>Quête quotidienne</h3><p class="vq-sous">Reprendre le contrôle · jour ${p.jour}</p><ul class="vr-liste">${p.regles
    .map(
      (r) =>
        `<li><button type="button" class="vr-case" data-regle="${r.id}" aria-pressed="${p.aujourdhui[r.id]}">${p.aujourdhui[r.id] ? "✓" : ""}</button><span>${echapper(r.texte)}</span></li>`,
    )
    .join("")}<li class="vq-compte"><span class="vr-case vr-fixe" aria-hidden="true">${blocs >= p.blocs ? "✓" : ""}</span><span>Blocs de médecine (50 min)</span><b>[${blocs}/${p.blocs}]</b></li></ul>${
    accomplie
      ? `<p class="vq-accomplie">QUÊTE ACCOMPLIE</p>`
      : `<p class="vq-chrono">TEMPS RESTANT <b data-chrono>--:--:--</b></p><p class="vq-avert">⚠ Quête incomplète : aucune pénalité. On reprend au prochain bloc.</p>`
  }<p class="vr-pied">⏰ demain ${p.reveilDemain.replace(":", " h ")}${p.serie ? ` · 🔥 ${p.serie} j à 3/3` : ""}</p><p class="vr-identite">« ${echapper(p.identite)} »</p>`;
}
