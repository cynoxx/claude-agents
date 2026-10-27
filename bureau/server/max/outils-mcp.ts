// Serveur MCP « bureau » : les outils de Max. Lancé par Claude Code (cerveau de Max), il appelle l'API du Bureau
// sur 127.0.0.1 avec le jeton lu dans BUREAU_JETON_FICHIER.
import fs from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BUREAU = process.env.BUREAU_URL ?? "http://127.0.0.1:4747";

const jeton = () => {
  try {
    return fs.readFileSync(process.env.BUREAU_JETON_FICHIER ?? "", "utf8").trim();
  } catch {
    return "";
  }
};

async function appeler(methode: "GET" | "POST", chemin: string, corps?: object) {
  let texte: string;
  let ok: boolean;
  try {
    const r = await fetch(BUREAU + chemin, {
      method: methode,
      headers: { "x-bureau-jeton": jeton(), "content-type": "application/json" },
      body: corps ? JSON.stringify(corps) : undefined,
    });
    const j = (await r.json().catch(() => null)) as { ok: boolean; texte: string } | null;
    ok = !!j?.ok;
    texte = j?.texte ?? `Réponse inattendue du Bureau (${r.status}).`;
  } catch (e) {
    ok = false;
    texte = `Le Bureau ne répond pas : ${(e as Error).message}`;
  }
  return { content: [{ type: "text" as const, text: texte }], isError: !ok };
}

const serveur = new McpServer({ name: "bureau", version: "1.0.0" });

serveur.registerTool(
  "lancer_mission",
  {
    description: "Lance une mission pour l'équipe de robots du Bureau (recherche, comparaison, rédaction, analyse, code…). Une seule mission à la fois.",
    inputSchema: { texte: z.string().min(1).describe("La consigne complète et précise de la mission : objectif, contexte, forme du résultat attendu") },
  },
  async ({ texte }) => appeler("POST", "/api/outils/lancer", { texte }),
);
serveur.registerTool("etat_bureau", { description: "Où en est la mission en cours et ce que fait chaque robot." }, async () => appeler("GET", "/api/outils/etat"));
serveur.registerTool("arreter_mission", { description: "Arrête la mission en cours." }, async () => appeler("POST", "/api/outils/arreter"));
serveur.registerTool("reprendre_mission", { description: "Reprend une mission mise en pause (quota atteint)." }, async () => appeler("POST", "/api/outils/reprendre"));
serveur.registerTool(
  "lire_resultat",
  {
    description: "Lit le résultat (RESULTAT.md) de la mission en cours, ou d'une mission passée si on donne son nom (voir historique_missions).",
    inputSchema: { nom: z.string().optional().describe("Nom de dossier d'une mission passée") },
  },
  async ({ nom }) => appeler("GET", `/api/outils/resultat${nom ? `?nom=${encodeURIComponent(nom)}` : ""}`),
);
serveur.registerTool("historique_missions", { description: "Les missions passées, les plus récentes d'abord." }, async () => appeler("GET", "/api/outils/historique"));
serveur.registerTool(
  "memoriser",
  {
    description: "Écrit une note durable dans ton carnet sur l'utilisateur (prénom, projets, goûts, habitudes). Une note courte par fait.",
    inputSchema: { note: z.string().min(1).describe("Le fait à retenir, en une phrase courte") },
  },
  async ({ note }) => appeler("POST", "/api/outils/memoriser", { note }),
);
serveur.registerTool(
  "oublier",
  {
    description: "Retire du carnet les notes qui contiennent ce texte.",
    inputSchema: { texte: z.string().min(1).describe("Un mot ou un morceau de phrase présent dans les notes à retirer") },
  },
  async ({ texte }) => appeler("POST", "/api/outils/oublier", { texte }),
);
serveur.registerTool(
  "mettre_en_veille",
  { description: "Met Max en veille (micro coupé) après la phrase en cours. À utiliser quand l'utilisateur te dit de te mettre en veille ou au revoir." },
  async () => appeler("POST", "/api/outils/veille"),
);

