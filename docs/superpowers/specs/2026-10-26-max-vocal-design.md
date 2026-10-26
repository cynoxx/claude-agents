# Max vocal — parler directement avec Max (façon Jarvis)

**Statut : construit** (voir `bureau/README.md`, sections « Parler à Max » et « Dis Siri, Max au rapport »). L'utilisateur a validé la partie 1 et délégué le reste (« fais jusqu'au résultat final »).
Les parties 2 et 3 ci-dessous sont des décisions de l'implémenteur, notées pour relecture.

Remplace la dictée par bouton (🎤) et la voix du navigateur ajoutées le 25/10 : elles ne permettaient ni la
conversation ni l'ouverture mains libres.

## Décisions de l'utilisateur

| Sujet | Choix |
|---|---|
| Façon de parler | « Max, … » au début de la phrase ; pendant 10 s après sa réponse, on enchaîne sans redire son nom |
| Transcription | Whisper en local (whisper.cpp) : la voix ne quitte pas le Mac |
| Cerveau en conversation | Opus (modifiable dans `bureau.config.json`) |
| Mémoire | un carnet : Max note ce qu'il apprend sur l'utilisateur et ses missions |
| Démarrage | à la demande : « Dis Siri, Max au rapport » (raccourci de l'app Raccourcis) ; pas de démarrage automatique au login. D'abord nommé « Réveille Max », renommé parce que Siri comprend « réveille » comme une alarme |
| Mac | supposé à puce Apple (modèle Whisper choisi en conséquence ; modifiable) |

## Partie 1 — Architecture (validée)

Les navigateurs bloquent le son et le traitement du micro tant qu'on n'a pas cliqué dans la page. La voix et
l'oreille de Max tournent donc **dans le serveur, sur le Mac** ; la page ne sert qu'à voir et à écrire.

```
« Dis Siri, Max au rapport » → scripts/reveiller-max.sh → démarre le serveur s'il ne tourne pas,
                             réveille Max, ouvre la page
🎙 Oreille   ffmpeg (micro) → détecteur de parole → WAV → whisper-cli → texte
             → filtre « Max, … » / fenêtre de suite de 10 s → Cerveau
🧠 Cerveau   un `claude -p` Opus allumé en continu (--input-format/--output-format stream-json,
             --include-partial-messages), avec les outils du Bureau (serveur MCP local)
🔊 Bouche    `say` (meilleure voix française installée), phrase par phrase pendant que Max écrit ;
             l'oreille se coupe pendant qu'il parle
🖥 Écran     panneau de conversation + voyant (😴 veille · 👂 écoute · 💭 réfléchit · 🗣 parle)
```

Veille : « Max, mets-toi en veille » ou 30 minutes sans échange → oreille (micro) et cerveau arrêtés.

## Partie 2 — Max en conversation (décidé par l'implémenteur)

**Ton.** Français, tutoiement, chaleureux, phrases courtes (1 à 3 sauf demande de détail). Pas de markdown,
de listes, d'emojis ni d'URL : tout est prononcé.

**Outils** (serveur MCP `bureau`, lancé par Claude Code, qui appelle l'API du Bureau avec un jeton) :

| Outil | Effet |
|---|---|
| `lancer_mission(texte)` | lance une mission (Max reformule d'abord une consigne complète) |
| `etat_bureau()` | phase, robots, ce qu'ils font, résultat disponible |
| `arreter_mission()` / `reprendre_mission()` | comme les boutons |
| `lire_resultat(nom?)` | RESULTAT.md de la mission en cours ou d'une mission passée |
| `historique_missions()` | les missions passées |
| `memoriser(note)` / `oublier(texte)` | écrit dans le carnet / retire les lignes qui contiennent ce texte |
| `mettre_en_veille()` | Max finit sa phrase puis s'endort |

Il a aussi `WebSearch` et `WebFetch` pour les questions rapides. Aucun autre outil : pas de Bash ni de fichiers.

**Accueil.** Au réveil, Max dit tout de suite « Salut ! Je t'écoute. » (phrase fixe, sans attendre le modèle).

**Événements.** Quand une mission se termine, se met en pause ou échoue, le serveur l'annonce à Max par un
message `[Bureau] …` contenant le résumé ; Max le dit en deux ou trois phrases.

**Carnet.** `carnet.md` dans le dossier des missions (`~/Documents/Bureau`), une ligne datée par fait
(`- [2026-10-26] Projet Cynox Fitness : app de fitness`). Chargé dans la consigne de Max à chaque réveil
(200 dernières lignes), avec les 10 dernières missions. Modifiable à la main.

**Écran.** Sous le bureau pixel art : panneau de conversation (toi / Max / événements / outils utilisés),
champ « Écris à Max… », boutons 👂 Réveiller / 😴 Veille et 🤫 Tais-toi. La bulle de Max dans la scène affiche
la phrase qu'il prononce. Le formulaire de mission directe reste disponible, replié.

## Partie 3 — Robustesse, sécurité, tests (décidé par l'implémenteur)

**Modes dégradés** (toujours un message clair dans le panneau) :
- whisper-cli, ffmpeg ou le modèle absent → pas d'oreille ; la conversation écrite marche.
- `say` absent (hors Mac) → pas de voix ; les réponses s'affichent.
- cerveau planté → relancé au message suivant (nouvelle session, le carnet reste).
- quota atteint → Max le dit (ou l'écrit) et reste éveillé.

**Fiabilité de l'oreille.** Détecteur de parole par énergie avec plancher de bruit adaptatif ; phrase ≥ 0,4 s,
coupée après 0,8 s de silence, 30 s maximum. Filtre des hallucinations connues de Whisper sur le silence
(« Sous-titres réalisés par… », « Merci d'avoir regardé », `[BLANK_AUDIO]`…). Mot-clé tolérant
(« Max », « Maxe », « Macs », précédé ou non de « dis », « hé », « ok »). Micro choisi automatiquement (le micro
intégré du Mac de préférence), forçable dans la config ; `npm run micros` les liste.

**Sécurité.** Le serveur reste sur 127.0.0.1 avec contrôle Host/Origin. Les nouvelles routes qui agissent
(`/api/reveil`, `/api/outils/*`) exigent un jeton aléatoire (en-tête `x-bureau-jeton`), créé au démarrage
dans un fichier lisible par l'utilisateur seul ; le script Siri et le serveur MCP le lisent. Un en-tête
personnalisé force un contrôle CORS : un autre site ne peut pas les appeler. Le micro n'est ouvert que
quand Max est éveillé ; 😴 le coupe réellement (ffmpeg arrêté).

**Fichiers.** Modèle Whisper et jeton dans `~/Library/Application Support/Bureau` (hors de Documents,
souvent synchronisé avec iCloud). Modèle par défaut : `ggml-large-v3-turbo-q5_0.bin` (~550 Mo), téléchargé
par `npm run modele`.

**Démarrage Siri.** `scripts/reveiller-max.sh` (complète le PATH Homebrew, construit la page si besoin,
démarre le serveur en arrière-plan avec un journal dans `~/Library/Logs/Bureau.log`, attend qu'il réponde,
réveille Max, ouvre la page). Le raccourci « Max au rapport » ne fait qu'exécuter ce script ; le README donne
le pas-à-pas (l'app Raccourcis ne peut pas être remplie par un script).

**Tests.** Unitaires pour tout ce qui est pur (détecteur de parole, WAV, mot-clé, hallucinations, découpe en
phrases, choix du micro et de la voix, carnet, lecture de la sortie de Whisper). Intégration avec de faux
binaires (`claude` en mode conversation, `say`, transcripteur) pour le cerveau, la bouche, l'assistant et les
routes protégées. Le serveur MCP est testé avec un vrai client MCP contre un vrai serveur du Bureau.
Si `whisper-cli` et ffmpeg sont présents, un test d'intégration réel fait passer un vrai fichier audio
français par ffmpeg → détecteur → Whisper. Un essai réel du cerveau avec le vrai `claude` et les outils MCP
est fait avant livraison.

## Hors périmètre

Mot-clé « OK Bureau » sans Siri, interruption de Max à la voix pendant qu'il parle, voix ElevenLabs,
reconnaissance du visage, démarrage automatique au login.
