// Les routes de Max : santé (libre), réveil et outils (protégés par le jeton du Bureau).
import type { EventEmitter } from "node:events";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import type { AssistantVue, VueEcran } from "../shared/protocol.ts";
import type { BureauConfig } from "./config.ts";
import { jetonValide } from "./jeton.ts";
import { memoriser, oublier } from "./max/carnet.ts";
import { ajouterEcheance, decrireBilan, lireIdees, noterIdee, type Coach } from "./max/coach.ts";
import { trouverConseiller, type Conseillers } from "./max/conseillers.ts";
import { Confirmations } from "./max/confirmations.ts";
import type { Mac } from "./max/mac.ts";
import type { Verrou } from "./max/verrou.ts";
import type { Planning } from "./max/planning.ts";
import type { TriMails } from "./max/tri-mails.ts";
import type { Sport } from "./max/sport.ts";
import type { Vie } from "./max/vie.ts";
import type { Studio } from "./studio/studio.ts";
import type { Automatismes } from "./max/automatismes.ts";
import type { Plan } from "./max/plan.ts";
import { ARTEFACTS } from "../shared/artefacts.ts";
import type { Plateforme, RegleId } from "../shared/protocol.ts";
import type { Reveil } from "./max/reveil.ts";
import { decrireEtat, decrireHistorique } from "./max/descriptions.ts";
import type { MissionManager } from "./mission.ts";
import { listMissions } from "./storage.ts";

/** Ce que le serveur HTTP attend de l'assistant vocal (émet `etat` quand sa vue change). */
export interface AssistantApi extends EventEmitter {
  vue(): AssistantVue;
  reveiller(): void;
  veille(): void;
  veilleApresParole(): void;
  taire(): void;
  ecrire(texte: string): void;
  /** Une information pour Max, qu'il recevra avec le prochain message (ex. une session arrêtée depuis la page). */
  informer?(texte: string): void;
  /** Le dernier message de l'utilisateur (pour vérifier qu'il a bien dit oui). */
  dernierMessageUtilisateur?(): { texte: string; heure: number } | null;
  /** Change l'écran affiché : Jarvis ou le bureau. */
  allerA?(vue: VueEcran): void;
  /** Ouvre la fiche d'un pôle sur l'écran de Max (null : retour à l'accueil). */
  ouvrirPole?(pole: string | null, focus?: string | null): void;
  modeObscur?(actif: boolean, dire?: boolean): string;
}

const MAX_RESULTAT = 8000;

function repondre(res: http.ServerResponse, code: number, corps: object): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(corps));
}

async function lireCorps(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  let brut = "";
  for await (const morceau of req) {
    brut += morceau;
    if (brut.length > 64 * 1024) throw new Error("trop long");
  }
  if (!brut) return {};
  const j = JSON.parse(brut);
  return j && typeof j === "object" ? j : {};
}

export const estRouteMax = (chemin: string) => chemin === "/api/sante" || chemin === "/api/reveil" || chemin.startsWith("/api/outils/");