// --- coach : sessions de travail, bilan, échéances, idées, rappels ---

serveur.registerTool(
  "demarrer_session",
  {
    description: "Lance une session de travail minutée (le Bureau prévient à la fin et note le temps dans le journal). Une à la fois.",
    inputSchema: {
      sujet: z.string().describe("Ce qu'il va travailler, en quelques mots (ex. « Anatomie, chapitre 3 »)"),
      minutes: z.number().int().min(1).max(180).default(25).describe("Durée en minutes (25 par défaut)"),
      pole: z.string().default("etudes").describe("Le pôle de ce travail : etudes, business, apps, vie, sante (le temps est compté par pôle ; business a une limite par jour)"),
    },
  },
  async ({ sujet, minutes, pole }) => appeler("POST", "/api/outils/session", { sujet, minutes, pole }),
);
serveur.registerTool(
  "demarrer_pause",
  {
    description: "Lance une pause minutée (non comptée comme travail) ; le Bureau prévient à la fin.",
    inputSchema: { minutes: z.number().int().min(1).max(60).default(5).describe("Durée en minutes (5 par défaut)") },
  },
  async ({ minutes }) => appeler("POST", "/api/outils/pause", { minutes }),
);
serveur.registerTool(
  "arreter_session",
  {
    description: "Arrête la session de travail (ou la pause) en cours ; le temps réellement fait est noté.",
    inputSchema: { note: z.string().optional().describe("Ce qu'il a fait pendant la session, s'il l'a dit") },
  },
  async ({ note }) => appeler("POST", "/api/outils/fin-session", { note }),
);
serveur.registerTool("bilan_travail", { description: "Le temps de travail noté : aujourd'hui, hier, les 7 derniers jours, la série de jours d'affilée." }, async () =>
  appeler("GET", "/api/outils/bilan"),
);
serveur.registerTool(
  "ajouter_echeance",
  {
    description: "Ajoute une échéance (examen, rendu, rendez-vous) dans le fichier moi.md ; le Bureau en fait le compte à rebours.",
    inputSchema: { date: z.string().describe("Date au format AAAA-MM-JJ"), nom: z.string().min(1).describe("Ce qui a lieu ce jour-là") },
  },
  async ({ date, nom }) => appeler("POST", "/api/outils/echeance", { date, nom }),
);
serveur.registerTool(
  "noter_idee",
  {
    description: "Met une idée au parking (idees.md) pour y revenir plus tard, sans s'y lancer maintenant.",
    inputSchema: { idee: z.string().min(1).describe("L'idée, en une ou deux phrases") },
  },
  async ({ idee }) => appeler("POST", "/api/outils/idee", { idee }),
);
serveur.registerTool("lire_idees", { description: "Les idées au parking." }, async () => appeler("GET", "/api/outils/idees"));
serveur.registerTool(
  "programmer_rappel",
  {
    description: "Programme un rappel que Max dira à voix haute au moment voulu (si le Bureau est ouvert). Donne dans_minutes OU heure.",
    inputSchema: {
      texte: z.string().min(1).describe("La phrase exacte à dire au moment du rappel, adressée à l'utilisateur (ex. « Il est 23 heures, au lit ! »)"),
      dans_minutes: z.number().int().min(1).optional().describe("Dans combien de minutes"),
      heure: z.string().optional().describe("Heure au format HH:MM (demain si elle est déjà passée)"),
    },
  },
  async ({ texte, dans_minutes, heure }) => appeler("POST", "/api/outils/rappel", { texte, dans_minutes, heure }),
);
serveur.registerTool("liste_rappels", { description: "Les rappels programmés." }, async () => appeler("GET", "/api/outils/rappels"));
serveur.registerTool(
  "annuler_rappel",
  { description: "Annule les rappels qui contiennent ce texte.", inputSchema: { texte: z.string().min(1).describe("Un mot du rappel à annuler") } },
  async ({ texte }) => appeler("POST", "/api/outils/annuler-rappel", { texte }),
);

