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

## Hors périmètre

WhatsApp (pas de façon fiable d'envoyer sans clic), lire les SMS reçus, répondre à un mail, contrôle de la maison.
