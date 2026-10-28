// L'écran Jarvis : la sphère de Max au centre, ce qu'il dit, et autour l'heure, la météo, l'agenda du jour,
// le travail du jour, la mission en cours. « Max, emmène-moi au bureau » zoome dans la sphère jusqu'au bureau.
import { ARTEFACTS } from "../shared/artefacts.ts";
import type { AssistantVue, ClientMessage, EtatBureau, EtatMax, MailsVue, PlanningVue, VueEcran } from "../shared/protocol.ts";
import { dureeCourte, restant } from "./conversation.ts";
import { duree } from "./poles-pur.ts";
import { Humanoide } from "./humanoide.ts";
import { Montagnes } from "./montagnes.ts";
import { Regard } from "./regard.ts";
import { basculerSons, son, sonsActifs, tonnerre } from "./sons.ts";
import { Ultime } from "./ultime.ts";
import { SEANCES } from "../shared/sport.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUTS: Record<EtatMax, string> = {
  veille: "En veille",
  ecoute: "À l'écoute — dis « Max, … »",
  reflechit: "Réfléchit…",
  parle: "Parle",
};

const PHASES_EN_COURS = new Set(["planification", "travail", "relecture", "pause"]);

/** Ce que l'écran affiche en grand : la phrase qu'il prononce, sinon sa dernière réponse (raccourcie). */
export function textePrincipal(a: AssistantVue | undefined): string {
  if (!a) return "";
  if (a.phrase) return a.phrase;
  const dernier = [...a.messages].reverse().find((m) => m.de === "max");
  if (!dernier) return "";
  return dernier.texte.length > 240 ? dernier.texte.slice(0, 239).trimEnd() + "…" : dernier.texte;
}

/** Ta dernière phrase, si elle est plus récente que la dernière réponse de Max. */
export function texteToi(a: AssistantVue | undefined): string {
  if (!a) return "";
  const i = a.messages.map((m) => m.de).lastIndexOf("toi");
  const j = a.messages.map((m) => m.de).lastIndexOf("max");
  return i > j ? a.messages[i].texte : "";
}

/** Les rendez-vous encore à venir (ou en cours depuis moins d'une heure), les journées entières en premier. */
export function prochainsRdv(agenda: { heure: string; titre: string }[], maintenant: Date): { heure: string; titre: string }[] {
  const minutes = maintenant.getHours() * 60 + maintenant.getMinutes();
  return agenda.filter((e) => {
    if (!e.heure) return true;
    const [h, m] = e.heure.split(":").map(Number);
    return h * 60 + m >= minutes - 60;
  });
}

const ICONES_CRENEAU: Record<string, string> = { travail: "📚", cours: "🎓", pause: "☕", repas: "🍽", sport: "🏃", perso: "🙂", sommeil: "🌙", autre: "•" };

/** Les créneaux à montrer : le créneau en cours et les suivants (et le précédent, pour se situer). */
export function creneauxAffiches(p: PlanningVue, max = 7): { texte: string; heure: string; enCours: boolean; passe: boolean }[] {
  const debut = p.enCours >= 0 ? Math.max(0, p.enCours - 1) : 0;
  return p.creneaux.slice(debut, debut + max).map((c, i) => ({
    heure: `${c.debut}–${c.fin}`,
    texte: `${ICONES_CRENEAU[c.type] ?? "•"} ${c.titre}`,
    enCours: debut + i === p.enCours,
    passe: p.enCours >= 0 && debut + i < p.enCours,
  }));
}

/** Combien de mails dans le dernier tri, et le nombre à traiter. */
export function compteMails(m: MailsVue): { total: number; aTraiter: number } {
  return {
    total: m.categories.reduce((t, c) => t + c.mails.length, 0),
    aTraiter: m.categories.find((c) => c.id === "a_traiter")?.mails.length ?? 0,
  };
}

/** Les petits textes des anneaux de données autour de Max : son état, l'échéance, la séance du jour, les études. */
export function etiquettesAnneaux(e: EtatBureau): string[] {
  const t: string[] = [e.assistant?.obscur ? "MAX ULTIME · TÉNÈBRES" : `SYS · ${STATUTS[e.assistant?.etat ?? "veille"].split(" —")[0]}`];
  const ech = e.assistant?.coach?.echeance;
  if (ech) t.push(`${ech.nom.slice(0, 18)} · ${ech.jours === 0 ? "JOUR J" : `J-${ech.jours}`}`);
  const s = e.sport ? SEANCES.find((x) => x.id === (e.sport!.faite ?? e.sport!.prevue)) : null;
  if (s) t.push(`Séance · ${s.nom}${e.sport!.faite ? " ✓" : ""}`);
  const et = e.poles?.find((x) => x.id === "etudes");
  if (et?.objectif) t.push(`Études · ${Math.min(999, Math.round((et.aujourdhui / et.objectif) * 100))} %`);
  return t;
}