// --- conseillers : un par domaine de la vie ---

serveur.registerTool(
  "consulter_conseiller",
  {
    description:
      "Pose une question à un conseiller du Bureau (etudes, sante, business, apps, vie…). Il réfléchit à son bureau (avec recherche web si besoin) et renvoie sa réponse, en une minute environ.",
    inputSchema: {
      conseiller: z.string().min(1).describe("L'identifiant du conseiller (voir ta consigne), ex. « etudes »"),
      question: z.string().min(1).describe("La question complète, avec le contexte utile"),
    },
  },
  async ({ conseiller, question }) => appeler("POST", "/api/outils/consulter", { conseiller, question }),
);
serveur.registerTool(
  "noter_pour_conseiller",
  {
    description: "Écrit une note durable dans le carnet d'un conseiller (un fait utile pour son domaine).",
    inputSchema: { conseiller: z.string().min(1).describe("L'identifiant du conseiller"), note: z.string().min(1).describe("Le fait à retenir") },
  },
  async ({ conseiller, note }) => appeler("POST", "/api/outils/noter-pour", { conseiller, note }),
);

// --- le Mac : une liste fermée de gestes (pas de commande libre) ---

serveur.registerTool(
  "ouvrir_app",
  { description: "Ouvre une application du Mac (Safari, Notes, Spotify, WhatsApp…).", inputSchema: { nom: z.string().min(1).describe("Le nom de l'app tel qu'il apparaît dans le dossier Applications") } },
  async ({ nom }) => appeler("POST", "/api/outils/app", { nom, action: "ouvrir" }),
);
serveur.registerTool(
  "fermer_app",
  { description: "Ferme (quitte) une application du Mac.", inputSchema: { nom: z.string().min(1).describe("Le nom de l'app") } },
  async ({ nom }) => appeler("POST", "/api/outils/app", { nom, action: "fermer" }),
);
serveur.registerTool(
  "ouvrir_site",
  { description: "Ouvre une page web dans le navigateur (adresse http ou https).", inputSchema: { url: z.string().min(1).describe("L'adresse complète, https://…") } },
  async ({ url }) => appeler("POST", "/api/outils/site", { url }),
);
serveur.registerTool(
  "chercher_youtube",
  {
    description: "Ouvre une recherche YouTube. Pour une vidéo précise, trouve plutôt son adresse avec WebSearch et ouvre-la avec ouvrir_site.",
    inputSchema: { recherche: z.string().min(1) },
  },
  async ({ recherche }) => appeler("POST", "/api/outils/youtube", { recherche }),
);
serveur.registerTool(
  "regler_volume",
  { description: "Règle le volume du Mac.", inputSchema: { niveau: z.string().describe("Un nombre de 0 à 100, ou « plus », « moins », « muet »") } },
  async ({ niveau }) => appeler("POST", "/api/outils/volume", { niveau }),
);
serveur.registerTool(
  "regler_luminosite",
  {
    description: "Monte ou baisse la luminosité de l'écran.",
    inputSchema: { sens: z.enum(["plus", "moins"]), crans: z.number().int().min(1).max(16).default(2).describe("De combien de crans (2 par défaut)") },
  },
  async ({ sens, crans }) => appeler("POST", "/api/outils/luminosite", { sens, crans }),
);
serveur.registerTool("capture_ecran", { description: "Fait une capture de l'écran, enregistrée sur le Bureau du Mac." }, async () => appeler("POST", "/api/outils/capture"));
serveur.registerTool("verrouiller_ecran", { description: "Met l'écran en veille et le verrouille." }, async () => appeler("POST", "/api/outils/verrouiller"));
serveur.registerTool(
  "musique",
  {
    description: "Pilote la musique (Spotify s'il est installé, sinon Musique) : jouer, pause, suivant, precedent, quoi (ce qui joue). Avec une recherche, lance ou cherche cette musique.",
    inputSchema: {
      action: z.enum(["jouer", "pause", "suivant", "precedent", "quoi"]),
      recherche: z.string().optional().describe("Un artiste, un morceau, une playlist ou un style (avec l'action jouer)"),
    },
  },
  async ({ action, recherche }) => appeler("POST", "/api/outils/musique", { action, recherche }),
);
serveur.registerTool(
  "chercher_contact",
  { description: "Cherche un contact dans Contacts (numéros et adresses).", inputSchema: { nom: z.string().min(1) } },
  async ({ nom }) => appeler("POST", "/api/outils/contact", { nom }),
);
serveur.registerTool(
  "preparer_message",
  {
    description:
      "Prépare un iMessage (rien n'est envoyé). Lis ensuite le destinataire et le texte à l'utilisateur et demande-lui s'il confirme ; n'appelle envoyer_message qu'après son oui.",
    inputSchema: {
      destinataire: z.string().min(1).describe("Le nom du contact (ex. « Maman ») ou un numéro"),
      texte: z.string().min(1).describe("Le message exact à envoyer"),
    },
  },
  async ({ destinataire, texte }) => appeler("POST", "/api/outils/preparer-message", { destinataire, texte }),
);
serveur.registerTool(
  "envoyer_message",
  { description: "Envoie le message préparé, une fois que l'utilisateur a dit oui. Refusé s'il n'a pas confirmé." },
  async () => appeler("POST", "/api/outils/envoyer-message"),
);
serveur.registerTool(
  "lire_mails",
  {
    description: "Lit les derniers mails de la boîte de réception (app Mail) : expéditeur, sujet, début du texte.",
    inputSchema: { nombre: z.number().int().min(1).max(20).default(5), non_lus: z.boolean().default(true).describe("Seulement les non lus (par défaut)") },
  },
  async ({ nombre, non_lus }) => appeler("GET", `/api/outils/mails?n=${nombre}&non_lus=${non_lus ? 1 : 0}`),
);
serveur.registerTool(
  "agenda",
  {
    description: "Les rendez-vous d'un jour (app Calendrier, Google Agenda compris s'il y est ajouté).",
    inputSchema: { jour: z.string().default("aujourdhui").describe("« aujourdhui », « demain », « apres-demain » ou AAAA-MM-JJ") },
  },
  async ({ jour }) => appeler("GET", `/api/outils/agenda?jour=${encodeURIComponent(jour)}`),
);
serveur.registerTool(
  "preparer_rdv",
  {
    description: "Prépare un rendez-vous dans Calendrier (rien n'est ajouté). Demande ensuite confirmation ; n'appelle creer_rdv qu'après son oui.",
    inputSchema: {
      titre: z.string().min(1),
      date: z.string().describe("AAAA-MM-JJ, ou « aujourdhui », « demain »"),
      heure: z.string().describe("HH:MM"),
      minutes: z.number().int().min(5).max(1440).default(60).describe("Durée en minutes"),
      calendrier: z.string().optional().describe("Le nom d'un calendrier précis (sinon le premier modifiable)"),
    },
  },
  async (a) => appeler("POST", "/api/outils/preparer-rdv", a),
);
serveur.registerTool(
  "creer_rdv",
  { description: "Ajoute le rendez-vous préparé, une fois que l'utilisateur a dit oui. Refusé s'il n'a pas confirmé." },
  async () => appeler("POST", "/api/outils/creer-rdv"),
);
serveur.registerTool(
  "meteo",
  { description: "La météo du moment et du jour.", inputSchema: { ville: z.string().optional().describe("Une ville ; sinon celle de la config ou devinée") } },
  async ({ ville }) => appeler("GET", `/api/outils/meteo${ville ? `?ville=${encodeURIComponent(ville)}` : ""}`),
);

