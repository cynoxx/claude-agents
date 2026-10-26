// Le QG sur l'écran de Max : les tuiles des cinq pôles en bas de l'accueil, la fiche d'un pôle (sans aller au bureau)
// et la petite fenêtre des mails qui s'ouvre toute seule quand ils viennent d'être triés.
// La fiche est construite une fois à l'ouverture, puis seuls ses blocs qui changent sont réécrits (le corps 3D et
// le champ de question ne bougent pas).
import type { ClientMessage, ConseillerVue, EtatBureau, MailsVue, TempsPole } from "../shared/protocol.ts";
import { son } from "./sons.ts";
import { JOURS_SEMAINE, MUSCLES, SEANCES, seance } from "../shared/sport.ts";
import { barres, decalerHeure, duree, quandReveil, semaineSport, seanceSuivante, tuile } from "./poles-pur.ts";
import { compteMails, prochainsRdv } from "./jarvis.ts";
import type { Corps3D } from "./corps.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FENETRE_RECENTE_MS = 10 * 60_000;

/** Les mails par catégorie (« À traiter » ouvert). */
export function htmlMails(m: MailsVue, max = 8): string {
  if (!m.categories.length) return `<p class="j-petit">Aucun mail non lu.</p>`;
  return m.categories
    .map(
      (c) =>
        `<details class="j-mails-cat"${c.id === "a_traiter" ? " open" : ""}><summary>${c.emoji} ${echapper(c.nom)} <b>${c.mails.length}</b></summary><ul>${c.mails
          .slice(0, max)
          .map((x) => `<li class="${x.lu ? "" : "non-lu"}"><strong>${echapper(x.de)}</strong> — ${echapper(x.sujet)}</li>`)
          .join("")}${c.mails.length > max ? `<li class="j-petit">… et ${c.mails.length - max} autres</li>` : ""}</ul></details>`,
    )
    .join("");
}

export class QG {
  private etat?: EtatBureau;
  private pole: string | null = null;
  private blocs = new Map<string, string>();
  private corps: Corps3D | null = null;
  private chargementCorps: Promise<void> | null = null;
  private mainVoulue = false;
  private heureMailsVue: string | null = null;

