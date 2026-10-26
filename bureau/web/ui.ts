import type { ClientMessage, EtatBureau, MissionResume, MissionVue, Phase, RobotVue } from "../shared/protocol.ts";
import { ROLE_AFFICHAGE } from "../shared/roles-affichage.ts";
import { renderMarkdown } from "./markdown.ts";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const PHASES: Record<Phase, string> = {
  planification: "🧠 Max planifie",
  travail: "🛠️ L'équipe travaille",
  relecture: "🔍 Max relit",
  termine: "✅ Mission terminée",
  pause: "💤 En pause (quota)",
  echec: "❌ Mission échouée",
  arrete: "⏹ Mission arrêtée",
};
const STATUTS: Record<RobotVue["statut"], string> = {
  attente: "☕ attend son tour",
  travail: "💬 travaille",
  fini: "✅ a fini",
  quota: "💤 quota atteint",
  erreur: "❗ problème",
  arrete: "⏹ arrêté",
};
const STATUTS_FICHIER: Record<MissionResume["statut"], string> = {
  "en-cours": "en cours",
  terminee: "✅ terminée",
  "en-pause": "💤 en pause",
  echouee: "❌ échouée",
  arretee: "⏹ arrêtée",
  interrompue: "⚠️ interrompue",
};
const EN_COURS: Phase[] = ["planification", "travail", "relecture"];

type Vue = { type: "robot"; id: string } | { type: "resultat"; nom: string; markdown: string } | { type: "historique" } | { type: "rapport"; id: string; markdown: string };