// --- l'emploi du temps du jour ---

const creneau = z.object({
  debut: z.string().describe("HH:MM"),
  fin: z.string().describe("HH:MM (un créneau du soir peut finir après minuit)"),
  titre: z.string().min(1),
  type: z.enum(["travail", "cours", "pause", "repas", "sport", "perso", "sommeil", "autre"]),
});
serveur.registerTool(
  "enregistrer_planning",
  {
    description:
      "Enregistre l'emploi du temps d'aujourd'hui (remplace le précédent) : il s'affiche sur l'écran et chaque créneau est annoncé quand il commence. À faire après son accord sur les créneaux.",
    inputSchema: { creneaux: z.array(creneau).min(1).max(40) },
  },
  async ({ creneaux }) => appeler("POST", "/api/outils/planning", { creneaux }),
);
serveur.registerTool("lire_planning", { description: "L'emploi du temps d'aujourd'hui, avec le créneau en cours." }, async () => appeler("GET", "/api/outils/planning"));
serveur.registerTool(
  "preparer_planning_calendrier",
  {
    description: "Prépare l'ajout de l'emploi du temps du jour au Calendrier (rien n'est ajouté). Demande-lui ensuite confirmation ; n'appelle ajouter_planning_calendrier qu'après son oui.",
    inputSchema: { calendrier: z.string().optional().describe("Le nom d'un calendrier précis (sinon le premier modifiable)") },
  },
  async ({ calendrier }) => appeler("POST", "/api/outils/preparer-planning-calendrier", { calendrier }),
);
serveur.registerTool(
  "ajouter_planning_calendrier",
  { description: "Ajoute l'emploi du temps préparé au Calendrier, une fois qu'il a dit oui. Refusé s'il n'a pas confirmé." },
  async () => appeler("POST", "/api/outils/ajouter-planning-calendrier"),
);