  constructor(private envoyer: (m: ClientMessage) => void) {
    $("qg-poles").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>("[data-pole]");
      if (b) this.envoyer({ type: "pole", pole: b.dataset.pole === this.pole ? null : b.dataset.pole! });
    });
    const fiche = $("qg-fiche");
    fiche.addEventListener("click", (e) => this.clic(e));
    fiche.addEventListener("submit", (e) => {
      e.preventDefault();
      const champ = fiche.querySelector<HTMLInputElement>(".qf-question input");
      const q = champ?.value.trim();
      const c = this.conseiller();
      if (!q || !c) return;
      this.envoyer({ type: "parler-max", texte: `Demande à ${c.nom} (${c.domaine}) : ${q}` });
      champ!.value = "";
    });
    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!$("mails-fenetre").hidden) $("mails-fenetre").hidden = true;
      else if (this.pole) this.envoyer({ type: "pole", pole: null });
    });
    // la fenêtre des mails
    const fermer = () => ($("mails-fenetre").hidden = true);
    $("mf-fermer").addEventListener("click", fermer);
    $("mf-ok").addEventListener("click", fermer);
    $("mails-fenetre").addEventListener("click", (e) => e.target === $("mails-fenetre") && fermer());
    $("mf-retrier").addEventListener("click", () => {
      $("mf-resume").textContent = "Je retrie tes mails…";
      this.envoyer({ type: "trier-mails" });
    });
    $("mf-ranger").addEventListener("click", () => {
      fermer();
      this.envoyer({ type: "parler-max", texte: "Range les pubs dans le dossier Max - Pubs, s'il te plaît." });
    });
    $("j-mails-carte").addEventListener("click", () => this.ouvrirMails());
    $("j-alarme").addEventListener("click", () => this.envoyer({ type: "pole", pole: "sante" }));
    $("al-ok").addEventListener("click", () => this.envoyer({ type: "alarme", action: "confirmer" }));
    setInterval(() => {
      if (!$("alarme-ecran").hidden) $("al-heure").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    }, 1000);
  }

  rendre(etat: EtatBureau): void {
    this.etat = etat;
    this.rendreTuiles();
    this.rendreMails();
    const rv = etat.reveil;
    // le réveil sonne sur le Mac : grand écran « Debout ! » (sauf verrouillé : l'écran du visage s'en charge)
    const sonne = !!rv?.enCours && rv.mode !== "appel" && !etat.verrou?.verrouille;
    $("alarme-ecran").hidden = !sonne;
    if (sonne) $("al-heure").textContent = new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    const pastille = $("j-alarme");
    pastille.hidden = !rv?.prochain;
    if (rv?.prochain) {
      pastille.textContent = `⏰ ${rv.enCours ? "réveil en cours" : quandReveil(rv.prochain)}`;
      pastille.dataset.etat = !rv.configure ? "non-configure" : rv.enCours ? "en-cours" : "";
    }
    const voulu = etat.assistant?.pole ?? null;
    if (voulu !== this.pole) this.ouvrir(voulu);
    if (this.pole) this.rendreFiche();
    const focus = etat.assistant?.focus === "corps";
    $("qg-fiche").classList.toggle("qf-focus-corps", focus && this.pole === "sante");
    if (focus && this.pole === "sante" && !this.mainVoulue) {
      // « montre-moi mon corps » : le corps en grand, et la main pour le tourner
      this.mainVoulue = true;
      void this.chargementCorps?.then(() => this.corps?.activerMain(true));
    }
  }

  // --- les tuiles ----------------------------------------------------------------------------------

  private rendreTuiles(): void {
    const e = this.etat!;
    const html = (e.conseillers ?? [])
      .map((c) => {
        const t = tuile(c.id, e);
        const jauge = t.jauge === null ? "" : `<span class="qt-jauge"><i style="width:${Math.min(100, Math.round(t.jauge * 100))}%"></i></span>`;
        const pense = c.statut === "reflechit" ? `<span class="qt-pense">${echapper(c.nom)} réfléchit…</span>` : "";
        return `<button type="button" class="qg-tuile${c.id === this.pole ? " active" : ""}${t.alerte ? " alerte" : ""}" data-pole="${echapper(c.id)}" style="--pole:${echapper(c.couleur)}" aria-pressed="${c.id === this.pole}">
  <span class="qt-emoji">${c.emoji}</span><span class="qt-nom">${echapper(c.domaine)}</span><span class="qt-agent">${echapper(c.nom)}</span>
  <span class="qt-ligne">${echapper(t.ligne)}</span>${jauge}${pense}</button>`;
      })
      .join("");
    this.remplacer($("qg-poles"), "tuiles", html);
  }

  // --- la fiche d'un pôle --------------------------------------------------------------------------

  private conseiller(): ConseillerVue | undefined {
    return this.etat?.conseillers?.find((c) => c.id === this.pole);
  }

  private ouvrir(pole: string | null): void {
    const avant = this.pole;
    this.pole = pole;
    this.blocs.clear();
    this.corps?.detruire();
    this.corps = null;
    this.chargementCorps = null;
    this.mainVoulue = false;
    const fiche = $("qg-fiche");
    const c = this.conseiller();
    fiche.hidden = !c;
    document.body.dataset.pole = c ? c.id : "";
    this.changerMode(!!c);
    if (c && c.id !== avant) son("ouvre");
    else if (!c && avant) son("ferme");
    if (!pole || !c) {
      fiche.innerHTML = "";
      return;
    }
    const sport = pole === "sante";
    fiche.style.setProperty("--pole", c.couleur);
    fiche.innerHTML = `
<div class="qf-tete">
  <button type="button" class="qf-retour" data-action="accueil">← Accueil</button>
  <span class="qf-emoji">${c.emoji}</span>
  <div class="qf-titre"><h2>${echapper(c.domaine)}</h2><p>Ton agent : <strong>${echapper(c.nom)}</strong> · ${echapper(c.description)}</p></div>
  <span class="espace"></span>
  <button type="button" data-action="session">⏱ Session 25 min</button>
</div>
<div class="qf-grille${sport ? " qf-sport" : ""}">
  ${sport ? `<div class="j-carte qf-corps"><h3>Ton corps <small>· 14 derniers jours</small></h3><div id="qf-corps-scene" class="qf-corps-scene"></div><div class="qf-legende"><span><i class="qf-eteint"></i>pas travaillé</span><span class="qf-degrade">1×<i></i>4× et +</span></div><div id="qf-corps-pied" class="qf-corps-pied"></div></div>` : ""}
  <div id="qf-specifique" class="qf-colonne"></div>
  <div class="qf-colonne">
    <div id="qf-temps" class="j-carte"></div>
    <div id="qf-notes" class="j-carte"></div>
    <div id="qf-reponse" class="j-carte" hidden></div>
  </div>
</div>
<form class="qf-question"><input autocomplete="off" placeholder="Une question pour ${echapper(c.nom)} ? (Max la lui transmet)" /><button type="submit">Demander</button></form>`;
    if (sport) {
      this.chargementCorps = import("./corps.ts")
        .then(({ Corps3D }) => {
          if (this.pole !== "sante") return;
          this.corps = new Corps3D($("qf-corps-scene"), (t) => this.piedCorps(t));
          if (this.etat?.sport) this.corps.maj(this.etat.sport.muscles);
        })
        .catch(() => this.piedCorps("Le corps 3D n'a pas pu se charger."));
    }
  }

  /**
   * Accueil ↔ fiche : sur une fiche, Max reste visible en petit en haut (sa sphère rétrécit, sa phrase reste
   * lisible) et la fiche prend la place des panneaux de l'accueil, sans jamais passer dessus.
   */
  private changerMode(fiche: boolean): void {
    const ecran = $("jarvis");
    ecran.dataset.mode = fiche ? "fiche" : "accueil";
    for (const el of fiche ? [$("qg-fiche")] : [...document.querySelectorAll<HTMLElement>("#qg-accueil .j-cote")]) {
      el.classList.remove("qg-entre");
      void el.offsetWidth;
      el.classList.add("qg-entre");
    }
  }

  private rendreFiche(): void {
    const e = this.etat!;
    const c = this.conseiller();
    if (!c) return;
    const t = e.poles?.find((p) => p.id === c.id);
    this.remplacer($("qf-specifique"), "specifique", this.specifique(c.id, e));
    // le sport ne se chronomètre pas : la carte du temps n'apparaît que s'il y a eu des sessions
    $("qf-temps").hidden = !t || (c.id === "sante" && !t.semaine);
    if (t) this.remplacer($("qf-temps"), "temps", this.htmlTemps(t, c.id));
    this.remplacer(
      $("qf-notes"),
      "notes",
      `<h3>Ce que ${echapper(c.nom)} retient</h3>${
        t?.notes.length ? `<ul class="qf-liste">${t.notes.map((n) => `<li>${echapper(n.replace(/^- \[[\d-]+\]\s*/, ""))}</li>`).join("")}</ul>` : `<p class="j-petit">Rien encore. Pose-lui une question : il notera ce qui compte.</p>`
      }`,
    );
    const rep = $("qf-reponse");
    rep.hidden = !c.reponse && c.statut !== "reflechit";
    this.remplacer(rep, "reponse", c.statut === "reflechit" ? `<h3>${echapper(c.nom)} réfléchit…</h3><p>${echapper(c.question ?? "")}</p>` : `<h3>Sa dernière réponse</h3><p class="qf-reponse">${echapper(c.reponse ?? "")}</p>`);
    if (c.id === "sante" && e.sport) this.corps?.maj(e.sport.muscles);
  }

  private htmlTemps(t: TempsPole, id: string): string {
    const cible = t.limite ?? t.objectif;
    const titre = t.limite ? `Temps · limite ${duree(t.limite)} par jour` : t.objectif ? `Temps · objectif ${duree(t.objectif)} par jour` : "Temps passé";
    const depasse = !!t.limite && t.aujourdhui >= t.limite;
    const b = barres(t);
    return `<h3>${titre}</h3>
<div class="qf-temps-ligne"><strong class="${depasse ? "qf-rouge" : ""}">${duree(t.aujourdhui)}</strong> aujourd'hui · ${duree(t.semaine)} sur 7 jours</div>
${cible ? `<div class="qg-jauge${depasse ? " rouge" : ""}"><i style="width:${Math.min(100, Math.round((t.aujourdhui / cible) * 100))}%"></i></div>` : ""}
<div class="qf-barres" aria-label="7 derniers jours">${b.map((x) => `<span title="${duree(x.minutes)}"><i style="height:${Math.round(x.hauteur * 100)}%"></i><small>${x.jour}</small></span>`).join("")}</div>
${id === "business" && depasse ? `<p class="j-petit qf-rouge">Limite atteinte : le PASS d'abord, le reste au parking.</p>` : ""}`;
  }

  private specifique(id: string, e: EtatBureau): string {
    if (id === "sante" && e.sport) return this.htmlSport(e);
    if (id === "etudes") {
      const c = e.assistant?.coach;
      const p = e.planning;
      const travail = p?.creneaux.filter((x) => x.type === "travail" || x.type === "cours") ?? [];
      return `<div class="j-carte"><h3>Objectif</h3><div class="j-gros">${c?.echeance ? `${c.echeance.jours === 0 ? "Aujourd'hui" : `J-${c.echeance.jours}`} · ${echapper(c.echeance.nom)}` : "Aucune échéance"}</div>
<p class="j-petit">🔥 ${c?.serie ?? 0} jour(s) d'affilée avec au moins une session.</p></div>
<div class="j-carte"><h3>Révisions prévues aujourd'hui</h3>${
        travail.length ? `<ol class="j-agenda">${travail.map((x) => `<li><span>${x.debut}–${x.fin}</span> ${echapper(x.titre)}</li>`).join("")}</ol>` : `<p class="j-petit">Pas d'emploi du temps : dis « Max, on fait mon emploi du temps ».</p>`
      }</div>`;
    }
    if (id === "business") {
      const idees = e.idees ?? [];
      return `<div class="j-carte"><h3>Idées au parking</h3>${
        idees.length ? `<ul class="qf-liste">${idees.map((i) => `<li>${echapper(i.replace(/^- \[[\d-]+\]\s*/, ""))}</li>`).join("")}</ul>` : `<p class="j-petit">Aucune. Pendant les révisions, dis « Max, note cette idée » : elle t'attendra ici.</p>`
      }</div>`;
    }
    if (id === "apps") {
      const m = e.mission;
      const enCours = m && ["planification", "travail", "relecture", "pause"].includes(m.phase);
      return `<div class="j-carte"><h3>Quête de l'équipe</h3>${
        m
          ? `<div class="j-gros">${echapper(m.titre)}</div><p class="j-petit">${enCours ? `${m.robots.length} robot(s) au travail · étape ${m.etape}/${m.totalEtapes}` : "Terminée"}</p>`
          : `<p class="j-petit">Aucune quête. Dis « Max, lance une mission pour… » : l'équipe de robots s'y met au bureau.</p>`
      }<button type="button" data-action="bureau">🏢 Voir l'équipe au bureau</button></div>`;
    }
    if (id === "vie") {
      const m = e.mails;
      const agenda = e.jarvis?.agenda ? prochainsRdv(e.jarvis.agenda, new Date()) : null;
      return `<div class="j-carte"><h3>Mails</h3>${m ? `<p class="j-mails-resume">${echapper(m.resume)}</p>${htmlMails(m, 6)}` : `<p class="j-petit">Pas encore triés.</p>`}
<div class="qf-boutons"><button type="button" data-action="trier">🔄 Trier mes mails</button>${m?.categories.some((c) => c.id === "pubs") ? `<button type="button" data-action="ranger">📰 Ranger les pubs</button>` : ""}</div></div>
<div class="j-carte"><h3>Agenda</h3>${
        agenda?.length ? `<ol class="j-agenda">${agenda.slice(0, 6).map((r) => `<li><span>${echapper(r.heure || "Journée")}</span> ${echapper(r.titre)}</li>`).join("")}</ol>` : `<p class="j-petit">${agenda ? "Rien de prévu." : "Agenda indisponible."}</p>`
      }</div>`;
    }
    return "";
  }

  private htmlSport(e: EtatBureau): string {
    const s = e.sport!;
    const prevue = seance(s.prevue)!;
    const faite = s.faite ? seance(s.faite)! : null;
    const jours = semaineSport(s);
    const muscles = [...s.muscles].filter((m) => m.id !== "abdos" || m.fois).sort((a, b) => b.fois - a.fois);
    const ilYA = (j: string | null) => {
      if (!j) return "jamais";
      const n = Math.round((Date.parse(`${s.jour}T12:00:00`) - Date.parse(`${j}T12:00:00`)) / 86_400_000);
      return n === 0 ? "aujourd'hui" : n === 1 ? "hier" : `il y a ${n} j`;
    };
    return `<div class="j-carte qf-seance"><h3>Aujourd'hui</h3>
<div class="j-gros">${faite ? `${faite.emoji} ${faite.nom} ✅` : `${prevue.emoji} ${prevue.nom}`}</div>
<p class="j-petit">${faite ? "Séance notée. Bien joué !" : prevue.id === "repos" ? "Le repos fait partie de l'entraînement." : `Séance ${prevue.numero} : ${prevue.muscles.map((m) => MUSCLES[m]).join(", ")}.`}</p>
<div class="qf-boutons">${
      faite ? `<button type="button" data-action="seance" data-seance="${prevue.id}">Corriger</button>` : `<button type="button" class="qf-fait" data-action="seance" data-seance="${prevue.id}">✅ ${prevue.id === "repos" ? "Repos noté" : "Séance faite"}</button>`
    }<select data-action="autre-seance" aria-label="Noter une autre séance"><option value="">Autre…</option>${SEANCES.map((x) => `<option value="${x.id}">${x.emoji} ${x.nom}</option>`).join("")}</select></div></div>
<div class="j-carte"><h3>Ta semaine <small>· clique un jour pour changer sa séance</small></h3><div class="qf-semaine">${jours
      .map(
        (j, i) =>
          `<button type="button" class="qf-jour ${j.etat}" data-action="jour" data-jour="${i}" title="${JOURS_SEMAINE[i]} : ${echapper(seance(s.semaine[i])!.nom)}"><small>${j.initiale}</small><span>${j.emoji}</span><em>${
            j.etat === "faite" ? "✓" : j.etat === "manquee" ? "✗" : j.etat === "aujourdhui" ? "•" : ""
          }</em></button>`,
      )
      .join("")}</div><p class="j-petit">${s.seances30} séance(s) ces 30 derniers jours.</p></div>
${this.htmlReveil(e)}
<div class="j-carte"><h3>Muscles travaillés <small>· 14 jours</small></h3><ul class="qf-muscles">${muscles
      .map((m) => `<li><span>${MUSCLES[m.id]}</span><span class="qg-jauge"><i style="width:${Math.round(m.intensite * 100)}%"></i></span><small>${m.fois}× · ${ilYA(m.derniere)}</small></li>`)
      .join("")}</ul></div>`;
  }

  private htmlReveil(e: EtatBureau): string {
    const rv = e.reveil;
    if (!rv) return "";
    const heure = rv.prochain ? `${String(new Date(rv.prochain).getHours()).padStart(2, "0")}:${String(new Date(rv.prochain).getMinutes()).padStart(2, "0")}` : rv.heure;
    return `<div class="j-carte qf-reveil"><h3>Réveil <small>· Max t'appelle</small></h3>
<div class="j-gros">⏰ ${rv.enCours ? "En cours…" : quandReveil(rv.prochain)}</div>
<p class="j-petit">${
      rv.mode === "appel"
        ? rv.configure
          ? `D'habitude à ${rv.heure}. Max t'appelle : décroche et écoute, sinon il rappelle toutes les 5 minutes.`
          : "Pas encore configuré : il faut ton numéro et un compte Twilio (README, section « Le réveil »)."
        : `D'habitude à ${rv.heure}. Max te réveille sur le Mac, de plus en plus fort : laisse-le ouvert et branché.`
    }</p>
