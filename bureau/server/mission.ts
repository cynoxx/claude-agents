import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { ActionVue, EtatBureau, EtatFichier, MissionVue, Phase, RobotVue } from "../shared/protocol.ts";
import type { BureauConfig, Projet } from "./config.ts";
import { runAgent, type AgentHandle, type RunResult } from "./agent-runner.ts";
import type { Traduction } from "./event-translator.ts";
import { commitAll, createWorktree, ProjetInvalide } from "./git-worktree.ts";
import { parsePlan, PlanInvalide, PLAN_JSON_SCHEMA, type Plan } from "./plan-schema.ts";
import { planPrompt, resumePrompt, reviewPrompt, robotPrompt } from "./prompts.ts";
import { planArgs, reviewArgs, robotArgs, ROLES } from "./roles.ts";
import { appendJournal, createMissionDir, slugify, writeEtat } from "./storage.ts";

type Resultat = { ok: true } | { ok: false; erreur: string };

interface RobotInterne {
  vue: RobotVue;
  dossier: string;
  rapportPath: string;
  sessionId?: string;
}

const MAX_ACTIONS = 200;
const EN_COURS: Phase[] = ["planification", "travail", "relecture"];
const STATUT_FICHIER: Partial<Record<Phase, EtatFichier["statut"]>> = {
  termine: "terminee",
  pause: "en-pause",
  echec: "echouee",
  arrete: "arretee",
};

class Arret extends Error {}

/** Orchestre une mission à la fois : plan par Max → étapes de robots en parallèle → relecture par Max. */
export class MissionManager extends EventEmitter {
  private mission: MissionVue | null = null;
  private dir = "";
  private plan: Plan | null = null;
  private robots: RobotInterne[] = [];
  private worktree?: { path: string; branche: string };
  private handles = new Set<AgentHandle>();
  private courant: Promise<void> | null = null;
  private arretDemande = false;
  private reprise: "plan" | "travail" | "relecture" = "plan";

  constructor(
    private config: BureauConfig,
    private bin: string,
    private claude: EtatBureau["claude"] = { ok: true },
  ) {
    super();
  }

  setClaude(etat: EtatBureau["claude"]): void {
    this.claude = etat;
    this.changer();
  }

  snapshot(): EtatBureau {
    return structuredClone({ claude: this.claude, mission: this.mission });
  }

  attendreFin(): Promise<void> {
    return this.courant ?? Promise.resolve();
  }

  lancer(texte: string): Resultat {
    if (!this.claude.ok) return { ok: false, erreur: `Claude Code n'est pas prêt : ${this.claude.erreur ?? "inconnu"}` };
    if (!texte.trim()) return { ok: false, erreur: "Écris d'abord la mission." };
    if (this.mission && EN_COURS.includes(this.mission.phase)) return { ok: false, erreur: "Une mission est déjà en cours." };
    if (this.mission?.phase === "pause") return { ok: false, erreur: "Une mission est en pause : reprends-la ou arrête-la d'abord." };

    const debut = new Date();
    this.dir = createMissionDir(this.config.dossierMissions, slugify(texte), debut);
    fs.writeFileSync(path.join(this.dir, "MISSION.md"), `# Mission\n\n${texte}\n`);
    this.plan = null;
    this.robots = [];
    this.worktree = undefined;
    this.arretDemande = false;
    this.reprise = "plan";
    this.mission = {
      nom: path.basename(this.dir),
      texte,
      titre: texte.split("\n")[0].slice(0, 80),
      phase: "planification",
      etape: 0,
      totalEtapes: 0,
      debut: debut.toISOString(),
      max: { bulle: "", actions: [] },
      robots: [],
    };
    this.demarrer();
    return { ok: true };
  }

  reprendre(): Resultat {
    if (this.mission?.phase !== "pause") return { ok: false, erreur: "Aucune mission en pause." };
    this.arretDemande = false;
    this.demarrer();
    return { ok: true };
  }

  arreter(): void {
    if (!this.mission) return;
    if (this.mission.phase === "pause") {
      this.terminer("arrete");
      return;
    }
    if (!EN_COURS.includes(this.mission.phase)) return;
    this.arretDemande = true;
    for (const h of this.handles) h.stop();
  }

  // --- déroulé ---------------------------------------------------------------