// --- les mails triés ---

serveur.registerTool(
  "trier_mails",
  {
    description: "Lit les derniers mails avec leur numéro, pour que tu les classes. Ensuite appelle afficher_mails avec ton classement.",
    inputSchema: {
      nombre: z.number().int().min(1).max(40).default(20),
      non_lus: z.boolean().default(true).describe("Seulement les non lus (par défaut)"),
    },
  },
  async ({ nombre, non_lus }) => appeler("POST", "/api/outils/trier-mails", { nombre, non_lus }),
);
serveur.registerTool(
  "afficher_mails",
  {
    description: "Affiche ton classement des mails sur l'écran de Max, par catégorie, avec un résumé.",
    inputSchema: {
      categories: z
        .object({
          a_traiter: z.array(z.number().int()).optional().describe("Ce qui demande une action ou une réponse rapide"),
          etudes: z.array(z.number().int()).optional(),
          business: z.array(z.number().int()).optional(),
          perso: z.array(z.number().int()).optional(),
          pubs: z.array(z.number().int()).optional().describe("Publicités, promotions, newsletters"),
        })
        .describe("Les numéros des mails dans chaque catégorie"),
      resume: z.string().describe("Une ou deux phrases : l'essentiel à retenir"),
    },
  },
  async ({ categories, resume }) => appeler("POST", "/api/outils/afficher-mails", { categories, resume }),
);
serveur.registerTool(
  "preparer_rangement",
  {
    description: "Prépare le rangement de mails dans un dossier de Mail (par défaut les pubs du dernier tri, dans « Max - Pubs »). Rien n'est déplacé : demande confirmation, puis ranger_mails après son oui.",
    inputSchema: {
      ids: z.array(z.number().int()).optional().describe("Les numéros des mails ; par défaut, la catégorie pubs du dernier tri"),
      dossier: z.string().optional().describe("Le nom du dossier (par défaut « Max - Pubs »)"),
    },
  },
  async ({ ids, dossier }) => appeler("POST", "/api/outils/preparer-rangement", { ids, dossier }),
);
serveur.registerTool(
  "ranger_mails",
  { description: "Range les mails préparés, une fois qu'il a dit oui. Refusé s'il n'a pas confirmé." },
  async () => appeler("POST", "/api/outils/ranger-mails"),
);