const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const date = (iso: string) => new Date(iso).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function duree(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/** L'interface HTML autour du jeu : barre du haut, champ de mission, panneaux. */
export class Interface {
  private etat: EtatBureau = { claude: { ok: true }, mission: null };
  private vue: Vue | null = null;
  private resultatMontre = new Set<string>();
  private toastTimer?: number;

  constructor(private envoyer: (m: ClientMessage) => void) {
    const form = $<HTMLFormElement>("mission");
    const texte = $<HTMLTextAreaElement>("texte");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const t = texte.value.trim();
      if (!t) return this.toast("Écris d'abord la mission.");
      this.envoyer({ type: "lancer", texte: t });
    });
    texte.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    $("btn-arreter").addEventListener("click", () => {
      if (confirm("Arrêter la mission ? Les robots en cours de travail s'arrêtent tout de suite.")) this.envoyer({ type: "arreter" });
    });
    $("btn-reprendre").addEventListener("click", () => this.envoyer({ type: "reprendre" }));
    $("btn-dossier").addEventListener("click", () => this.envoyer({ type: "ouvrir-dossier" }));
    $("btn-historique").addEventListener("click", () => this.ouvrir({ type: "historique" }));
    $("btn-resultat").addEventListener("click", () => {
      const m = this.etat.mission;
      if (m?.resultat) this.ouvrir({ type: "resultat", nom: m.nom, markdown: m.resultat });
    });
    $("panneau").querySelector(".fermer")!.addEventListener("click", () => this.fermer());
    document.addEventListener("keydown", (e) => e.key === "Escape" && this.fermer());
    setInterval(() => this.majChrono(), 1000);
  }

  rendre(etat: EtatBureau): void {
    const avant = this.etat.mission;
    this.etat = etat;
    const m = etat.mission;

    const bandeau = $("bandeau");
    bandeau.hidden = etat.claude.ok;
    bandeau.textContent = etat.claude.ok ? "" : `⚠️ ${etat.claude.erreur ?? "Claude Code n'est pas prêt."}`;

    const enCours = !!m && EN_COURS.includes(m.phase);
    const pause = m?.phase === "pause";
    $("phase").textContent = m ? this.libellePhase(m) : "Prêt pour une mission";
    $("titre-mission").textContent = m ? m.titre : "";
    $("btn-arreter").hidden = !(enCours || pause);
    $("btn-reprendre").hidden = !pause;
    $("btn-resultat").hidden = !m?.resultat;
    $<HTMLButtonElement>("btn-lancer").disabled = enCours || pause || !etat.claude.ok;
    $<HTMLTextAreaElement>("texte").disabled = enCours || pause;
    if (m?.erreur && avant?.erreur !== m.erreur) this.toast(m.erreur);
    if (m && avant?.nom !== m.nom) $<HTMLTextAreaElement>("texte").value = "";
    this.majChrono();

    if (m?.phase === "termine" && m.resultat && !this.resultatMontre.has(m.nom)) {
      this.resultatMontre.add(m.nom);
      setTimeout(() => this.ouvrir({ type: "resultat", nom: m.nom, markdown: m.resultat! }), 2500);
    }
    if (this.vue?.type === "robot") this.dessinerPanneau();
  }

  private libellePhase(m: MissionVue): string {
    if (m.phase === "travail" && m.totalEtapes > 1) return `${PHASES.travail} — étape ${m.etape + 1}/${m.totalEtapes}`;
    return PHASES[m.phase];
  }

  private majChrono(): void {
    const m = this.etat.mission;
    $("chrono").textContent = m ? `⏱ ${duree((m.fin ? Date.parse(m.fin) : Date.now()) - Date.parse(m.debut))}` : "";
  }

  clicPersonnage(id: string): void {
    this.ouvrir({ type: "robot", id });
  }

  toast(message: string): void {
    const t = $("toast");
    t.textContent = message;
    t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (t.hidden = true), 5000);
  }

  private ouvrir(v: Vue): void {
    this.vue = v;
    $("panneau").hidden = false;
    $("panneau").classList.toggle("large", v.type === "resultat" || v.type === "rapport");
    this.dessinerPanneau(true);
  }

  private fermer(): void {
    this.vue = null;
    $("panneau").hidden = true;
  }

  private async dessinerPanneau(nouveau = false): Promise<void> {
    const c = $("panneau").querySelector<HTMLElement>(".contenu")!;
    const v = this.vue;
    if (!v) return;
    const m = this.etat.mission;

    if (v.type === "robot") {
      const liste = c.querySelector(".actions");
      const enBas = !liste || liste.scrollTop + liste.clientHeight >= liste.scrollHeight - 20;
      c.innerHTML = v.id === "max" ? this.panneauMax(m) : v.id.startsWith("conseiller:") ? this.panneauConseiller(v.id.slice(11)) : this.panneauRobot(m, v.id);
      const nouvelleListe = c.querySelector(".actions");
      if (nouvelleListe && (nouveau || enBas)) nouvelleListe.scrollTop = nouvelleListe.scrollHeight;
      c.querySelector<HTMLButtonElement>("[data-rapport]")?.addEventListener("click", (e) => this.voirRapport(v.id, (e.currentTarget as HTMLElement).dataset.rapport!));
      return;
    }
    if (v.type === "rapport") {
      c.innerHTML = `<button class="retour">← Retour</button><div class="markdown">${renderMarkdown(v.markdown)}</div>`;
      c.querySelector(".retour")!.addEventListener("click", () => this.ouvrir({ type: "robot", id: v.id }));
      return;
    }
    if (v.type === "resultat") {
      c.innerHTML = `<div class="actions-resultat"><button data-dossier>📁 Ouvrir le dossier</button></div><div class="markdown">${renderMarkdown(v.markdown)}</div>`;
      c.querySelector("[data-dossier]")!.addEventListener("click", () => this.envoyer({ type: "ouvrir-dossier", nom: v.nom }));
      return;
    }
    c.innerHTML = "<h2>📜 Historique</h2><p class='discret'>Chargement…</p>";
    try {
      const missions: MissionResume[] = await (await fetch("/api/missions")).json();
      if (this.vue !== v) return;
      c.innerHTML =
        "<h2>📜 Historique</h2>" +
        (missions.length
          ? `<ul class="historique">${missions
              .map(
                (x) =>
                  `<li><button data-nom="${esc(x.nom)}"><strong>${esc(x.titre)}</strong><span>${date(x.debut)} · ${STATUTS_FICHIER[x.statut]}</span></button></li>`,
              )
              .join("")}</ul>`
          : "<p class='discret'>Aucune mission pour l'instant.</p>");
      c.querySelectorAll<HTMLButtonElement>("[data-nom]").forEach((b) => b.addEventListener("click", () => this.ouvrirAncienne(b.dataset.nom!)));
    } catch {
      c.innerHTML = "<h2>📜 Historique</h2><p>Impossible de charger l'historique.</p>";
    }
  }

  private panneauMax(m: MissionVue | null): string {
    const actions = m?.max.actions ?? [];
    return `<h2>👑 Max <span class="puce">chef d'équipe</span></h2>
      <p>Max découpe ta mission, choisit l'équipe, puis relit tout et écrit la synthèse finale.</p>
      ${m ? `<h3>Mission</h3><p class="tache">${esc(m.texte)}</p>` : ""}
      <h3>Ce qu'il a fait</h3>${this.listeActions(actions)}`;
  }

  private panneauConseiller(id: string): string {
    const c = this.etat.conseillers?.find((x) => x.id === id);
    if (!c) return "<p>Ce conseiller n'est plus au bureau.</p>";
    const statut = c.statut === "reflechit" ? "💭 réfléchit" : "🪑 à son bureau";
    return `<h2><span class="pastille" style="background:${c.couleur}"></span>${c.emoji} ${esc(c.nom)} <span class="puce">${statut}</span></h2>
      <p><strong>${esc(c.domaine)}</strong> : ${esc(c.description)}.</p>
      <p class="discret">Pour lui poser une question : « Max, demande au ${esc(c.nom)}… ». Ses notes sont dans Documents/Bureau/conseillers/${esc(c.id)}.md.</p>
      ${c.question ? `<h3>Dernière question${c.heure ? ` (${date(c.heure)})` : ""}</h3><p class="tache">${esc(c.question)}</p>` : ""}
      ${c.reponse ? `<h3>Sa réponse</h3><div class="markdown">${renderMarkdown(c.reponse)}</div>` : ""}`;
  }

  private panneauRobot(m: MissionVue | null, id: string): string {
    const r = m?.robots.find((x) => x.id === id);
    if (!m || !r) return "<p>Ce robot a quitté le bureau.</p>";
    const a = ROLE_AFFICHAGE[r.role];
    return `<h2><span class="pastille" style="background:${a.couleur}"></span>${a.emoji} ${esc(r.nom)} <span class="puce">${STATUTS[r.statut]}</span></h2>
      <h3>Sa tâche</h3><p class="tache">${esc(r.tache)}</p>
      ${r.erreur ? `<p class="erreur">${esc(r.erreur)}</p>` : ""}
      ${r.rapport ? `<button data-rapport="${esc(r.rapport)}">📄 Voir son rapport</button>` : ""}
      <h3>Ce qu'il a fait</h3>${this.listeActions(r.actions)}`;
  }

  private listeActions(actions: { heure: string; texte: string }[]): string {
    if (!actions.length) return "<p class='discret'>Rien pour l'instant.</p>";
    return `<ol class="actions">${actions.map((x) => `<li><time>${heure(x.heure)}</time> ${esc(x.texte)}</li>`).join("")}</ol>`;
  }

  private async voirRapport(id: string, chemin: string): Promise<void> {
    const m = this.etat.mission;
    if (!m) return;
    const r = await fetch(`/api/missions/${encodeURIComponent(m.nom)}/fichier?chemin=${encodeURIComponent(chemin)}`);
    this.ouvrir({ type: "rapport", id, markdown: r.ok ? await r.text() : "Rapport introuvable." });
  }

  private async ouvrirAncienne(nom: string): Promise<void> {
    const r = await fetch(`/api/missions/${encodeURIComponent(nom)}/resultat`);
    const markdown = r.ok ? await r.text() : "*Cette mission n'a pas de résultat (elle a été arrêtée ou interrompue). Ouvre son dossier pour voir les rapports des robots.*";
    this.ouvrir({ type: "resultat", nom, markdown });
  }
}