  private demarrer(): void {
    this.courant = this.derouler().catch((e) => {
      if (e instanceof Arret) return this.terminer("arrete");
      this.mission!.erreur = (e as Error).message;
      this.journal("bureau", `Erreur : ${(e as Error).message}`);
      this.terminer("echec");
    });
  }

  private async derouler(): Promise<void> {
    if (this.reprise === "plan" && !(await this.planifier())) return;
    if (this.reprise === "travail" && !(await this.travailler())) return;
    await this.relire();
  }

  private async planifier(): Promise<boolean> {
    this.phase("planification");
    this.maxDit("Je découpe la mission…");
    const projets = this.config.projets.filter((p) => fs.existsSync(p.chemin));
    let derniereErreur = "";
    for (let essai = 1; essai <= 2; essai++) {
      const r = await this.lancerAgent(
        {
          args: planArgs({
            prompt: planPrompt(this.mission!.texte, projets, this.config.limites),
            model: this.config.modeles.chef,
            schema: PLAN_JSON_SCHEMA,
            extraDirs: projets.map((p) => p.chemin),
          }),
          cwd: this.dir,
          mode: "json",
          timeoutMs: this.delai(),
        },
        (t) => this.maxTraduction(t),
      );
      if (r.quota) return this.pause("plan");
      if (!r.ok) {
        derniereErreur = r.erreur ?? "erreur inconnue";
        continue;
      }
      try {
        const brut = r.structured ?? JSON.parse(r.texte);
        this.plan = parsePlan(brut, this.config.limites, this.config.projets.map((p) => p.nom));
        break;
      } catch (e) {
        derniereErreur = e instanceof PlanInvalide ? e.message : `réponse illisible (${(e as Error).message})`;
        this.journal("max", `Plan refusé : ${derniereErreur}`);
      }
    }
    if (!this.plan) throw new Error(`Max n'a pas réussi à planifier : ${derniereErreur}`);

    fs.writeFileSync(path.join(this.dir, "plan.json"), JSON.stringify(this.plan, null, 2));
    this.mission!.titre = this.plan.titre;
    this.mission!.totalEtapes = this.plan.etapes.length;
    this.creerRobots(this.plan);
    await this.preparerProjet(this.plan);
    this.maxDit(this.plan.annonce || "Voici mon équipe !");
    this.reprise = "travail";
    this.mission!.etape = 0;
    return true;
  }

  private creerRobots(plan: Plan): void {
    const compte: Record<string, number> = {};
    const total: Record<string, number> = {};
    plan.etapes.forEach((e) => e.robots.forEach((r) => (total[r.role] = (total[r.role] ?? 0) + 1)));
    this.robots = plan.etapes.flatMap((e, etape) =>
      e.robots.map((r) => {
        const n = (compte[r.role] = (compte[r.role] ?? 0) + 1);
        const id = `${r.role}-${n}`;
        const dossier = path.join(this.dir, "equipe", id);
        fs.mkdirSync(dossier, { recursive: true });
        const nom = total[r.role] > 1 ? `${ROLES[r.role].nom} ${n}` : ROLES[r.role].nom;
        return {
          dossier,
          rapportPath: path.join(dossier, "rapport.md"),
          vue: { id, role: r.role, nom, tache: r.tache, etape, statut: "attente", bulle: "", actions: [] },
        };
      }),
    );
    this.mission!.robots = this.robots.map((r) => r.vue);
  }

  private async preparerProjet(plan: Plan): Promise<void> {
    if (!plan.projet) return;
    const projet = this.config.projets.find((p) => p.nom === plan.projet) as Projet;
    try {
      const w = await createWorktree(projet.chemin, path.join(this.dir, "code", slugify(projet.nom)), plan.slug);
      this.worktree = { path: w.path, branche: w.branch };
      this.mission!.branche = w.branch;
      this.journal("bureau", `Branche ${w.branch} créée dans ${projet.chemin}`);
    } catch (e) {
      const msg = e instanceof ProjetInvalide ? e.message : `Impossible de préparer le projet : ${(e as Error).message}`;
      for (const r of this.robots.filter((r) => r.vue.role === "codeur")) {
        this.robotFin(r, "erreur", msg, "Je ne trouve pas le projet");
      }
    }
  }

