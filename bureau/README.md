# 🏢 Le Bureau

Une équipe d'agents Claude Code qui travaille sous tes yeux, dans un bureau en pixel art.

Tu parles à **Max**, le chef, comme à Jarvis. Il vit sur un **écran façon Jarvis** (une sphère lumineuse qui réagit quand il écoute, réfléchit et parle) et **pilote ton Mac** : apps, sites, musique, volume, iMessage, mails, agenda, météo. Il te reconnaît à la **caméra**, comme Face ID, et ne se réveille que pour toi. « Max, emmène-moi au bureau » te fait plonger dans le bureau pixel art. Quand tu lui dis « Max, compare les mutuelles pour moi », il te répond à voix haute et lance son équipe : 🔎 Chercheur, 💻 Codeur, 🎨 Designer, ✍️ Rédacteur, 📊 Analyste. Les robots travaillent en même temps, chacun dans sa bulle, puis Max relit tout et te raconte le résultat. Max est aussi ton **coach** (sessions de travail minutées, bilan de tes heures, compte à rebours de tes examens, rappels) et il a cinq **conseillers**, un par domaine de ta vie, assis à leur bureau : 🩺 Prof (études), 💪 Coach (santé), 💼 Associé (business), 📱 Dev (apps), 🏠 Majordome (vie perso). Tout tourne sur ton Mac avec **ton abonnement Claude**, sans clé API, et ta voix ne quitte jamais l'ordinateur (Whisper en local).

> Le guide complet : [le Bureau](../docs/superpowers/specs/2026-10-25-bureau-agents-design.md), [Max vocal](../docs/superpowers/specs/2026-10-26-max-vocal-design.md) et [Max coach et les conseillers](../docs/superpowers/specs/2026-10-26-max-coach-conseillers-design.md) et [Max façon Jarvis](../docs/superpowers/specs/2026-10-27-max-jarvis-design.md).

## Installation (une seule fois)