const echapper = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export class Jarvis {
  private sphere: Humanoide;
  private vue: VueEcran = "jarvis";
  private etat?: EtatBureau;
  private ultime: Ultime;

  constructor(private envoyer: (m: ClientMessage) => void) {
    // Max en buste humanoïde de particules, devant ses montagnes
    this.sphere = new Humanoide($<HTMLCanvasElement>("sphere"));
    this.sphere.demarrer();
    // les montagnes vibrent avec sa voix ; sa tête suit ton visage
    const montagnes = new Montagnes($<HTMLCanvasElement>("j-fond"), () => this.sphere.niveauVoix);
    // Max Ultime : la transformation, puis tout passe au rouge (Max, les montagnes, l'écran)
    this.ultime = new Ultime((actif) => {
      document.body.dataset.obscur = actif ? "oui" : "non";
      this.sphere.obscur(actif);
      montagnes.obscur(actif);
      const b = $("j-obscur");
      b.textContent = actif ? "◇ Quitter le mode obscur" : "◆ Mode obscur";
      b.dataset.actif = actif ? "oui" : "non";
    });
    $("j-obscur").addEventListener("click", () => this.envoyer({ type: "obscur", actif: !this.etat?.assistant?.obscur }));
    // les éclairs au loin grondent doucement
    window.addEventListener("max-eclair", () => tonnerre(0.25));
    new Regard(this.sphere);
    // les sons se coupent d'un clic sur le nom de Max (l'option n'encombre plus la barre)
    const nom = document.querySelector<HTMLElement>(".j-nom");
    nom?.addEventListener("click", () => {
      basculerSons();
      nom.dataset.muet = sonsActifs() ? "non" : "oui";
      nom.title = sonsActifs() ? "Sons de l'interface : clique pour les couper" : "Sons coupés : clique pour les remettre";
      son("clic");
    });
    $<HTMLFormElement>("j-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const champ = $<HTMLInputElement>("j-texte");
      const t = champ.value.trim();
      if (!t) return;
      this.envoyer({ type: "parler-max", texte: t });
      champ.value = "";
    });
    $("j-bureau").addEventListener("click", () => this.envoyer({ type: "vue", vue: "bureau" }));
    $("j-mission").addEventListener("click", () => this.envoyer({ type: "vue", vue: "bureau" }));
    $("btn-jarvis").addEventListener("click", () => this.envoyer({ type: "vue", vue: "jarvis" }));
    // tes artefacts claude.ai, posés dans le bureau : un clic les ouvre dans ton navigateur
    const arts = document.getElementById("hud-artefacts");
    if (arts) {
      arts.innerHTML = ARTEFACTS.map((x) => `<button type="button" data-artefact="${x.id}" title="${x.description}">${x.emoji} ${x.nom}</button>`).join("");
      arts.addEventListener("click", (e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-artefact]");
        if (b) this.envoyer({ type: "artefact", id: b.dataset.artefact! });
      });
    }
    $("j-reveil").addEventListener("click", () => this.envoyer({ type: this.etat?.assistant?.etat === "veille" ? "reveil" : "veille" }));
    this.horloge();
    setInterval(() => this.horloge(), 1000);
  }

  rendre(etat: EtatBureau): void {
    this.etat = etat;
    const a = etat.assistant;
    this.changerVue(a?.vue ?? "jarvis");
    const e = a?.etat ?? "veille";
    this.sphere.etat(e);
    this.sphere.donnees(etiquettesAnneaux(etat));
    this.ultime.rendre(!!a?.obscur);
    $("j-statut").textContent = STATUTS[e];
    $("j-statut").dataset.etat = e;
    $("j-reveil").textContent = e === "veille" ? "👂 Réveiller" : "😴 Veille";
    $("j-dit").textContent = textePrincipal(a) || (e === "veille" ? "Dis « Max » quand tu as besoin de moi." : "Je t'écoute.");
    const toi = texteToi(a);
    $("j-toi").textContent = toi ? `« ${toi} »` : "";
    const soucis = a ? [a.oreille, a.bouche, a.cerveau].filter((d) => !d.ok && d.detail).map((d) => `⚠️ ${d.detail}`) : [];
    $("j-soucis").textContent = soucis.join(" · ");
    // ce que le micro a entendu en dernier : la preuve qu'il t'écoute (estompé si ce n'était pas pour Max)
    const ent = $("j-entendu");
    const en = a?.entendu;
    // la page écrit en direct ce qu'elle entend : on ne l'écrase pas pendant quelques secondes
    if (Date.now() - Number(ent.dataset.directA ?? 0) > 4000)
      ent.textContent = !a?.oreille.ok ? `🎙 ${a?.oreille.detail ?? "micro coupé"}` : en ? `🎙 ${new Date(en.heure).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })} · « ${en.texte} »` : "🎙 j'écoute…";
    if (Date.now() - Number(ent.dataset.directA ?? 0) > 4000) ent.dataset.pourMax = en?.pourMax ? "oui" : "non";

    // panneaux
    const j = etat.jarvis;
    $("j-meteo").textContent = j?.meteo ?? "—";
    // aujourd'hui : l'emploi du temps s'il existe, sinon l'agenda
    const agenda = $("j-agenda");
    const aide = $("j-jour-aide");
    const p = etat.planning;
    $("j-jour-titre").textContent = p ? "Ton emploi du temps" : "Aujourd'hui";
    aide.hidden = !!p;
    if (p) {
      agenda.innerHTML = creneauxAffiches(p)
        .map((c) => `<li class="${c.enCours ? "en-cours" : c.passe ? "passe" : ""}"><span>${echapper(c.heure)}</span> ${echapper(c.texte)}</li>`)
        .join("");
    } else {
      aide.textContent = "Pas encore d'emploi du temps : dis « Max, on fait mon emploi du temps ».";
      if (!j?.agenda) agenda.innerHTML = `<li class="vide">Agenda indisponible</li>`;
      else {
        const rdv = prochainsRdv(j.agenda, new Date()).slice(0, 5);
        agenda.innerHTML = rdv.length
          ? rdv.map((r) => `<li><span>${echapper(r.heure || "Journée")}</span> ${echapper(r.titre)}</li>`).join("")
          : `<li class="vide">Rien dans l'agenda</li>`;
      }
    }

    // « Maintenant » : la session en cours, sinon le créneau en cours, et l'objectif d'études du jour
    const c = a?.coach;
    const enCours = p && p.enCours >= 0 ? p.creneaux[p.enCours] : null;
    $("j-maintenant").textContent = enCours ? `${ICONES_CRENEAU[enCours.type] ?? "•"} ${enCours.titre} · jusqu'à ${enCours.fin}` : "Rien de prévu en ce moment";
    const etudes = etat.poles?.find((x) => x.id === "etudes");
    const jauge = $("j-objectif");
    jauge.hidden = !etudes?.objectif;
    if (etudes?.objectif) (jauge.firstElementChild as HTMLElement).style.width = `${Math.min(100, Math.round((etudes.aujourdhui / etudes.objectif) * 100))}%`;
    $("j-travail").textContent = etudes?.objectif ? `Études : ${duree(etudes.aujourdhui)} / ${duree(etudes.objectif)}` : c ? `Travail aujourd'hui : ${dureeCourte(c.aujourdhui)}` : "";
    this.minuteur();

    const m = etat.mission;
    const mission = $("j-mission");
    mission.hidden = !(m && PHASES_EN_COURS.has(m.phase));
    if (m) mission.innerHTML = `🛠 <strong>${echapper(m.titre)}</strong><br><span>${m.robots.length} robot${m.robots.length > 1 ? "s" : ""} au travail · voir l'équipe →</span>`;
    const pensent = (etat.conseillers ?? []).filter((x) => x.statut === "reflechit");
    $("j-conseillers").textContent = pensent.map((x) => `${x.emoji} ${x.nom} réfléchit…`).join("  ");
  }

  private minuteur(): void {
    const m = this.etat?.assistant?.coach?.minuteur;
    const el = $("j-minuteur");
    el.hidden = !m;
    if (m) el.textContent = m.type === "travail" ? `⏱ ${m.sujet} · ${restant(m.fin)}` : `☕ Pause · ${restant(m.fin)}`;
    el.dataset.type = m?.type ?? "";
  }

  private horloge(): void {
    const d = new Date();
    $("j-heure").textContent = d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    $("j-date").textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    this.minuteur();
  }

  /** Jarvis → bureau : on plonge dans la sphère ; bureau → Jarvis : la sphère revient. */
  private changerVue(v: VueEcran): void {
    if (v === this.vue) return;
    this.vue = v;
    const ecran = $("jarvis");
    if (v === "bureau") {
      ecran.classList.add("plonge");
      let z = 1;
      const grossir = () => {
        z *= 1.12;
        this.sphere.agrandir(z);
        if (z < 12 && this.vue === "bureau") requestAnimationFrame(grossir);
      };
      requestAnimationFrame(grossir);
      setTimeout(() => {
        if (this.vue !== "bureau") return;
        ecran.hidden = true;
        document.body.dataset.vue = "bureau";
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new Event("zone-bureau"));
      }, 650);
    } else {
      // le retour, à l'envers : on ressort de la sphère, qui se resserre jusqu'à sa taille normale
      let z = 12;
      this.sphere.agrandir(z);
      ecran.hidden = false;
      document.body.dataset.vue = "jarvis";
      ecran.classList.add("revient");
      const reduire = () => {
        z = Math.max(1, z / 1.15);
        this.sphere.agrandir(z);
        if (z > 1 && this.vue === "jarvis") requestAnimationFrame(reduire);
      };
      requestAnimationFrame(() => {
        ecran.classList.remove("plonge");
        requestAnimationFrame(reduire);
        setTimeout(() => ecran.classList.remove("revient"), 500);
      });
    }
  }
}