<div class="qf-boutons"><button type="button" data-action="alarme-regler" data-heure="${decalerHeure(heure, -15)}">−15 min</button><button type="button" data-action="alarme-regler" data-heure="${decalerHeure(heure, 15)}">+15 min</button>${
      rv.prochain ? `<button type="button" data-action="alarme-annuler">Pas de réveil</button>` : ""
    }${rv.configure ? `<button type="button" data-action="alarme-essayer">${rv.mode === "appel" ? "📞" : "🔔"} Tester</button>` : ""}</div></div>`;
  }

  private piedCorps(texte: string): void {
    const pied = document.getElementById("qf-corps-pied");
    if (!pied) return;
    const main = this.corps?.mainActive ?? false;
    pied.innerHTML = `<span>${echapper(texte)}</span><button type="button" data-action="main">${main ? "✋ Couper la caméra" : "✋ Tourner avec la main"}</button>`;
  }

  private clic(e: Event): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>("[data-action]");
    if (!el || el.tagName === "SELECT") return;
    const s = this.etat?.sport;
    switch (el.dataset.action) {
      case "accueil":
        return this.envoyer({ type: "pole", pole: null });
      case "session":
        return this.envoyer({ type: "session", minutes: 25, sujet: this.conseiller()?.domaine ?? "", pole: this.pole ?? undefined });
      case "bureau":
        return this.envoyer({ type: "vue", vue: "bureau" });
      case "trier":
        return this.envoyer({ type: "trier-mails" });
      case "ranger":
        return this.envoyer({ type: "parler-max", texte: "Range les pubs dans le dossier Max - Pubs, s'il te plaît." });
      case "seance":
        return this.envoyer({ type: "seance", seance: el.dataset.seance! });
      case "jour":
        if (s) this.envoyer({ type: "semaine-sport", jour: Number(el.dataset.jour), seance: seanceSuivante(s.semaine[Number(el.dataset.jour)]) });
        return;
      case "alarme-regler":
        return this.envoyer({ type: "alarme", action: "regler", heure: el.dataset.heure });
      case "alarme-annuler":
        return this.envoyer({ type: "alarme", action: "annuler" });
      case "alarme-essayer":
        el.textContent = "🔔 Ça sonne…";
        return this.envoyer({ type: "alarme", action: "essayer" });
      case "main":
        this.mainVoulue = true;
        void this.corps?.activerMain(!this.corps.mainActive);
        return;
    }
  }

  // --- la fenêtre des mails ---------------------------------------------------------------------

  private rendreMails(): void {
    const m = this.etat?.mails;
    $("j-mails-carte").hidden = !m;
    if (!m) return;
    const n = compteMails(m);
    $("j-mails-resume").textContent = m.resume || `${n.total} mails triés`;
    $("j-mails-compte").textContent = n.total ? `${n.aTraiter} à traiter · ${n.total} non lus · ouvrir →` : "";
    const nouveau = m.heure !== this.heureMailsVue;
    this.heureMailsVue = m.heure;
    if (!$("mails-fenetre").hidden || (nouveau && m.auto && Date.now() - Date.parse(m.heure) < FENETRE_RECENTE_MS && m.categories.length)) this.ouvrirMails();
  }

  ouvrirMails(): void {
    const m = this.etat?.mails;
    if (!m) return;
    $("mf-resume").textContent = m.resume;
    this.remplacer($("mf-categories"), "fenetre-mails", htmlMails(m, 12));
    $("mf-ranger").hidden = !m.categories.some((c) => c.id === "pubs");
    if ($("mails-fenetre").hidden) son("mail");
    $("mails-fenetre").hidden = false;
  }

  /** Réécrit un bloc seulement si son contenu a changé (garde les <details> ouverts et le focus). */
  private remplacer(el: HTMLElement, cle: string, html: string): void {
    if (this.blocs.get(cle) === html) return;
    this.blocs.set(cle, html);
    el.innerHTML = html;
  }
}

/** Pour l'onglet « autre séance » : la liste déroulante envoie la séance choisie. */
export function brancherAutreSeance(envoyer: (m: ClientMessage) => void): void {
  $("qg-fiche").addEventListener("change", (e) => {
    const sel = e.target as HTMLSelectElement;
    if (sel.dataset.action !== "autre-seance" || !sel.value) return;
    envoyer({ type: "seance", seance: sel.value });
    sel.value = "";
  });
}