// --- l'écran ---

serveur.registerTool(
  "aller_au_bureau",
  { description: "Emmène l'utilisateur dans le bureau pixel art (avec les robots et les conseillers) quand il le demande." },
  async () => appeler("POST", "/api/outils/vue", { vue: "bureau" }),
);
serveur.registerTool("retour_jarvis", { description: "Revient à l'écran principal de Max (la sphère)." }, async () => appeler("POST", "/api/outils/vue", { vue: "jarvis" }));

// les pôles et le sport
serveur.registerTool(
  "ouvrir_pole",
  {
    description:
      "Ouvre sur ton écran la fiche d'un pôle (études, sport et santé, business, apps, vie), sans aller au bureau. focus « corps » sur la fiche sante montre son corps en 3D (« montre-moi mon corps »). pole « accueil » ferme la fiche.",
    inputSchema: {
      pole: z.string().describe("etudes, sante, business, apps, vie, ou accueil"),
      focus: z.enum(["corps"]).optional().describe("Pour la fiche sante : afficher le corps en grand"),
    },
  },
  async ({ pole, focus }) => appeler("POST", "/api/outils/pole", { pole, focus }),
);
serveur.registerTool(
  "mode_obscur",
  {
    description:
      "Max Ultime : active (actif true) ou quitte (actif false) le mode obscur, la version sombre et arrogante de Max pour se concentrer (écran rouge, session de travail sur les études). « mode obscur », « mode ultime », « Max Ultime », « mode concentration » ; « mode normal » pour sortir.",
    inputSchema: { actif: z.boolean().describe("true pour entrer dans le mode obscur, false pour en sortir") },
  },
  async ({ actif }) => appeler("POST", "/api/outils/obscur", { actif }),
);
serveur.registerTool(
  "noter_seance",
  {
    description: "Note la séance de sport faite (une par jour ; la dernière notée l'emporte) : pec_dos, bras_epaules (biceps-triceps-épaules), jambes ou repos.",
    inputSchema: {
      seance: z.string().describe("pec_dos, bras_epaules, jambes ou repos"),
      jour: z.string().optional().describe("AAAA-MM-JJ si ce n'est pas aujourd'hui"),
      note: z.string().optional().describe("Ce qu'il a fait (exercices, charges), en quelques mots"),
    },
  },
  async ({ seance, jour, note }) => appeler("POST", "/api/outils/seance", { seance, jour, note }),
);
serveur.registerTool("lire_studio", { description: "Le Studio vidéo : prochaines publications, vidéos prêtes, en retard ou en montage." }, async () => appeler("GET", "/api/outils/studio"));
serveur.registerTool(
  "script_video",
  {
    description: "Écrit le script d'une vidéo (le texte qu'il lira en s'enregistrant) dans le dossier du compte, lisible sur son iPhone. Titre = le nom qu'il donnera à son audio (ex. « Loi 9 »).",
    inputSchema: { compte: z.string().describe("asclepium ou fruit-tv"), titre: z.string(), texte: z.string() },
  },
  async (a) => appeler("POST", "/api/outils/script-video", a),
);
serveur.registerTool(
  "publier_video",
  {
    description: "Prépare la publication d'une vidéo prête : copie la légende, montre la vidéo dans le Finder et ouvre la page d'envoi. Sans video : la prochaine prévue sur cette plateforme.",
    inputSchema: { plateforme: z.enum(["tiktok", "youtube", "instagram"]), video: z.string().optional().describe("Titre ou id") },
  },
  async (a) => appeler("POST", "/api/outils/publier-video", a),
);
serveur.registerTool(
  "video_publiee",
  { description: "Note qu'une vidéo est postée sur une plateforme (quand il te le dit).", inputSchema: { video: z.string(), plateforme: z.enum(["tiktok", "youtube", "instagram"]) } },
  async (a) => appeler("POST", "/api/outils/video-publiee", a),
);
serveur.registerTool(
  "planifier_video",
  { description: "Change le jour prévu d'une vidéo prête.", inputSchema: { video: z.string(), jour: z.string().describe("AAAA-MM-JJ") } },
  async (a) => appeler("POST", "/api/outils/planifier-video", a),
);
serveur.registerTool(
  "projet",
  {
    description:
      "Crée ou met à jour un de ses projets (par id ou nom) : prochaine action, échéance, statut… Un champ vide (\"\") l'efface. Domaines : etudes, sante, business, apps, vie, esprit.",
    inputSchema: {
      id: z.string().optional(),
      nom: z.string().optional(),
      domaine: z.enum(["etudes", "sante", "business", "apps", "vie", "esprit"]).optional(),
      categorie: z.string().optional().describe("ex. « Vidéos monétisables », « PASS », « Argent »"),
      objectif: z.string().optional(),
      prochaineAction: z.string().optional().describe("La toute prochaine chose concrète à faire"),
      echeance: z.string().optional().describe("AAAA-MM-JJ"),
      statut: z.enum(["actif", "pause", "fini"]).optional(),
    },
  },
  async (a) => appeler("POST", "/api/outils/projet", a),
);
serveur.registerTool(
  "ecrire_journal",
  {
    description: "Écrit dans son journal du jour : une note (ce qu'il raconte de sa journée) ou le bilan du soir (bilan: true), avec son humeur de 1 à 5 si elle est connue.",
    inputSchema: { texte: z.string(), bilan: z.boolean().optional(), humeur: z.number().int().min(1).max(5).optional() },
  },
  async (a) => appeler("POST", "/api/outils/journal", a),
);
serveur.registerTool("lire_journal", { description: "Son journal des 7 derniers jours (notes, bilans, humeur)." }, async () => appeler("GET", "/api/outils/journal"));
serveur.registerTool("lire_sport", { description: "La séance du jour et de demain, la semaine type et les muscles travaillés ces 14 derniers jours." }, async () => appeler("GET", "/api/outils/sport"));
serveur.registerTool(
  "changer_semaine_sport",
  {
    description: "Change les jours fixes de sa semaine type de sport (ex. jeudi : jambes).",
    inputSchema: {
      changements: z
        .array(z.object({ jour: z.enum(["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"]), seance: z.enum(["pec_dos", "bras_epaules", "jambes", "repos"]) }))
        .min(1)
        .max(7),
    },
  },
  async ({ changements }) => appeler("POST", "/api/outils/semaine-sport", { changements }),
);