Il te faut un Mac avec **Claude Code** installé et connecté (`claude` doit marcher dans le Terminal), et **Homebrew** (https://brew.sh). Dans le Terminal, colle ces lignes **une par une** (Entrée après chacune) :

```bash
brew install node ffmpeg whisper-cpp ical-buddy
git clone https://github.com/cynoxx/claude-agents.git ~/claude-agents
cd ~/claude-agents/bureau
npm install
npm run modele
npm run voix
npm run setup
```

- `brew install` installe Node.js, ffmpeg (pour le micro), Whisper (la reconnaissance vocale locale) et icalBuddy (pour que Max lise bien ton agenda, cours qui se répètent compris).
- `npm run modele` télécharge le modèle Whisper (environ 550 Mo, une seule fois).
- `npm run voix` installe **la voix de Max** : Piper, une voix neuronale qui articule bien, gratuite, qui tourne sur ton Mac sans internet (environ 70 Mo, une minute). À la fin, Max te dit bonjour pour que tu l'entendes. Sans elle, Max parle avec la voix du Mac (`say`), bien moins naturelle.
- `npm run setup` crée `bureau.config.json` et te dit ce qui marche (✔) et ce qui manque (✘). Ouvre ensuite `bureau.config.json` et indique où sont tes projets, pour que le Codeur puisse y travailler :

```json
{
  "port": 4747,
  "dossierMissions": "~/Documents/Bureau",
  "projets": [
    { "nom": "Cynox Fitness", "chemin": "~/Code/Cynox-Fitness" },
    { "nom": "Lifforge", "chemin": "~/Code/lifforge" }
  ],
  "modeles": { "chef": "opus", "robots": "sonnet", "conversation": "opus" },
  "limites": { "robots": 5, "etapes": 3, "minutesParRobot": 20 },
  "voix": { "micro": null, "voixMac": null, "debit": 175, "veilleMinutes": 30 }
}
```

| Réglage | À quoi il sert |
|---|---|
| `dossierMissions` | où sont rangées les missions (un dossier par mission) et le carnet de Max |
| `projets` | les dépôts Git sur lesquels le Codeur a le droit de travailler |
| `modeles.chef` | le modèle de Max pour planifier et relire les missions |
| `modeles.conversation` | le modèle de Max quand il te parle ; `sonnet` répond plus vite, `opus` est plus malin |
| `modeles.robots` | le modèle des robots ; `sonnet` économise ton quota, `haiku` encore plus |
| `limites` | au maximum 5 robots et 3 étapes par mission, 20 minutes par robot |
| `voix.micro` | le micro à utiliser (`npm run micros` les liste) ; `null` = choisi tout seul |
| `voix.moteur` | `"auto"` (la voix Piper si elle est installée, sinon celle du Mac), `"piper"` ou `"say"` |
| `voix.voixPiper` | la voix Piper (par défaut `fr_FR-tom-medium`, une voix d'homme claire) ; d'autres voix françaises : `fr_FR-upmc-medium`, `fr_FR-siwis-medium`, à installer avec `npm run voix fr_FR-siwis-medium` |
| `voix.vitessePiper` | la vitesse de la voix Piper (`1` normale, `1.1` un peu plus rapide, `0.9` plus posée) |
| `voix.voixMac` | la voix du Mac si Piper n'est pas installé (une voix de `say -v ?`) ; `null` = la meilleure voix française installée |
| `voix.debit` | la vitesse de la voix du Mac (mots par minute) |
| `voix.veilleMinutes` | Max se met en veille après ce temps sans échange |
| `voix.phraseSiri` | le nom de ton raccourci Siri (« Max au rapport »), que Max te rappelle quand il s'endort |
| `conseillers` | (facultatif) ta propre liste de conseillers, à la place des cinq par défaut ; voir « Les conseillers » |
| `mac.ville` | la ville de la météo (`null` = devinée) |
| `mac.musique` | `"auto"` (Spotify s'il est installé, sinon Musique), `"spotify"` ou `"musique"` |
| `mac.dossierCaptures` | où ranger les captures d'écran (`null` = le Bureau du Mac) |
| `visage.actif` | `false` pour ne jamais verrouiller Max, même si un visage est enregistré |

## Lancer le Bureau

Deux façons :

- **« Dis Siri, Max au rapport »**, après avoir créé le raccourci une fois (voir plus bas). Le Bureau démarre en arrière-plan et la page s'ouvre.
- **À la main** : `cd claude-agents/bureau` puis `npm start`. Ton navigateur s'ouvre sur **http://localhost:4747**. Garde la fenêtre du Terminal ouverte ; `Ctrl+C` ferme le Bureau.

Dans les deux cas, Max se réveille tout seul et te dit « Salut ! Je t'écoute. » (ou combien tu as déjà travaillé aujourd'hui). Pour éteindre un Bureau démarré par Siri : `npm run arreter`.

## Mettre à jour

Dans le Terminal, une commande à la fois :

```bash
cd ~/claude-agents/bureau
git pull
npm install
npm run voix
npm run arreter
```

`npm run voix` n'est à faire qu'une fois (il installe la nouvelle voix de Max). `npm install` ajoute ce qui est nouveau (par exemple la reconnaissance du visage) ; `npm run arreter` éteint l'ancien Bureau. Ensuite, « Dis Siri, Max au rapport » relance la nouvelle version.

## Parler à Max

Commence ta phrase par **« Max »** (ou « Dis Max », « Hé Max ») : il ne réagit qu'à ça, pour ne pas te répondre quand tu parles à quelqu'un d'autre.

- « Max, compare cinq mutuelles pour un jeune actif à Paris et fais-moi un tableau. » → il lance une mission et te le dit.
- « Max, où en est l'équipe ? » → il regarde et te raconte.
- « Max, c'est quoi la capitale de l'Australie ? » → il répond directement, sans lancer d'équipe.
- « Max, retiens que Cynox Fitness est mon app de fitness. » → il le note dans son carnet.
- « Max, mets-toi en veille. » → il dit au revoir et coupe le micro.

Pendant **10 secondes après sa réponse**, tu peux enchaîner sans redire « Max ». Juste « Max ? » et il te répond « Oui ? ».

Sous le bureau, le **panneau de conversation** montre tout ce que vous vous dites, les outils qu'il utilise (🛠 mission, 📝 carnet, 🔎 recherche web…) et un voyant :

| Voyant | Signification |
|---|---|
| 😴 Max dort | micro coupé ; « Dis Siri, Max au rapport » ou le bouton 👂 le réveille |
| 👂 Max écoute | dis « Max, … » |
| 💭 Max réfléchit | il prépare sa réponse (Opus met quelques secondes) |
| 🗣 Max parle | le micro est coupé pendant qu'il parle, pour qu'il ne s'entende pas lui-même ; 🤫 le fait taire |

Tu peux aussi **lui écrire** dans le champ « Écris à Max… », par exemple quand tu n'es pas seul.

Quand une mission se termine, Max te le dit tout seul et te résume le résultat. Le résultat complet s'ouvre aussi à l'écran.

**Mémoire.** Max tient un carnet, `~/Documents/Bureau/carnet.md`, avec ce qu'il apprend de toi. Il le relit à chaque réveil. Tu peux lui dire « oublie ça » ou modifier le fichier toi-même.

**Le bureau, façon jeu vidéo.** En haut, ton **niveau** et ta **barre d'XP** : chaque minute de vraie session de travail rapporte 1 XP (1 h pour passer niveau 2, puis 2 h, 3 h…), avec ta série de jours 🔥 et ton J-N. Les fenêtres suivent l'heure réelle (aube, jour, soir, nuit étoilée), l'horloge du mur est à l'heure, le bandeau lumineux de l'enseigne annonce la quête en cours, les écrans des robots qui travaillent font défiler du code, et un chat se promène dans le bureau (clique dessus). En entrant, une carte « ZONE : LE BUREAU » s'affiche comme au début d'un niveau.

**Le bureau pixel art** fonctionne comme avant. Clique sur un robot (ou sur Max) pour voir sa tâche, tout ce qu'il a fait et son rapport. Les icônes au-dessus des robots : ☕ attend son tour, ✅ a fini, 💤 quota atteint (**▶️ Reprendre** plus tard), ❗ problème (clique dessus). Boutons du haut : **📄 Résultat**, **⏹ Arrêter**, **▶️ Reprendre**, **📜 Historique**, **📁 Dossier**. Tu peux aussi lancer une mission **sans passer par Max**, dans « Lancer une mission directement » en bas de la page.

## L'écran de Max et ses pouvoirs

Quand tu dis « Dis Siri, Max au rapport », la page s'ouvre sur **l'écran de Max** : au centre la sphère (bleue quand il écoute, dorée quand il réfléchit, qui vibre quand il parle), ce qu'il dit en grand, et autour l'heure, la météo, ton agenda du jour, ton objectif (J-49), le minuteur en cours et la mission en cours.

- **« Max, emmène-moi au bureau »** (ou « montre-moi l'équipe ») : on plonge dans la sphère et on arrive dans le bureau pixel art. **« Max, reviens »**, ou le bouton **🔵 Max** en haut du bureau, te ramène.
- Tu peux aussi écrire à Max en bas de l'écran.

Ce que Max sait faire sur ton Mac :

| Tu dis | Max |
|---|---|
| « Max, ouvre Notes » · « ferme Safari » | ouvre ou quitte l'app |
| « Max, ouvre Doctolib » · « mets la vidéo de… sur YouTube » | ouvre le site, ou cherche la vidéo et l'ouvre |
| « Max, mets le son à 30 » · « coupe le son » · « baisse la luminosité » | règle le Mac |
| « Max, fais une capture d'écran » · « verrouille l'écran » | capture sur le Bureau du Mac · écran verrouillé |
| « Max, mets du lo-fi » · « pause » · « suivant » · « c'est quoi ce morceau ? » | pilote Spotify (ou Musique) |
| « Max, envoie à Maman que je rentre à 20 h » | prépare l'iMessage, te le lit et demande « Je l'envoie ? » |
| « Max, trie mes mails » · « j'ai des nouveaux mails ? » | lit tes derniers mails, les classe (🔴 à traiter, 🎓 études, 💼 business, 👤 perso, 📰 pubs) sur son écran et te dit l'essentiel ; propose de ranger les pubs dans un dossier « Max - Pubs » de Mail |
| « Max, j'ai quoi aujourd'hui ? » · « et demain ? » | lit ton agenda |
| « Max, ajoute dentiste mercredi à 17 h 30 » | prépare le rendez-vous et demande « Je l'ajoute ? » |
| « Max, quel temps il fait ? » | la météo |

**Rien ne part sans ton oui.** Un message ou un rendez-vous est d'abord préparé ; c'est le Bureau lui-même (pas seulement Max) qui refuse de l'envoyer tant que ta phrase suivante n'est pas un oui (« oui », « vas-y », « ok »…). Si tu dis « non, change… », Max le prépare de nouveau. Un mail ou une page web ne peut donc pas lui faire envoyer quelque chose à ta place.

Max n'a pas le droit de taper des commandes sur ton Mac : il n'a que cette liste de gestes, comme une télécommande.

### Les autorisations du Mac (la première fois)

macOS te demande ton accord la première fois que Max touche à une app. Accepte (« OK ») :

- **Contrôler Musique, Spotify, Messages, Mail, Calendrier, Contacts** : une fenêtre « Raccourcis souhaite contrôler… » (ou « Terminal », si tu as lancé avec `npm start`). Si tu as refusé : **Réglages Système > Confidentialité et sécurité > Automatisation**.
- **Contacts** et **Calendriers** : **Réglages Système > Confidentialité et sécurité > Contacts** (et **Calendriers**).
- **Luminosité** : Max appuie sur les touches de luminosité pour toi, ce qui demande **Réglages Système > Confidentialité et sécurité > Accessibilité** (ajoute et coche Raccourcis, ou Terminal).

Si une autorisation manque, Max te dit où l'activer.

### Gmail et Google Agenda

Max lit tes mails dans l'app **Mail** et ton agenda dans **Calendrier**. Pour y mettre ton compte Google (une seule fois) :

1. **Réglages Système > Comptes Internet > Google**, connecte-toi.
2. Coche **Mail** et **Calendriers**.
3. Ouvre l'app Mail une fois, le temps qu'elle télécharge tes mails.

Pour les rendez-vous, Max utilise le premier calendrier modifiable ; pour en imposer un : « ajoute-le dans mon calendrier Google ».

### Ton emploi du temps du jour

**Une fois par jour, au premier réveil**, Max te propose de construire ensemble ton emploi du temps. Il regarde ton agenda, te demande ce que tu veux absolument faire, puis propose une journée réaliste : des blocs de travail sur ta priorité, des pauses, les repas, un peu de sport, et une heure de coucher qui garde tes 7 heures de sommeil. Quand tu es d'accord :

- l'emploi du temps s'affiche sur l'écran de Max, **le créneau en cours en surbrillance** ;
- **au début de chaque créneau**, Max te prévient (« C'est l'heure de l'anatomie, on lance une session ? ») ;
- il te propose de **l'ajouter à ton Calendrier** (donc à Google Agenda s'il y est ajouté), seulement après ton oui.

Tu peux aussi le demander à tout moment : « Max, on fait mon emploi du temps », « Max, décale le sport à 19 h ». Les emplois du temps sont gardés dans `~/Documents/Bureau/emplois-du-temps/`.

**Le oui, en résumé** : pour un message ou un rendez-vous, Max lit d'abord ce qu'il va faire et attend ton oui. Pour ranger tes pubs ou mettre ton emploi du temps dans ton Calendrier (sans risque pour personne), « oui, range-les » suffit.

## Max te reconnaît (comme Face ID)

Max peut ne se réveiller **que pour toi** : il te reconnaît à la caméra du Mac.

**L'activer (une fois)** : sur l'écran de Max, bouton **🔐 Activer le visage**. Écris ton prénom, clique sur **📷 Enregistrer mon visage**, puis suis les consignes : Max prend 5 images de ton visage (de face, la tête un peu tournée de chaque côté, le menton levé). Ton navigateur te demande d'autoriser la caméra : accepte.

**Ensuite** :
- Au démarrage et **à chaque fois que Max s'endort**, il se verrouille. Plus de micro, plus de conversation : l'écran affiche 🔒.
- Dis **« Dis Siri, Max au rapport »** : la page s'ouvre, la caméra s'allume toute seule. Regarde-la et **tourne doucement la tête à gauche puis à droite**. Max te reconnaît et te dit « Salut ! ». Tu peux aussi cliquer sur **📷 Me reconnaître**.
- La caméra ne s'allume que pendant la vérification (30 secondes au plus) et s'éteint aussitôt après.
- Le bouton **🔐 Visage** permet aussi de **verrouiller tout de suite**, de **réenregistrer** ton visage ou de **l'effacer** (Max n'est alors plus verrouillé).

**Pourquoi tourner la tête ?** Une photo de toi ne peut pas le faire : même tenue de biais, une photo garde les mêmes proportions, alors qu'un vrai visage qui tourne les change. C'est ce que Max vérifie.

**Ce que ça protège, et ce que ça ne protège pas.** Personne d'autre (un ami, ta copine, un colocataire) ne peut parler à Max, lire tes mails ou ton agenda, ni voir la conversation, les missions ou les conseillers : tant qu'il est verrouillé, le Bureau n'envoie rien de tout ça à la page et refuse toutes les commandes. Mais une webcam n'est pas Face ID (qui a un capteur 3D) : quelqu'un de très déterminé, avec une vidéo de toi, pourrait la tromper. Et ça ne protège pas ton Mac lui-même : garde ton mot de passe ou Touch ID.

Un rappel ou la fin d'une session de travail sont quand même dits à voix haute pendant que Max est verrouillé (« Ta session est finie, bravo ! »), sans rien révéler d'autre.

## Max, ton coach

Max sait où tu en es : il lit ton fichier **`moi.md`** (voir plus bas), connaît la date, tes échéances et le temps que tu as travaillé.

- « Max, je me mets au travail. » → il te propose une petite première étape et lance une **session de 25 minutes**. Tu peux aussi dire « une session de 50 minutes sur l'anatomie ».
- À la fin, **il se réveille tout seul** (même s'il dormait), te félicite, te demande ce que tu as fait et te propose une pause de 5 minutes. À la fin de la pause, il te propose la suite.
- « Max, j'arrête. » → il note le temps réellement fait.
- « Max, combien j'ai travaillé cette semaine ? » → aujourd'hui, hier, les 7 derniers jours, ta série de jours d'affilée.
- « Max, mon examen est le 14 décembre. » → il l'ajoute à tes échéances et fait le compte à rebours.
- « Max, j'ai une idée pour ma boutique… » pendant une session → il te propose de la mettre **au parking** (`idees.md`) pour y revenir après, au lieu de t'y lancer maintenant.
- « Max, rappelle-moi d'aller me coucher à 23 h. » → à 23 h, il te le dit à voix haute (si le Bureau est ouvert).
- « Max, bonjour ! » → le nombre de jours avant ta prochaine échéance, ton travail d'hier, et la première session de la journée.

Dans le panneau de conversation : le minuteur en cours (⏱), ton travail du jour (📚) et ta prochaine échéance (📅 J-49). Le bouton **⏱ Session 25 min** lance une session sans parler, **⏹ Stop** l'arrête.

La nuit jusqu'à 5 h du matin compte dans la journée de la veille. Le journal de tes sessions est dans `~/Documents/Bureau/travail.jsonl`.

### Ton fichier `moi.md`

C'est ce que Max et ses conseillers savent de toi : qui tu es, ta priorité du moment, tes objectifs, ton rythme, ce qui t'aide et ce qui te bloque. Il est dans `~/Documents/Bureau/moi.md` (`npm run setup` en crée un modèle à remplir). Écris-le comme tu parlerais à un ami, et modifie-le quand ta vie change : Max le relit à chaque réveil.

Les échéances se notent dans une section `## Échéances`, une par ligne :

```markdown
## Échéances
- 2026-12-14 : Examen PASS
```

## Les conseillers

En bas du bureau, l'**aile des conseillers** : un robot par domaine de ta vie, chacun à son bureau, avec son propre carnet.

| Conseiller | Domaine |
|---|---|
| 🩺 Prof | études : méthode, planning jusqu'aux examens, explications de cours, interrogations |
| 💪 Coach | santé : sommeil, rythme, énergie, alimentation, sport, stress et moral |
| 💼 Associé | business : projets, boutique, réseaux sociaux, vidéos, marketing |
| 📱 Dev | apps et code |
| 🏠 Majordome | vie perso : administratif, argent, logement, relations, quotidien |

Demande à Max : « Max, demande au Prof comment réviser la biochimie en sept semaines. » Max transmet la question, le Prof réfléchit à son bureau (sa bulle montre ce qu'il fait, recherche web comprise), puis Max te résume sa réponse. Autres idées : « Max, demande au Prof de m'interroger sur la cellule », « Max, demande au Coach comment me recoucher plus tôt ».

Clique sur un conseiller pour lire sa dernière question et sa réponse complète. Chaque conseiller connaît ton `moi.md` et garde ses propres notes dans `~/Documents/Bureau/conseillers/<id>.md` (il y ajoute ce qu'il apprend ; tu peux les modifier). Un conseiller utilise le modèle des robots (`modeles.robots`) et répond en une minute environ.

Pour changer les conseillers, ajoute une liste `conseillers` dans `bureau.config.json`. Un conseiller qui reprend l'`id` d'un conseiller par défaut garde ce que tu ne changes pas :

```json
"conseillers": [
  { "id": "etudes", "nom": "Docteur" },
  { "id": "sante" },
  { "id": "musique", "nom": "Maestro", "emoji": "🎸", "domaine": "Musique", "description": "guitare et composition" }
]
```

## « Dis Siri, Max au rapport »

À faire une seule fois, dans l'app **Raccourcis** du Mac :

1. Ouvre **Raccourcis**, puis **Fichier > Nouveau raccourci**.
2. Cherche l'action **« Exécuter un script shell »** et ajoute-la.
3. Dans la case du script, colle cette ligne (adapte le chemin si tu as cloné ailleurs) :
   ```bash
   /bin/bash ~/claude-agents/bureau/scripts/reveiller-max.sh
   ```
4. Nomme le raccourci **« Max au rapport »** (le nom en haut de la fenêtre). C'est la phrase que Siri reconnaîtra.
5. La première fois, Raccourcis peut demander d'autoriser les scripts : **Raccourcis > Réglages > Avancé > « Autoriser l'exécution des scripts »**.

Essaie : **« Dis Siri, Max au rapport »**. Le Bureau démarre (une dizaine de secondes la première fois), la page s'ouvre et Max te salue. Si le Bureau tourne déjà, Siri réveille simplement Max.

- « Dis Siri » doit être activé : **Réglages Système > Siri**.
- La première fois, le Mac demande l'**autorisation du micro** pour Raccourcis (ou pour le Terminal si tu as fait `npm start`) : accepte. Si tu as refusé, active-la dans **Réglages Système > Confidentialité et sécurité > Micro**.
- Choisis un nom **sans verbe que Siri connaît déjà** : « réveille » lui fait programmer une alarme, « appelle » passe un appel, « allume » vise les lumières, « ouvre » ou « lance » une app, et « Bureau » ouvre le Bureau du Finder. « Max au rapport » n'entre en conflit avec rien.
- Sans la voix : dans le raccourci, **ⓘ > Ajouter un raccourci clavier** (par exemple `⌃ ⌥ M`), ou **Fichier > Ajouter au Dock**.
- Le journal du Bureau démarré par Siri est dans `~/Library/Logs/Bureau.log`.

## Où sont les fichiers

```
~/Documents/Bureau/
├── moi.md               ← qui tu es, ta priorité, tes échéances (écrit par toi)
├── carnet.md            ce que Max a retenu de toi
├── travail.jsonl        tes sessions de travail
├── idees.md             les idées au parking
├── emplois-du-temps/    un emploi du temps par jour (2026-10-27.json…)
├── conseillers/         les notes de chaque conseiller (etudes.md, sante.md…)
└── 2026-10-25 14h32 - compare-5-mutuelles-pour-un-jeune/
    ├── RESULTAT.md      ← la synthèse finale de Max
    ├── MISSION.md       ta demande
    ├── plan.json        le plan de Max
    ├── journal.jsonl    toutes les actions, horodatées
    ├── etat.json        terminée, en pause, arrêtée…
    └── equipe/
        ├── chercheur-1/rapport.md
        └── analyste-1/rapport.md, comparatif.csv
```

⚠️ Max relit tout, mais il peut se tromper : **vérifie toujours les chiffres importants** (prix, montants, dates) avant de t'en servir.

## Quand le Codeur a travaillé sur un projet

Ta branche principale n'est jamais modifiée. Le Codeur travaille sur une branche à part (par exemple `bureau/ecran-stats`), dans une copie de travail rangée dans le dossier de la mission (`code/`). Il ne fait jamais de `git push`. La fin de `RESULTAT.md` donne les commandes à lancer :

Pour voir les changements, puis les garder s'ils te plaisent :

```bash
cd ~/Code/Cynox-Fitness
git diff HEAD...bureau/ecran-stats
git merge bureau/ecran-stats
```

Pour faire le ménage une fois la branche fusionnée ou abandonnée : `git worktree prune`, puis `git branch -D bureau/ecran-stats`.

## Ce que les robots ont le droit de faire

- Ils travaillent **sans te demander de validation** (autonomie totale).
- Chaque métier n'a que ses outils : seuls le Codeur et l'Analyste peuvent lancer des commandes, et seuls le Chercheur et le Designer vont sur le web.
- `git push`, `rm -rf` et `sudo` sont interdits.
- Les écritures de fichiers sont limitées au dossier de la mission (et à la copie de travail du Codeur).
- Les robots n'ont **pas accès à tes connecteurs** (mails, agenda, Drive…).

## Ta vie privée

- **Ta voix** est transcrite **sur ton Mac** par Whisper. Elle n'est envoyée nulle part, et le Bureau ne garde aucun enregistrement.
- **Le micro** n'est ouvert que quand Max est réveillé. En veille (😴), il est vraiment coupé.
- **Seules les phrases qui commencent par « Max »** (ou la suite d'une conversation) partent chez Claude, comme le reste de la conversation et le carnet.
- **Ton visage** : l'image de la caméra est analysée **dans la page** (face-api), jamais enregistrée ni envoyée. Seule une empreinte (5 × 128 nombres, pas une photo) est gardée dans `~/Library/Application Support/Bureau/visage.json`, lisible par toi seul. Elle ne quitte pas ton Mac.
- **Tes mails, ton agenda et tes contacts** ne sont lus que quand tu le demandes à Max, et seulement ce qu'il faut pour répondre (les derniers mails, la journée demandée, le contact cherché). Ce qu'il lit part chez Claude, comme le reste de la conversation.

## Ton quota d'abonnement

Chaque robot est une vraie session Claude Code, donc une mission à 4 robots consomme ton quota environ 4 fois plus vite qu'une conversation normale. Max utilise Opus (pour planifier, relire et te parler), les robots Sonnet. Parler avec Max consomme aussi un peu de quota à chaque réponse ; quand il dort, il ne consomme rien. Si Max n'a plus de quota, il te le dit. Si la limite est atteinte, rien n'est perdu : la mission se met en pause 💤 et tu cliques sur **▶️ Reprendre** quand ton quota est revenu. Le Bureau doit rester ouvert entre-temps ; s'il est fermé, la mission apparaît « interrompue » dans l'historique, avec les rapports déjà écrits.

## Dépannage

| Problème | Solution |
|---|---|
| Bandeau « claude introuvable » | Installe Claude Code, puis relance le Bureau. |
| Bandeau « pas connecté » | Lance `claude auth login` dans le Terminal, puis relance le Bureau. |
| « ⚠️ ffmpeg / whisper-cli introuvable » dans le panneau | `brew install ffmpeg whisper-cpp`, puis relance le Bureau. |
| « ⚠️ Modèle Whisper absent » | `npm run modele`, puis relance le Bureau. |
| La voix de Max est robotique | Installe la voix neuronale : `npm run voix`, puis relance le Bureau. `npm run setup` dit quelle voix est utilisée. |
| `npm run voix` dit qu'il faut Python | `brew install python`, puis relance `npm run voix`. |
| Max parle trop vite ou trop lentement | `"voix": { "vitessePiper": 0.9 }` (plus posé) ou `1.1` (plus rapide) dans `bureau.config.json`. |
| « Dis Max, … » ne marche pas | Mets à jour (`git pull`) : Whisper écrit souvent « Dimax » ou « D'y max », Max les comprend maintenant. Sinon, dis simplement « Max, … ». |
| Max ne t'entend pas | Vérifie l'autorisation du micro (Réglages Système > Confidentialité et sécurité > Micro). `npm run micros` montre le micro utilisé ; impose-en un autre avec `"voix": { "micro": ":1" }`. |
| Max réagit à la télé | Il ne répond qu'aux phrases qui commencent par « Max » : baisse un peu le son, ou mets-le en veille. |
| Max met du temps à répondre | Opus réfléchit quelques secondes. Pour plus de vitesse : `"modeles": { "conversation": "sonnet" }`. |
| Siri demande « à quelle heure programmer l'alarme ? » | Le mot « réveille » déclenche l'alarme : renomme le raccourci « Max au rapport ». |
| Siri ouvre le Bureau du Finder | Renomme le raccourci « Max au rapport » (pas « Bureau »). |
| Un rappel n'a pas sonné | Les rappels ne sonnent que si le Bureau est ouvert. Un rappel manqué de plus d'une heure est abandonné. |
| L'écran reste sur 🔒 et la caméra ne s'allume pas | Clique sur **📷 Me reconnaître**. Si le navigateur a refusé la caméra : clique sur l'icône de caméra dans la barre d'adresse et autorise-la pour localhost. Sur Mac, vérifie aussi **Réglages Système > Confidentialité et sécurité > Caméra** pour ton navigateur. |
| Max ne me reconnaît pas | Mets-toi face à la lumière, assez près. Si ça arrive souvent (lunettes, barbe…), réenregistre ton visage avec **🔐 Visage**. Après 10 essais ratés, il faut attendre 30 secondes. |
| Je ne peux plus déverrouiller (caméra cassée…) | Arrête le Bureau (`npm run arreter`), mets `"visage": { "actif": false }` dans `bureau.config.json`, relance. Ou supprime le fichier `~/Library/Application Support/Bureau/visage.json`. |
| Max dit qu'il lui faut une autorisation | Suis la phrase qu'il te donne (voir « Les autorisations du Mac »). |
| Max ne voit pas un cours qui se répète dans l'agenda | Installe icalBuddy : `brew install ical-buddy`, puis relance le Bureau. |
| « Aucun contact ne s'appelle… » | Vérifie le nom dans l'app Contacts, ou donne le numéro. |
| La musique cherchée ne se lance pas dans Spotify | Spotify ne peut que t'ouvrir la recherche : clique sur le morceau. Avec Musique, Max lance ce qu'il trouve dans ta bibliothèque. |
| Un conseiller affiche ❗ | Il n'a pas pu répondre (quota, réseau). Clique dessus pour voir, puis redemande à Max. |
| Siri lance le raccourci mais rien ne s'ouvre | Regarde `~/Library/Logs/Bureau.log`, et vérifie que le chemin du script est le bon. |
| « Le port 4747 est déjà utilisé » | Le Bureau tourne déjà (peut-être démarré par Siri) : `npm run arreter`, ou change `port` dans `bureau.config.json`. |
| Le Codeur ne démarre pas (❗) | Vérifie le `chemin` du projet dans `bureau.config.json` : ce doit être un dépôt Git. |
| Un robot reste bloqué | Au bout de 20 minutes, il s'arrête tout seul (❗) et Max continue sans lui. Tu peux aussi cliquer sur **⏹ Arrêter**. |

## Pour les développeurs

```bash
npm test
npm run build
```

`npm test` utilise de faux « claude », « say » et « ffmpeg » : aucun quota consommé, aucun micro nécessaire. `npm run build` vérifie le TypeScript et construit la page.

- `CLAUDE_BIN=/chemin/vers/claude` change le binaire utilisé ; `BUREAU_NO_OPEN=1` évite d'ouvrir le navigateur ; `BUREAU_SANS_REVEIL=1` laisse Max endormi au démarrage ; `BUREAU_CONFIG_DIR` lit `bureau.config.json` ailleurs.
- Test réel de l'oreille (ffmpeg + Whisper sur un vrai fichier audio français) : `WHISPER_BIN=$(which whisper-cli) WHISPER_MODELE=~/Library/Application\ Support/Bureau/modeles/ggml-large-v3-turbo-q5_0.bin npm test`.
- Voir le Bureau tourner sans rien dépenser : `CLAUDE_BIN=$PWD/test/fake-claude.mjs FAKE_DELAY=1200 npm start`.