  private async travailler(): Promise<boolean> {
    const plan = this.plan!;
    for (let etape = this.mission!.etape; etape < plan.etapes.length; etape++) {
      this.mission!.etape = etape;
      this.phase("travail");
      const groupe = this.robots.filter((r) => r.vue.etape === etape && (r.vue.statut === "attente" || r.vue.statut === "quota"));
      const issues = await Promise.allSettled(groupe.map((r) => this.faireTravailler(r)));
      if (this.arretDemande) throw new Arret();
      const echec = issues.find((i): i is PromiseRejectedResult => i.status === "rejected");
      if (echec) throw echec.reason;
      if (this.worktree && groupe.some((r) => r.vue.role === "codeur")) {
        await commitAll(this.worktree.path, `Bureau : ${plan.titre}`).catch((e) => this.journal("bureau", `Commit impossible : ${e.message}`));
      }
      if (this.robots.some((r) => r.vue.statut === "quota")) return this.pause("travail");
    }
    this.reprise = "relecture";
    return true;
  }

  private async faireTravailler(r: RobotInterne): Promise<void> {
    const codeur = r.vue.role === "codeur" && this.worktree;
    const reprise = r.vue.statut === "quota" ? r.sessionId : undefined;
    const precedents = this.robots
      .filter((p) => p.vue.etape < r.vue.etape && p.vue.rapport)
      .map((p) => ({ nom: p.vue.nom, chemin: path.join(this.dir, p.vue.rapport!) }));
    const prompt = reprise
      ? resumePrompt(r.rapportPath)
      : robotPrompt({
          texte: this.mission!.texte,
          nom: r.vue.nom,
          tache: r.vue.tache,
          dossier: r.dossier,
          rapportPath: r.rapportPath,
          precedents,
          worktree: codeur ? this.worktree : undefined,
        });

    r.vue.statut = "travail";
    r.vue.erreur = undefined;
    r.vue.bulle = reprise ? "Je reprends mon travail…" : "Je m'installe…";
    this.changer();

    const res = await this.lancerAgent(
      {
        args: robotArgs({
          role: r.vue.role,
          prompt,
          model: this.config.modeles.robots,
          extraDirs: codeur ? [r.dossier, this.dir] : [this.dir],
          resumeSessionId: reprise,
        }),
        cwd: codeur ? this.worktree!.path : r.dossier,
        mode: "stream",
        timeoutMs: this.delai(),
      },
      (t) => {
        if (t.sessionId) r.sessionId = t.sessionId;
        this.ajouter(r.vue, r.vue.id, t);
      },
    );
    if (res.sessionId) r.sessionId = res.sessionId;
    this.robotResultat(r, res);
  }

  private robotResultat(r: RobotInterne, res: RunResult): void {
    if (fs.existsSync(r.rapportPath)) r.vue.rapport = path.relative(this.dir, r.rapportPath);
    if (res.ok) return this.robotFin(r, "fini", undefined, "Fini ! Je vais voir Max");
    if (this.arretDemande) return this.robotFin(r, "arrete", "Arrêté", "Je rentre chez moi");
    if (res.quota) return this.robotFin(r, "quota", res.erreur, "Quota atteint, je fais une sieste");
    this.robotFin(r, "erreur", res.erreur, "Oups, un problème…");
  }

  private robotFin(r: RobotInterne, statut: RobotVue["statut"], erreur: string | undefined, bulle: string): void {
    r.vue.statut = statut;
    r.vue.erreur = erreur;
    r.vue.bulle = bulle;
    this.journal(r.vue.id, erreur ? `${statut} : ${erreur}` : statut);
    this.changer();
  }