// le réveil : Max l'appelle sur son téléphone
serveur.registerTool(
  "regler_reveil",
  {
    description:
      "Règle l'heure de son réveil (sur le Mac, et par appel si configuré). Par défaut, seulement le prochain réveil (« demain à 8 h ») ; tous_les_jours pour changer son heure habituelle.",
    inputSchema: {
      heure: z.string().describe("HH:MM, par exemple 07:00"),
      tous_les_jours: z.boolean().default(false).describe("true pour changer l'heure de tous les jours"),
    },
  },
  async ({ heure, tous_les_jours }) => appeler("POST", "/api/outils/reveil", { heure, tous_les_jours }),
);
serveur.registerTool("annuler_reveil", { description: "Pas de réveil la prochaine fois (par exemple un jour sans cours)." }, async () => appeler("POST", "/api/outils/annuler-reveil"));
serveur.registerTool("etat_reveil", { description: "Le prochain réveil prévu, et si le réveil par appel est configuré." }, async () => appeler("GET", "/api/outils/reveil"));
serveur.registerTool("essayer_reveil", { description: "Un essai du réveil tout de suite (le Mac sonne, ou son téléphone en mode appel), quand il veut vérifier que ça marche." }, async () => appeler("POST", "/api/outils/essai-reveil"));

await serveur.connect(new StdioServerTransport());
