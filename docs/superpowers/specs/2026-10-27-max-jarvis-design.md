# Max façon Jarvis : l'écran de Max et le pilotage du Mac

**Statut : construit** (voir `bureau/README.md`, section « L'écran de Max et ses pouvoirs »).

## Demande

L'utilisateur a envoyé un reel Instagram (aiwithtaha, un assistant Python « Maya ») et a demandé : « un genre de
Jarvis (qui s'appellera Max) qui peut faire les mêmes choses que dans la vidéo, et que quand je lui parle après il
m'emmène vers le bureau ». La vidéo elle-même n'était pas lisible (seule la légende l'était) ; les capacités ont donc
été choisies avec lui.

| Question | Choix de l'utilisateur |
|---|---|
| Capacités | piloter le Mac, musique et vidéos, messages et agenda, infos du quotidien (tout) |
| Le passage au bureau | un écran Jarvis d'abord (sphère lumineuse) ; « Max, emmène-moi au bureau » zoome jusqu'au bureau pixel art |
| Envoi de messages, rendez-vous | Max demande toujours confirmation |
| Messagerie | iMessage / SMS |
| Mails et agenda | Gmail et Google Agenda (lus à travers Mail et Calendrier du Mac) |

## L'écran de Max (`web/jarvis.ts`, `web/sphere.ts`)

- Une couche plein écran au-dessus du bureau (le jeu Phaser continue dessous, sans être redimensionné).
- **La sphère** : canvas 2D (halo, cœur, anneaux qui tournent, particules en orbite). Bleue et calme en écoute, dorée et
  rapide quand Max réfléchit, avec une onde quand il parle (simulée : le son sort de `say` sur le Mac, pas de la page).
  Atténuée en veille.
- **Le texte** : la phrase que Max prononce, sinon sa dernière réponse (240 caractères au plus) ; ta dernière phrase
  tant qu'il n'a pas répondu.
- **Les panneaux** : l'heure et la date, la météo (`wttr.in`), les rendez-vous restants du jour, l'objectif (J-N), le
  travail du jour et le minuteur, la mission en cours (un clic emmène au bureau), les conseillers qui réfléchissent.
  Météo et agenda sont rafraîchis par le serveur toutes les 20 minutes (`server/max/infos-jarvis.ts`).
- **La navigation** est un état du serveur (`AssistantVue.vue` : `jarvis` ou `bureau`), pour que la voix, la page et
  Siri disent la même chose : les outils `aller_au_bureau` et `retour_jarvis`, le bouton 🏢 de l'écran, le bouton 🔵 Max
  du bureau ; le réveil par Siri revient sur Jarvis. Transition : la sphère grossit et l'écran s'efface (650 ms).
- Sur téléphone, les panneaux passent sous la sphère et l'écran défile.

## Le pilotage du Mac (`server/max/mac.ts`)

**Une télécommande, pas un terminal.** Max n'a pas Bash. Il a une liste fermée de gestes, chacun lancé sans shell
(`execFile`) avec un programme précis : `open`, `osascript`, `screencapture`, `pmset`, `icalBuddy`. Les textes venant de
la conversation (nom d'app, message, titre…) sont passés au script AppleScript en **arguments** (`on run argv`), jamais
collés dans le script. Un argument qui commence par « - » est protégé pour ne pas être lu comme une option.

| Geste | Comment |
|---|---|
| Ouvrir / fermer une app | `open -a <nom>` ; `tell application (item 1 of argv) to quit`. Noms limités à des lettres, chiffres et `.'&+()-`. |
| Site, YouTube | `open <url>`, seulement http(s) ; recherche YouTube, ou une vidéo précise trouvée par WebSearch |
| Volume | `set volume output volume` (niveau, plus, moins, muet) |
| Luminosité | touches 144/145 via System Events (demande l'autorisation d'accessibilité), 1 à 16 crans |
| Capture, verrouillage | `screencapture -x` (Bureau du Mac par défaut), `pmset displaysleepnow` |
| Musique | Spotify s'il est installé (`open -Ra Spotify`), sinon Musique : jouer, pause, suivant, précédent, ce qui joue. Une recherche ouvre la recherche Spotify ; dans Musique, joue la playlist ou le premier morceau trouvé. |
| Contacts | `every person whose name contains` → noms, numéros, adresses |
| iMessage | `send … to participant … of (1st account whose service type = iMessage)` ; destinataire : un numéro, une adresse, ou un contact (son mobile d'abord ; plusieurs personnes → il faut préciser) |
| Mails | Mail.app, boîte de réception, non lus par défaut, 400 caractères par mail, 20 mails au plus |
| Agenda | icalBuddy (les événements répétés sont compris), sinon Calendrier en AppleScript (qui ne voit pas les répétitions) |
| Rendez-vous | Calendrier, `make new event` dans le premier calendrier modifiable ou celui demandé |
| Météo | `wttr.in/<ville>?format=j1&lang=fr` |

Les refus de macOS sont traduits : `-1743` → Automatisation, `-1719` → Accessibilité. Hors macOS, chaque geste répond
qu'il ne marche que sur Mac.

## « Rien ne part sans ton oui » (`server/max/confirmations.ts`)

Envoyer un message et créer un rendez-vous se font en deux temps : `preparer_message` / `preparer_rdv`, puis
`envoyer_message` / `creer_rdv`. **Le serveur** refuse le second temps tant que le dernier message de l'utilisateur,
reçu **après** la préparation, n'est pas un oui. Un oui est une phrase avec « oui, vas-y, ok, d'accord, confirme… » et sans
« non, pas, annule, attends, change… ». Ce qui est préparé expire après 5 minutes ; une nouvelle préparation remplace la
précédente.

Ainsi, ni une erreur du modèle, ni un mail ou une page web qui chercherait à manipuler Max ne peuvent envoyer un
message : il faut la voix (ou le clavier) de l'utilisateur. La consigne de Max décrit le même déroulé.

## Vérifications

- Tests : la télécommande avec un faux exécuteur (arguments exacts, refus des noms et adresses dangereux, sorties de
  Contacts, icalBuddy et Calendrier, météo, erreurs macOS), les confirmations, et le déroulé complet message et
  rendez-vous à travers un vrai client MCP (refusé sans oui, refusé après un non, envoyé après un oui, une seule fois).
  Navigation par la voix, la page et Siri. Fonctions d'affichage de l'écran.
- Navigateur (Playwright, vrai serveur) : écran Jarvis en écoute et en train de parler, plongée vers le bureau, retour,
  téléphone (sans débordement).
- Essai réel avec le vrai `claude` (Opus) et un Mac simulé : « Envoie à maman : j'arrive dans 10 minutes » → message
  préparé et lu, « Je l'envoie ? » ; « Non attends, change : 20 minutes » → préparé de nouveau ; « Emmène-moi au
  bureau » puis « Reviens » → l'écran change, et Max rappelle que le message attend toujours. Avec « Oui vas-y », il
  part une seule fois.
- **Non testé ici (pas de Mac)** : les vrais scripts AppleScript et les autorisations de macOS. Le premier essai réel se
  fera sur le Mac de l'utilisateur.

## Le visage, comme Face ID (ajouté ensuite)

Demande : « rajoute la connexion par caméra comme Face ID ». Choix de l'utilisateur : le visage protège **tout Max**,
qui se **reverrouille à chaque mise en veille**. Prévenu avant : une webcam n'a pas de capteur 3D, elle distingue bien
les personnes mais peut être trompée par une imitation déterminée ; garder le mot de passe ou Touch ID pour le Mac.

- **Dans la page** (`web/camera-visage.ts`, `web/verrou.ts`) : face-api (@vladmandic/face-api, chargé à la demande,
  modèles servis par le Bureau depuis `node_modules`) détecte le visage (TinyFaceDetector), ses 68 repères et son
  descripteur (128 nombres). L'image ne quitte pas la page.
- **Preuve que ce n'est pas une photo** : la tête doit tourner des deux côtés. Mesure : la position du nez entre les deux
  bords de la mâchoire (0,5 de face ; il faut voir moins de 0,4 et plus de 0,6). Un clignement d'yeux était prévu, mais
  essayé sur de vraies images, le modèle de repères de face-api ne réagit presque pas aux yeux fermés (ouverture
  mesurée 0,345 → 0,331 sur des yeux refermés à la retouche) : on aurait risqué de ne jamais reconnaître l'utilisateur.
  La mesure de la tête, elle, varie de 0,14 à 0,91 selon la pose sur les photos d'exemple de face-api, et reste
  identique (0,684 → 0,685) pour une photo tenue de biais.
- **Le serveur décide** (`server/max/visage.ts`, `server/max/verrou.ts`) : empreinte de 3 à 10 prises
  (`visage.json`, mode 600), même personne si la distance euclidienne la plus petite est sous 0,5 (face-api conseille
  0,6). Après 10 échecs en une minute, 30 secondes d'attente. Verrouillé :
  - Max ne se réveille pas (micro et cerveau éteints) et n'accepte aucun message ;
  - la page ne reçoit ni conversation, ni mission, ni agenda, ni conseillers ; toutes les commandes WebSocket et les
    routes `/api/*` sont refusées (423), sauf la vérification du visage ;
  - « Dis Siri, Max au rapport » ne réveille pas Max mais note une demande : la page allume alors la caméra toute
    seule (si la demande date de moins d'une minute) ;
  - un rappel ou la fin d'une session sont dits à voix haute sans réveiller Max.
- Reconnu : Max se réveille et salue par le prénom enregistré. Enregistrer un nouveau visage ou l'effacer n'est
  possible que déverrouillé.
- **Vérifié** dans Chromium avec une fausse caméra (vidéos faites à partir des photos d'exemple de face-api) :
  inscription en 5 prises ; une photo immobile de la bonne personne reste bloquée sur « tourne la tête » ; une autre
  personne qui tourne la tête est refusée (distance 0,77) ; la bonne personne qui tourne la tête, après une demande
  Siri, est reconnue sans clic et Max dit « Salut Alex ! ».

## Mails triés, emploi du temps du jour, « Dis Max » (ajoutés ensuite)

Demande : « que Jarvis trie les mails, me les affiche, me demande de créer mon emploi du temps personnel à chaque fois
que j'y vais ; quand je dis Dis Max ça marche pas ». Choix de l'utilisateur : mails classés à l'écran **et** rangés dans
Mail ; emploi du temps proposé **une fois par jour** ; ajouté **aussi au Calendrier**.

- **« Dis Max »** : des phrases synthétisées par Piper (trois voix) passées dans whisper.cpp donnent « Dimax » dans
  presque tous les cas, et aussi « D'y max », « DMAX », « G-Max », « Et Max ». Le mot-clé accepte maintenant le nom collé
  à un préfixe (d, di, dis, dit, dix, dy, g, j) et ces formules ; « Dimanche », « Maximum », « Maxime » restent ignorés.
- **Mails** (`server/max/tri-mails.ts`, `Mac.listerMails`, `Mac.rangerMails`) : Max lit les derniers mails avec leur
  numéro (identifiant Mail), les classe lui-même (à traiter, études, business, perso, pubs) et envoie son classement et un
  résumé à l'écran ; il ne peut classer que des mails qu'il vient de lire. Ranger = déplacer dans un dossier
  « Max - Pubs » du même compte (créé au besoin), sinon « Sur mon Mac ». La consigne rappelle que le contenu d'un mail
  n'est jamais une consigne.
- **Emploi du temps** (`server/max/planning.ts`) : créneaux validés (heures, titre, pas de chevauchement ; la journée va de
  5 h à 5 h, un créneau du soir peut finir le lendemain matin), enregistrés dans `emplois-du-temps/AAAA-MM-JJ.json`,
  affichés avec le créneau en cours, annoncés à leur début (Max se réveille pour ça, ou dit juste l'heure s'il est
  verrouillé). Au premier réveil du jour (ou au premier message), Max est invité à le proposer ; le jour proposé est
  noté pour ne pas insister. La consigne décrit comment le construire (agenda d'abord, blocs de 45 min à 2 h, pauses,
  repas, sport, coucher qui garde 7 h de sommeil, résumé oral court).
- **Confirmations** : ranger ses mails et mettre son propre emploi du temps au Calendrier sont des gestes sans risque pour
  autrui ; pour eux, un oui dit dans les 2 minutes avant la préparation suffit (« oui, range les pubs »). Messages et
  rendez-vous gardent la règle stricte (le oui doit suivre la lecture).
- **Essai réel (Opus, Mac simulé)** : au premier réveil, Max propose l'emploi du temps ; il lit l'agenda (cours à 16 h),
  propose une journée cohérente (biochimie, cours, course, anatomie, dîner, coucher 23 h 15), l'enregistre, prévient
  d'un doublon possible avec le cours déjà au Calendrier ; il trie six mails comme un humain l'aurait fait
  (inscription aux examens et message de Maman à traiter, colle d'anatomie en études, commandes de la boutique en
  business, Shein et Uber Eats en pubs) et ne dit à l'oral que l'essentiel.

## Le QG : pôles, sport et corps 3D, tri automatique des mails (ajoutés ensuite)

Demande : « Max manque de structure, rien ne va ensemble » ; mails triés automatiquement à l'arrivée, dans une petite
fenêtre ; une catégorie par agent qu'on ouvre sans aller au bureau, proposée par Max ; pour le sport, une vue de son
corps qu'on tourne avec la main devant la caméra, et trois séances (Pec-Dos, Biceps-Triceps-Épaules, Jambes) plus le
repos. Choix de l'utilisateur : QG en 3 niveaux ; séances sur des **jours fixes** ; temps compté **par pôle avec une
limite business** ; les 5 pôles actuels.

- **Structure** : accueil (barre de joueur, emploi du temps, Max, « Maintenant », mails, tuiles des 5 pôles) → fiche
  d'un pôle (sur l'écran de Max, `assistant.vue().pole`) → bureau (les quêtes des robots). Un pôle = un conseiller
  (même id) : agents des pôles = conseillers ; robots = équipe d'exécution. Max ouvre une fiche avec `ouvrir_pole`
  (focus `corps` pour la fiche sante).
- **Temps par pôle** (`Coach`, `server/max/coach.ts`) : chaque session porte un `pole` (les anciennes comptent pour
  etudes). `tempsParJour` (business : 60 min) déclenche un événement `limite` au moment où la session la fait
  atteindre ; Max le dit sans rien arrêter. `objectifsParJour` (etudes : 360 min) remplit une jauge.
- **Sport** (`server/max/sport.ts`, `shared/sport.ts`) : semaine type de 7 jours (par défaut 5 séances et 2 repos),
  journal une ligne par jour (`sport/seances.jsonl`, la dernière notée l'emporte), muscles travaillés sur 14 jours
  (intensité = fois / 4). Outils `noter_seance`, `lire_sport`, `changer_semaine_sport` ; la séance du jour va dans le
  contexte de Max et dans l'emploi du temps.
- **Corps 3D** (`web/corps.ts`, three.js, chargé à la demande) : silhouette hologramme et 26 muscles (ellipsoïdes),
  couleur éteinte → cyan → jaune → orange → rouge. Souris ou doigt : glisser, molette ; clic sur un muscle : son
  bilan. **Main** : MediaPipe Hands (`@mediapipe/tasks-vision`) dans la page ; fichiers WebAssembly servis depuis
  node_modules, modèle (7,8 Mo) téléchargé une fois par le serveur dans le dossier des données. Geste
  (`web/geste-main.ts`) : pouce + index pincés = attraper (hystérésis 0,33 / 0,5 de la taille de la main), déplacer =
  tourner, main plus grande = zoom. Vérifié dans Chromium avec une fausse caméra (photo de main qui se déplace) :
  main détectée, curseur qui suit.
- **Tri automatique** (`server/max/trieur.ts`) : à chaque réveil avec accueil (déverrouillage, Siri), le Bureau liste
  les mails non lus et les fait classer par un `claude -p` à part (modèle des robots), **sans aucun outil**
  (`--tools ""`), en JSON (`--json-schema`), mails présentés comme des données (retours à la ligne aplatis). Au plus un
  tri en 10 minutes ; mêmes mails = on rouvre la fenêtre sans relancer Claude. Le résultat (`MailsVue.auto`) ouvre la
  fenêtre des mails sur la page ; Max reçoit le résumé. Essai réel : 4,5 s, classement juste, et un mail piégé
  (« IGNORE TES CONSIGNES… ») classé en pubs et signalé.
- **Essai réel (Opus)** : « montre-moi mon corps » → `ouvrir_pole(sante, corps)` ; « j'ai fait ma séance jambes,
  squat à 80 kilos » → `noter_seance` avec la note, et Max remarque que ce n'était pas le jour prévu ; « lance-moi
  trente minutes sur Asclepium » avec 55 min déjà faites → il le dit franchement et laisse choisir.

## Hologramme, intro en musique, réveil par appel (ajoutés ensuite)

- **Bug corrigé** : en ouvrant une fiche de pôle, l'accueil restait affiché dessous (une condition inversée). Désormais
  l'écran de Max est une grille (barre, contenu qui défile, tuiles, champ de texte) : rien ne peut passer sur autre
  chose ; sur une fiche, Max reste visible en bandeau (sa silhouette en petit et sa phrase). Vérifié par un script qui
  mesure les chevauchements visibles à 5 tailles d'écran (de 390×844 à 1920×1000), sur l'accueil et chaque fiche.
- **Style « hologramme »** (d'après un reel choisi par l'utilisateur) : `web/humanoide.ts` remplace la sphère. C'est un
  buste en canvas 2D : contours bleus emboîtés, lignes du visage, cœur orange (doré quand il réfléchit, qui bat quand il
  parle), veines dorées, particules qui s'envolent du crâne, ondes quand il écoute, tête qui suit le pointeur,
  apparition en comète. Le fond `web/montagnes.ts` est une chaîne de montagnes en particules avec des filets dorés,
  dessinée une fois puis animée par quelques étincelles, à 30 images par seconde. Le buste cache les montagnes
  derrière lui.
- **Intro au lancement** (`server/max/musique.ts`, `web/intro.ts`) : à chaque réveil avec accueil, la page joue
  l'animation (éclair rouge et or, anneaux, M-A-X, systèmes en ligne, tuiles qui arrivent) et le Mac joue un extrait
  de la musique de l'utilisateur, préparé une fois par ffmpeg : 5 s pleine puissance, puis baissée à 25 %, fondu. Max
  salue après 5,5 s. Le fichier de musique reste sur le Mac (`~/Documents/Bureau/musique/max.mp3`), jamais dans Git.
- **Réveil par appel** (`server/max/reveil.ts`, `twilio.ts`, `message-reveil.ts`) : choix de l'utilisateur, un appel
  téléphonique seulement, à une heure fixée le soir avec Max (7 h par défaut).
  - Le message est préparé 10 minutes avant l'appel. Le texte (heure, échéance, séance du jour) est dit par la voix
    Piper de Max et mixé par ffmpeg sur la musique (4 s de musique, la voix sur la musique baissée, puis la musique
    revient). Le fichier est déposé chez Twilio (Assets Serverless, chemin aléatoire), et l'appel le joue avec
    `<Play>`. Si une étape manque, l'appel lit le texte avec une voix Twilio (`<Say>`).
  - Le Mac n'a pas besoin d'être joignable depuis internet : TwiML en ligne, état de l'appel lu par l'API, avec
    détection du répondeur.
  - Réveillé = décroché, au moins 20 s, et pas un répondeur. Sinon, rappel toutes les 5 min, 4 appels au plus. Un
    message à Max arrête les rappels.
  - `caffeinate -s` garde le Mac éveillé, quand il est branché, dans les 10 h avant l'appel. Un fichier empêche de
    rappeler pour le même réveil après un redémarrage.
  - Outils de Max : `regler_reveil`, `annuler_reveil`, `etat_reveil`, `essayer_reveil` ; `npm run appel` pour un
    essai.
  - Essai réel (Opus) : « bonne nuit, je me couche vers minuit » → Max vérifie que 7 h lui laisse ses 7 heures et ne
    change rien ; « teste l'appel » → appel lancé.

## Fenêtre à part, Max qui guette et qui regarde (ajoutés ensuite)

- **Fenêtre de Max** (`server/fenetre.ts`) : `open -na <navigateur> --args --app=URL --user-data-dir=<données>/fenetre` avec
  le premier navigateur Chromium trouvé (Chrome, Brave, Edge…), sinon `open URL` (Safari). Réglage `fenetre.mode` :
  `app`, `plein-ecran`, `navigateur`. Le raccourci Siri passe par `POST /api/reveil {ouvrir:true}` (le serveur
  connaît le réglage) et retombe sur `open` si le Bureau est ancien.
- **Une seule fenêtre** : chaque page envoie `{type:"fenetre", nee}` (son heure d'ouverture) ; le serveur le relaie
  aux autres, et celles qui sont plus anciennes se ferment (`window.close()`) ou passent sur `ailleurs.html`, ce qui
  libère la caméra. Indépendant de l'ordre de reconnexion après un redémarrage du serveur.
- **Guet** (`web/verrou.ts`) : verrouillé, page visible, visage enregistré → détection seule (TinyFaceDetector, entrée
  160) toutes les 600 ms ; deux détections de suite → reconnaissance complète. Pause après un échec.
- **Regard** (`web/regard.ts`) : déverrouillé et sur l'écran de Max → détection toutes les 250 ms, position du visage
  en miroir → `Humanoide.regarder(x, y)` ; la caméra a la priorité sur le pointeur pendant 1,5 s. Première vue ou
  retour après 20 s d'absence → `saluer()` (cœur embrasé, onde dorée) et un son. Caméra refusée → retour au pointeur.
- **Tête en volume** : les contours intérieurs se décalent plus que le bord (parallaxe), le cœur et les lignes du
  visage suivent ; anneaux de données (`etiquettesAnneaux`) dessinés dans le canevas, gardés dans le cadre.
- **Sons** (`web/sons.ts`) : oscillateurs WebAudio, courts (≤ 0,8 s), volume 0,06 ; coupables (🔈, retenu par le
  navigateur). La fenêtre d'app est lancée avec `--autoplay-policy=no-user-gesture-required`.
- **Montagnes** : le niveau de la voix de Max éclaire le décor et fait courir une onde le long des crêtes.
- **Accueil** : `complementSport` ajoute la séance du jour (ou « déjà faite, bravo ») avant « Je t'écoute ».

- **Scanner d'entrée** (`web/scan-visage.ts`) : pendant `reconnaitre`, `#verrou[data-scan]` met la vidéo en plein
  écran (filtre CSS) et un canevas dessine le maillage (68 points de face-api, `MAILLAGE`, placés par `versEcran` :
  miroir + `object-fit: cover`), les crochets, la ligne de scan, les données et la progression (visage vu, un côté,
  les deux, comparaison). Le serveur annonce le déverrouillage avant de répondre : l'écran reste affiché pendant la
  vérification puis pendant `accorder()` (2,7 s), et l'intro attend qu'il soit caché.

## Hors périmètre

WhatsApp (pas de façon fiable d'envoyer sans clic), lire les SMS reçus, répondre à un mail, contrôle de la maison.