  private async relire(): Promise<void> {
    this.phase("relecture");
    this.maxDit("Je relis le travail de l'équipe…");
    const r = await this.lancerAgent(
      {
        args: reviewArgs({
          prompt: reviewPrompt({
            texte: this.mission!.texte,
            robots: this.robots.map((x) => ({ nom: x.vue.nom, tache: x.vue.tache, rapport: x.vue.rapport, erreur: x.vue.erreur })),
            branche: this.worktree?.branche,
          }),
          model: this.config.modeles.chef,
        }),
        cwd: this.dir,
        mode: "stream",
        timeoutMs: this.delai(),
      },
      (t) => this.maxTraduction(t),
    );
    if (this.arretDemande) throw new Arret();
    if (r.quota) {
      this.pause("relecture");
      return;
    }

    const fichier = path.join(this.dir, "RESULTAT.md");
    if (!fs.existsSync(fichier)) {
      const secours = r.texte || `Max n'a pas pu écrire de synthèse (${r.erreur ?? "raison inconnue"}). Les rapports des robots sont dans le dossier equipe/.`;
      fs.writeFileSync(fichier, `# ${this.mission!.titre}\n\n${secours}\n`);
    }
    if (this.worktree) {
      const projet = this.config.projets.find((p) => p.nom === this.plan!.projet)!;
      const b = this.worktree.branche;
      fs.appendFileSync(
        fichier,
        `\n\n## Branche Git\n\nLe Codeur a travaillé sur la branche \`${b}\` du projet ${projet.nom}. Ta branche principale n'a pas été modifiée.\n\n\`\`\`bash\ncd "${projet.chemin}"\ngit diff HEAD...${b}   # voir les changements\ngit merge ${b}         # les garder\n\`\`\`\n`,
      );
    }
    this.mission!.resultat = fs.readFileSync(fichier, "utf8");
    this.maxDit("Mission terminée !");
    this.terminer("termine");
  }

  // --- utilitaires ----------------------------------------------------------

  private async lancerAgent(
    o: { args: string[]; cwd: string; mode: "stream" | "json"; timeoutMs: number },
    onTraduction: (t: Traduction) => void,
  ): Promise<RunResult> {
    if (this.arretDemande) throw new Arret();
    const h = runAgent({ bin: this.bin, ...o, onTraduction });
    this.handles.add(h);
    try {
      const r = await h.done;
      if (this.arretDemande && !r.ok) throw new Arret();
      return r;
    } finally {
      this.handles.delete(h);
    }
  }

  private delai(): number {
    return this.config.limites.minutesParRobot * 60_000;
  }

  private maxTraduction(t: Traduction): void {
    this.ajouter(this.mission!.max, "max", t);
  }

  private ajouter(cible: { bulle: string; actions: ActionVue[] }, qui: string, t: Traduction): void {
    if (!t.bulle && !t.action) return;
    if (t.bulle) cible.bulle = t.bulle;
    if (t.action) {
      cible.actions.push({ heure: new Date().toISOString(), texte: t.action });
      if (cible.actions.length > MAX_ACTIONS) cible.actions.splice(0, cible.actions.length - MAX_ACTIONS);
      this.journal(qui, t.action);
    }
    this.changer();
  }

  private maxDit(bulle: string): void {
    this.mission!.max.bulle = bulle;
    this.changer();
  }

  private pause(ou: "plan" | "travail" | "relecture"): false {
    this.reprise = ou;
    this.maxDit("Quota atteint : on fait une pause.");
    this.terminer("pause");
    return false;
  }

  private phase(p: Phase): void {
    this.mission!.phase = p;
    this.journal("bureau", `Phase : ${p}${p === "travail" ? ` (étape ${this.mission!.etape + 1})` : ""}`);
    this.sauverEtat("en-cours");
    this.changer();
  }

  private terminer(p: Phase): void {
    const m = this.mission!;
    m.phase = p;
    if (p === "arrete") {
      for (const r of this.robots) if (r.vue.statut === "travail" || r.vue.statut === "attente" || r.vue.statut === "quota") {
        r.vue.statut = "arrete";
        r.vue.bulle = "Je rentre chez moi";
      }
      m.max.bulle = "Mission arrêtée.";
    }
    if (p !== "pause") m.fin = new Date().toISOString();
    this.journal("bureau", `Phase : ${p}`);
    this.sauverEtat(STATUT_FICHIER[p] ?? "en-cours");
    this.changer();
  }

  private sauverEtat(statut: EtatFichier["statut"]): void {
    const m = this.mission!;
    writeEtat(this.dir, { statut, titre: m.titre, texte: m.texte, debut: m.debut, fin: m.fin, branche: m.branche });
  }

  private journal(qui: string, texte: string): void {
    if (this.dir) appendJournal(this.dir, { qui, texte });
  }

  private changer(): void {
    this.emit("etat", this.snapshot());
  }
}