export function routesMax(o: {
  config: BureauConfig;
  manager: MissionManager;
  jeton?: string;
  assistant?: AssistantApi;
  coach?: Coach;
  conseillers?: Conseillers;
  mac?: Mac;
  verrou?: Verrou;
  planning?: Planning;
  triMails?: TriMails;
  sport?: Sport;
  vie?: Vie;
  studio?: Studio;
  automatismes?: Automatismes;
  plan?: Plan;
  reveil?: Reveil;
  ouvrirPage?: () => string;
}) {
  const root = path.resolve(o.config.dossierMissions);
  const confirmations = new Confirmations();

  const resultat = (nom: string | null): { ok: boolean; texte: string } => {
    const dossier = nom ? path.join(root, path.basename(nom)) : null;
    const contenu = dossier
      ? fs.existsSync(path.join(dossier, "RESULTAT.md"))
        ? fs.readFileSync(path.join(dossier, "RESULTAT.md"), "utf8")
        : null
      : (o.manager.snapshot().mission?.resultat ?? null);
    if (!contenu) return { ok: false, texte: "Pas de résultat disponible pour cette mission." };
    return { ok: true, texte: contenu.length > MAX_RESULTAT ? contenu.slice(0, MAX_RESULTAT) + "\n(… la suite est dans le fichier RESULTAT.md)" : contenu };
  };

  return async (req: http.IncomingMessage, res: http.ServerResponse, chemin: string, url: URL): Promise<void> => {
    if (chemin === "/api/sante") return repondre(res, 200, { bureau: true });
    if (!jetonValide(o.jeton, req.headers["x-bureau-jeton"])) return repondre(res, 403, { ok: false, texte: "Accès refusé : jeton du Bureau invalide." });

    let corps: Record<string, unknown> = {};
    try {
      if (req.method === "POST") corps = await lireCorps(req);
    } catch {
      return repondre(res, 400, { ok: false, texte: "Requête illisible." });
    }
    const texte = (cle: string) => String(corps[cle] ?? "").trim();
    const nombre = (cle: string) => (corps[cle] === undefined || corps[cle] === null || corps[cle] === "" ? undefined : Number(corps[cle]));
    const m = o.manager;
    const coach = o.coach;
    const conseillers = o.conseillers;
    /** Le pôle désigné (id, nom de l'agent ou domaine) ; vide = les études. */
    const pole = (t: string) => (t ? (conseillers ? trouverConseiller(conseillers.defs, t)?.id : t) : "etudes");
    const sansCoach = () => repondre(res, 503, { ok: false, texte: "Le coach n'est pas disponible." });
    const essayer = (f: () => string) => {
      try {
        return repondre(res, 200, { ok: true, texte: f() });
      } catch (e) {
        return repondre(res, 200, { ok: false, texte: (e as Error).message });
      }
    };

    // « Max au rapport » : la page s'ouvre (dans sa fenêtre), verrouillée ou non
    const fenetre = `${req.method} ${chemin}` === "POST /api/reveil" && corps.ouvrir === true && o.ouvrirPage ? o.ouvrirPage() : undefined;
    if (o.verrou?.verrouille) {
      if (`${req.method} ${chemin}` === "POST /api/reveil") {
        o.verrou.demander();
        return repondre(res, 200, { ok: true, texte: "Max est verrouillé : regarde la caméra.", fenetre });
      }
      return repondre(res, 423, { ok: false, texte: "Max est verrouillé : il faut d'abord te reconnaître à la caméra." });
    }

    switch (`${req.method} ${chemin}`) {
      case "POST /api/reveil":
        if (!o.assistant) return repondre(res, 503, { ok: false, texte: "Max n'est pas disponible." });
        o.assistant.reveiller();
        o.assistant.allerA?.("jarvis");
        return repondre(res, 200, { ok: true, texte: "Max est réveillé.", fenetre });
      case "GET /api/outils/etat":
        return repondre(res, 200, { ok: true, texte: decrireEtat(m.snapshot().mission) });
      case "POST /api/outils/lancer": {
        const r = m.lancer(texte("texte"));
        return repondre(res, 200, r.ok ? { ok: true, texte: "Mission lancée : l'équipe se met au travail." } : { ok: false, texte: r.erreur });
      }
      case "POST /api/outils/arreter": {
        const phase = m.snapshot().mission?.phase;
        if (!phase || !["planification", "travail", "relecture", "pause"].includes(phase)) return repondre(res, 200, { ok: false, texte: "Aucune mission en cours." });
        m.arreter();
        return repondre(res, 200, { ok: true, texte: "Mission arrêtée." });
      }
      case "POST /api/outils/reprendre": {
        const r = m.reprendre();
        return repondre(res, 200, r.ok ? { ok: true, texte: "Mission reprise." } : { ok: false, texte: r.erreur });
      }
      case "GET /api/outils/resultat":
        return repondre(res, 200, resultat(url.searchParams.get("nom")));
      case "GET /api/outils/historique":
        return repondre(res, 200, { ok: true, texte: decrireHistorique(listMissions(root)) });
      case "POST /api/outils/memoriser":
        try {
          return repondre(res, 200, { ok: true, texte: `Noté dans le carnet : ${memoriser(root, texte("note"))}` });
        } catch (e) {
          return repondre(res, 200, { ok: false, texte: (e as Error).message });
        }
      case "POST /api/outils/oublier": {
        const n = oublier(root, texte("texte"));
        return repondre(res, 200, { ok: true, texte: `${n} note(s) retirée(s) du carnet.` });
      }
      case "POST /api/outils/veille":
        o.assistant?.veilleApresParole();
        return repondre(res, 200, { ok: true, texte: "Max se met en veille après sa phrase." });
      // coach
      case "POST /api/outils/session": {
        if (!coach) return sansCoach();
        const p = pole(texte("pole"));
        if (!p) return repondre(res, 200, { ok: false, texte: `Pôle inconnu. Les pôles : ${conseillers?.defs.map((d) => d.id).join(", ")}.` });
        return repondre(res, 200, coach.demarrerSession(texte("sujet"), nombre("minutes") ?? 25, p));
      }
      case "POST /api/outils/pause":
        if (!coach) return sansCoach();
        return repondre(res, 200, coach.demarrerPause(nombre("minutes") ?? 5));
      case "POST /api/outils/fin-session":
        if (!coach) return sansCoach();
        return repondre(res, 200, coach.arreterSession(texte("note")));
      case "GET /api/outils/bilan":
        if (!coach) return sansCoach();
        return repondre(res, 200, { ok: true, texte: decrireBilan(coach.bilan()) });
      case "POST /api/outils/echeance":
        return essayer(() => `Échéance ajoutée dans moi.md : ${ajouterEcheance(root, texte("date"), texte("nom"))}`);
      case "POST /api/outils/idee":
        return essayer(() => `Idée mise au parking : ${noterIdee(root, texte("idee"))}`);
      case "GET /api/outils/idees": {
        const idees = lireIdees(root);
        return repondre(res, 200, { ok: true, texte: idees.length ? idees.join("\n") : "Aucune idée au parking." });
      }
      case "POST /api/outils/rappel":
        if (!coach) return sansCoach();
        return repondre(res, 200, coach.programmerRappel(texte("texte"), { dansMinutes: nombre("dans_minutes"), heure: texte("heure") || undefined }));
      case "GET /api/outils/rappels":
        if (!coach) return sansCoach();
        return repondre(res, 200, { ok: true, texte: coach.listeRappels() });
      case "POST /api/outils/annuler-rappel":
        if (!coach) return sansCoach();
        return repondre(res, 200, coach.annulerRappel(texte("texte")));
      // conseillers
      case "POST /api/outils/consulter":
        if (!conseillers) return repondre(res, 503, { ok: false, texte: "Les conseillers ne sont pas disponibles." });
        return repondre(res, 200, await conseillers.consulter(texte("conseiller"), texte("question")));
      case "POST /api/outils/noter-pour":
        if (!conseillers) return repondre(res, 503, { ok: false, texte: "Les conseillers ne sont pas disponibles." });
        return repondre(res, 200, conseillers.noterPour(texte("conseiller"), texte("note")));
      // le Mac
      case "POST /api/outils/app":
      case "POST /api/outils/site":
      case "POST /api/outils/youtube":
      case "POST /api/outils/volume":
      case "POST /api/outils/luminosite":
      case "POST /api/outils/capture":
      case "POST /api/outils/verrouiller":
      case "POST /api/outils/musique":
      case "POST /api/outils/contact":
      case "POST /api/outils/preparer-message":
      case "POST /api/outils/envoyer-message":
      case "GET /api/outils/mails":
      case "GET /api/outils/agenda":
      case "POST /api/outils/preparer-rdv":
      case "POST /api/outils/creer-rdv":
      case "GET /api/outils/meteo": {
        const mac = o.mac;
        if (!mac) return repondre(res, 503, { ok: false, texte: "Le pilotage du Mac n'est pas disponible." });
        const q = (cle: string) => (url.searchParams.get(cle) ?? "").trim();
        const dernier = () => o.assistant?.dernierMessageUtilisateur?.() ?? null;
        let r: { ok: boolean; texte: string };
        switch (chemin) {
          case "/api/outils/app":
            r = texte("action") === "fermer" ? await mac.fermerApp(texte("nom")) : await mac.ouvrirApp(texte("nom"));
            break;
          case "/api/outils/site":
            r = await mac.ouvrirSite(texte("url"));
            break;
          case "/api/outils/youtube":
            r = await mac.chercherYoutube(texte("recherche"));
            break;
          case "/api/outils/volume":
            r = await mac.volume(texte("niveau"));
            break;
          case "/api/outils/luminosite":
            r = await mac.luminosite(texte("sens") as "plus" | "moins", nombre("crans") ?? 2);
            break;
          case "/api/outils/capture":
            r = await mac.capture();
            break;
          case "/api/outils/verrouiller":
            r = await mac.verrouiller();
            break;
          case "/api/outils/musique":
            r = await mac.musique((texte("action") || "jouer") as "jouer", texte("recherche") || undefined);
            break;
          case "/api/outils/contact": {
            const c = await mac.chercherContact(texte("nom"));
            r = { ok: c.ok, texte: c.texte };
            break;
          }
          case "/api/outils/preparer-message": {
            const message = texte("texte");
            if (!message) {
              r = { ok: false, texte: "Le message est vide." };
              break;
            }
            const d = await mac.trouverDestinataire(texte("destinataire"));
            if (!d.ok) {
              r = d;
              break;
            }
            confirmations.preparer("message", `à ${d.nom} (${d.handle}) : « ${message} »`, () => mac.envoyerIMessage(d.handle, message));
            r = {
              ok: true,
              texte: `Message prêt pour ${d.nom} (${d.handle}) : « ${message} ». Il n'est PAS encore envoyé. Lis-le à l'utilisateur et demande-lui s'il confirme ; quand il répond oui, appelle envoyer_message.`,
            };
            break;
          }
          case "/api/outils/envoyer-message":
            r = await confirmations.confirmer("message", dernier());
            break;
          case "/api/outils/mails":
            r = await mac.lireMails(Number(q("n")) || 5, q("non_lus") !== "0");
            break;
          case "/api/outils/agenda": {
            const a = await mac.agenda(q("jour") || "aujourdhui");
            r = { ok: a.ok, texte: a.texte };
            break;
          }
          case "/api/outils/preparer-rdv": {
            const rdv = { titre: texte("titre"), date: texte("date"), heure: texte("heure"), minutes: nombre("minutes") ?? 60, calendrier: texte("calendrier") || undefined };
            const probleme = mac.validerRdv(rdv);
            if (probleme) {
              r = { ok: false, texte: probleme };
              break;
            }
            const resume = `« ${rdv.titre} » le ${mac.jour(rdv.date)} à ${rdv.heure}, ${rdv.minutes} minutes${rdv.calendrier ? `, calendrier ${rdv.calendrier}` : ""}`;
            confirmations.preparer("rdv", resume, () => mac.creerRdv(rdv));
            r = { ok: true, texte: `Rendez-vous prêt : ${resume}. Il n'est PAS encore ajouté. Demande à l'utilisateur s'il confirme ; quand il répond oui, appelle creer_rdv.` };
            break;
          }
          case "/api/outils/creer-rdv":
            r = await confirmations.confirmer("rdv", dernier());
            break;
          default: {
            const m = await mac.meteo(q("ville") || undefined);
            r = { ok: m.ok, texte: m.texte };
          }
        }
        return repondre(res, 200, r);
      }
      // l'emploi du temps du jour
      case "POST /api/outils/planning":
        if (!o.planning) return repondre(res, 503, { ok: false, texte: "L'emploi du temps n'est pas disponible." });
        return repondre(res, 200, o.planning.enregistrer(corps.creneaux));
      case "GET /api/outils/planning":
        if (!o.planning) return repondre(res, 503, { ok: false, texte: "L'emploi du temps n'est pas disponible." });
        return repondre(res, 200, { ok: true, texte: o.planning.decrire() });
      case "POST /api/outils/preparer-planning-calendrier": {
        const planning = o.planning;
        const mac = o.mac;
        if (!planning || !mac) return repondre(res, 503, { ok: false, texte: "Le Calendrier n'est pas disponible." });
        const creneaux = planning.creneauxDates();
        if (!creneaux.length) return repondre(res, 200, { ok: false, texte: "Il n'y a pas encore d'emploi du temps aujourd'hui." });
        if (planning.vue()?.calendrier) return repondre(res, 200, { ok: false, texte: "Cet emploi du temps est déjà dans le Calendrier." });
        const calendrier = texte("calendrier") || undefined;
        confirmations.preparer("planning", `${creneaux.length} créneaux${calendrier ? ` dans le calendrier ${calendrier}` : ""}`, async () => {
          let ajoutes = 0;
          for (const c of creneaux) if ((await mac.creerRdv({ ...c, calendrier })).ok) ajoutes++;
          if (ajoutes) planning.marquerCalendrier();
          return ajoutes === creneaux.length
            ? { ok: true, texte: `Les ${ajoutes} créneaux sont dans ton Calendrier.` }
            : { ok: ajoutes > 0, texte: `${ajoutes} créneau(x) sur ${creneaux.length} ajouté(s) au Calendrier.` };
        }, { ouiAvant: true });
        return repondre(res, 200, {
          ok: true,
          texte: `Prêt à ajouter ${creneaux.length} créneaux au Calendrier. Rien n'est encore ajouté. S'il vient de te dire oui pour l'ajouter, appelle ajouter_planning_calendrier tout de suite ; sinon demande-lui d'abord.`,
        });
      }
      case "POST /api/outils/ajouter-planning-calendrier":
        return repondre(res, 200, await confirmations.confirmer("planning", o.assistant?.dernierMessageUtilisateur?.() ?? null));
      // les mails triés
      case "POST /api/outils/trier-mails": {
        if (!o.mac || !o.triMails) return repondre(res, 503, { ok: false, texte: "Les mails ne sont pas disponibles." });
        const l = await o.mac.listerMails(nombre("nombre") ?? 20, corps.non_lus !== false);
        if (!l.ok) return repondre(res, 200, { ok: false, texte: l.texte });
        o.triMails.retenir(l.mails);
        return repondre(res, 200, {
          ok: true,
          texte: l.mails.length
            ? `${l.texte}\n\nClasse chaque mail par son numéro dans a_traiter, etudes, business, perso ou pubs, puis appelle afficher_mails.`
            : l.texte,
        });
      }
      case "POST /api/outils/afficher-mails": {
        if (!o.triMails) return repondre(res, 503, { ok: false, texte: "Les mails ne sont pas disponibles." });
        const cats = corps.categories && typeof corps.categories === "object" ? (corps.categories as Record<string, unknown>) : {};
        return repondre(res, 200, o.triMails.afficher(cats, texte("resume")));
      }
      case "POST /api/outils/preparer-rangement": {
        const tri = o.triMails;
        const mac = o.mac;
        if (!mac || !tri) return repondre(res, 503, { ok: false, texte: "Les mails ne sont pas disponibles." });
        const ids = Array.isArray(corps.ids) && corps.ids.length ? tri.connus(corps.ids) : tri.ids("pubs");
        if (!ids.length) return repondre(res, 200, { ok: false, texte: "Aucun mail à ranger (trie d'abord les mails)." });
        const dossier = texte("dossier") || "Max - Pubs";
        confirmations.preparer("rangement", `${ids.length} mail(s) dans « ${dossier} »`, () => mac.rangerMails(ids, dossier), { ouiAvant: true });
        return repondre(res, 200, {
          ok: true,
          texte: `Prêt à ranger ${ids.length} mail(s) dans le dossier « ${dossier} » de Mail. Rien n'est encore déplacé. S'il vient de te dire oui pour les ranger, appelle ranger_mails tout de suite ; sinon demande-lui d'abord.`,
        });
      }
      case "POST /api/outils/ranger-mails":
        return repondre(res, 200, await confirmations.confirmer("rangement", o.assistant?.dernierMessageUtilisateur?.() ?? null));
      // les pôles et le sport
      case "POST /api/outils/regle": {
        if (!o.plan) return repondre(res, 503, { ok: false, texte: "Le plan n'est pas disponible." });
        return repondre(res, 200, o.plan.cocher(texte("regle") as RegleId, corps.tenue !== false));
      }
      case "POST /api/outils/automatisme": {
        const au = o.automatismes;
        if (!au) return repondre(res, 503, { ok: false, texte: "Les automatismes ne sont pas disponibles." });
        const id = texte("id");
        if (!id) return repondre(res, 200, { ok: true, texte: au.vue().map((a) => `- ${a.id} : ${a.nom} à ${a.heure} (${a.actif ? "actif" : "coupé"}${a.faitAujourdhui ? ", fait aujourd'hui" : ""}) — ${a.description}${a.resultat ? `. Dernier résultat : ${a.resultat}` : ""}`).join("\n") });
        if (!au.vue().some((a) => a.id === id)) return repondre(res, 400, { ok: false, texte: `Automatisme inconnu : ${id}.` });
        if (typeof corps.actif === "boolean") {
          au.activer(id, corps.actif);
          return repondre(res, 200, { ok: true, texte: `${id} ${corps.actif ? "activé" : "coupé"}.` });
        }
        return repondre(res, 200, { ok: true, texte: await au.lancer(id) });
      }
      case "POST /api/outils/artefact": {
        const cle = texte("artefact").toLowerCase();
        const art = ARTEFACTS.find((x) => x.id === cle || x.nom.toLowerCase().includes(cle));
        if (!art) return repondre(res, 400, { ok: false, texte: `Artefact inconnu : ${cle}. Il y a : ${ARTEFACTS.map((x) => x.nom).join(", ")}.` });
        if (!o.mac) return repondre(res, 503, { ok: false, texte: "Je ne peux pas ouvrir de page ici." });
        const ra = await o.mac.ouvrirSite(art.url);
        return repondre(res, 200, ra.ok ? { ok: true, texte: `${art.nom} est ouvert dans ton navigateur.` } : ra);
      }
      case "POST /api/outils/obscur": {
        if (!o.assistant?.modeObscur) return repondre(res, 503, { ok: false, texte: "Max n'est pas disponible." });
        return repondre(res, 200, { ok: true, texte: o.assistant.modeObscur(corps.actif !== false && corps.actif !== "false") });
      }
      case "POST /api/outils/pole": {
        const t = texte("pole");
        if (!t || /^(accueil|aucun|fermer)$/i.test(t)) {
          o.assistant?.ouvrirPole?.(null);
          return repondre(res, 200, { ok: true, texte: "Retour à l'accueil." });
        }
        const d = conseillers && trouverConseiller(conseillers.defs, t);
        if (!d) return repondre(res, 200, { ok: false, texte: `Pôle inconnu. Les pôles : ${conseillers?.defs.map((x) => `${x.id} (${x.domaine})`).join(", ")}.` });
        o.assistant?.allerA?.("jarvis");
        const corps = texte("focus") === "corps" && d.id === "sante";
        o.assistant?.ouvrirPole?.(d.id, corps ? "corps" : null);
        return repondre(res, 200, {
          ok: true,
          texte: corps
            ? "Son corps en 3D est affiché en grand sur l'écran, muscles colorés selon ses 14 derniers jours ; la caméra s'allume pour suivre sa main."
            : `Fiche ${d.domaine} (${d.nom}) ouverte sur l'écran.`,
        });
      }
      case "POST /api/outils/seance":
        if (!o.sport) return repondre(res, 503, { ok: false, texte: "Le suivi du sport n'est pas disponible." });
        return repondre(res, 200, o.sport.noter(texte("seance"), { jour: texte("jour") || undefined, note: texte("note") || undefined }));
      case "GET /api/outils/studio":
      case "POST /api/outils/script-video":
      case "POST /api/outils/publier-video":
      case "POST /api/outils/video-publiee":
      case "POST /api/outils/planifier-video": {
        const s = o.studio;
        if (!s) return repondre(res, 503, { ok: false, texte: "Le Studio n'est pas configuré (dossier iCloud Drive introuvable)." });
        const plateforme = texte("plateforme") as Plateforme;
        if (chemin.endsWith("studio")) return repondre(res, 200, { ok: true, texte: s.decrire() + "\n" + s.vue().videos.slice(-8).map((v) => `- ${v.titre} (${v.compte}) : ${v.statut}${v.jour ? `, prévue le ${v.jour}` : ""}${Object.keys(v.publiee).length ? `, postée sur ${Object.keys(v.publiee).join(", ")}` : ""}`).join("\n") });
        if (chemin.endsWith("script-video")) return repondre(res, 200, s.script(texte("compte"), texte("titre"), String(corps.texte ?? "")));
        if (chemin.endsWith("planifier-video")) return repondre(res, 200, s.replanifier(texte("video"), texte("jour")));
        if (!["tiktok", "youtube", "instagram"].includes(plateforme)) return repondre(res, 400, { ok: false, texte: "Plateforme : tiktok, youtube ou instagram." });
        if (chemin.endsWith("publier-video")) return repondre(res, 200, await s.publier(texte("video"), plateforme));
        return repondre(res, 200, s.marquerPubliee(texte("video"), plateforme));
      }
      case "POST /api/outils/projet": {
        if (!o.vie) return repondre(res, 503, { ok: false, texte: "Tes projets ne sont pas disponibles." });
        const opt = (k: string) => (corps[k] === undefined || corps[k] === null ? undefined : String(corps[k]));
        const ch = Object.fromEntries(["id", "nom", "domaine", "categorie", "objectif", "prochaineAction", "echeance", "statut"].map((k) => [k, opt(k)]));
        return repondre(res, 200, o.vie.projet(ch));
      }
      case "POST /api/outils/journal":
        if (!o.vie) return repondre(res, 503, { ok: false, texte: "Ton journal n'est pas disponible." });
        return repondre(res, 200, o.vie.ecrire(texte("texte"), { bilan: corps.bilan === true, humeur: nombre("humeur") }));
      case "GET /api/outils/journal": {
        if (!o.vie) return repondre(res, 503, { ok: false, texte: "Ton journal n'est pas disponible." });
        const jours = o.vie.journal(7);
        const t = jours.map((j) => `${j.jour}${j.humeur ? ` (humeur ${j.humeur}/5)` : ""}\n${j.notes.map((n) => `- ${n.heure} ${n.texte}`).join("\n")}${j.bilan ? `\nBilan : ${j.bilan}` : ""}`).join("\n\n");
        return repondre(res, 200, { ok: true, texte: t || "Le journal est vide." });
      }
      case "GET /api/outils/sport":
        if (!o.sport) return repondre(res, 503, { ok: false, texte: "Le suivi du sport n'est pas disponible." });
        return repondre(res, 200, { ok: true, texte: o.sport.decrire() });
      case "POST /api/outils/semaine-sport": {
        if (!o.sport) return repondre(res, 503, { ok: false, texte: "Le suivi du sport n'est pas disponible." });
        const ch = Array.isArray(corps.changements) ? (corps.changements as { jour: string; seance: string }[]) : [];
        if (!ch.length) return repondre(res, 200, { ok: false, texte: "Aucun changement donné." });
        return repondre(res, 200, o.sport.changerSemaine(ch.slice(0, 7)));
      }
      // le réveil par appel
      case "POST /api/outils/reveil":
      case "POST /api/outils/annuler-reveil":
      case "GET /api/outils/reveil":
      case "POST /api/outils/essai-reveil": {
        const rv = o.reveil;
        if (!rv) return repondre(res, 503, { ok: false, texte: "Le réveil n'est pas disponible." });
        if (chemin === "/api/outils/annuler-reveil") return repondre(res, 200, rv.annulerProchain());
        if (chemin === "/api/outils/essai-reveil") return repondre(res, 200, await rv.essayer());
        if (req.method === "GET") return repondre(res, 200, { ok: true, texte: rv.decrire() });
        return repondre(res, 200, rv.regler(texte("heure"), { quotidien: corps.tous_les_jours === true }));
      }
      case "POST /api/outils/vue": {
        const vue = texte("vue");
        if (vue !== "jarvis" && vue !== "bureau") return repondre(res, 200, { ok: false, texte: "Écran inconnu : jarvis ou bureau." });
        o.assistant?.allerA?.(vue);
        return repondre(res, 200, { ok: true, texte: vue === "bureau" ? "Direction le bureau." : "Retour à l'écran de Max." });
      }
      default:
        return repondre(res, 404, { ok: false, texte: "Outil inconnu." });
    }
  };
}
