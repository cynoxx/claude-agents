# 🏢 Le Bureau

Une équipe d'agents Claude Code qui travaille sous tes yeux, dans un bureau en pixel art.

Tu parles à **Max**, le chef, comme à Jarvis : « Max, compare les mutuelles pour moi ». Il te répond à voix haute et lance son équipe : 🔎 Chercheur, 💻 Codeur, 🎨 Designer, ✍️ Rédacteur, 📊 Analyste. Les robots travaillent en même temps, chacun dans sa bulle, puis Max relit tout et te raconte le résultat. Tout tourne sur ton Mac avec **ton abonnement Claude**, sans clé API, et ta voix ne quitte jamais l'ordinateur (Whisper en local).

> Le guide complet : [le Bureau](../docs/superpowers/specs/2026-10-25-bureau-agents-design.md) et [Max vocal](../docs/superpowers/specs/2026-10-26-max-vocal-design.md).

## Installation (une seule fois)

Il te faut un Mac avec **Claude Code** installé et connecté (`claude` doit marcher dans le Terminal), et **Homebrew** (https://brew.sh). Dans le Terminal, colle ces lignes **une par une** (Entrée après chacune) :

```bash
brew install node ffmpeg whisper-cpp
git clone https://github.com/cynoxx/claude-agents.git ~/claude-agents
cd ~/claude-agents/bureau
npm install
npm run modele
npm run setup
```

- `brew install` installe Node.js, ffmpeg (pour le micro) et Whisper (la reconnaissance vocale locale).
- `npm run modele` télécharge le modèle Whisper (environ 550 Mo, une seule fois).
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
  "voix": { "micro": null, "voixMac": null, "debit": 185, "veilleMinutes": 30 }
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
| `voix.voixMac` | la voix de Max (une voix de `say -v ?`) ; `null` = la meilleure voix française installée |
| `voix.debit` | la vitesse à laquelle Max parle (mots par minute) |
| `voix.veilleMinutes` | Max se met en veille après ce temps sans échange |

## Lancer le Bureau

Deux façons :

- **« Dis Siri, réveille Max »**, après avoir créé le raccourci une fois (voir plus bas). Le Bureau démarre en arrière-plan et la page s'ouvre.
- **À la main** : `cd claude-agents/bureau` puis `npm start`. Ton navigateur s'ouvre sur **http://localhost:4747**. Garde la fenêtre du Terminal ouverte ; `Ctrl+C` ferme le Bureau.

Dans les deux cas, Max se réveille tout seul et te dit « Salut ! Je t'écoute. ». Pour éteindre un Bureau démarré par Siri : `npm run arreter`.

## Parler à Max

Commence ta phrase par **« Max »** : il ne réagit qu'à ça, pour ne pas te répondre quand tu parles à quelqu'un d'autre.

- « Max, compare cinq mutuelles pour un jeune actif à Paris et fais-moi un tableau. » → il lance une mission et te le dit.
- « Max, où en est l'équipe ? » → il regarde et te raconte.
- « Max, c'est quoi la capitale de l'Australie ? » → il répond directement, sans lancer d'équipe.
- « Max, retiens que Cynox Fitness est mon app de fitness. » → il le note dans son carnet.
- « Max, mets-toi en veille. » → il dit au revoir et coupe le micro.

Pendant **10 secondes après sa réponse**, tu peux enchaîner sans redire « Max ». Juste « Max ? » et il te répond « Oui ? ».

Sous le bureau, le **panneau de conversation** montre tout ce que vous vous dites, les outils qu'il utilise (🛠 mission, 📝 carnet, 🔎 recherche web…) et un voyant :

| Voyant | Signification |
|---|---|
| 😴 Max dort | micro coupé ; « Dis Siri, réveille Max » ou le bouton 👂 le réveille |
| 👂 Max écoute | dis « Max, … » |
| 💭 Max réfléchit | il prépare sa réponse (Opus met quelques secondes) |
| 🗣 Max parle | le micro est coupé pendant qu'il parle, pour qu'il ne s'entende pas lui-même ; 🤫 le fait taire |

Tu peux aussi **lui écrire** dans le champ « Écris à Max… », par exemple quand tu n'es pas seul.

Quand une mission se termine, Max te le dit tout seul et te résume le résultat. Le résultat complet s'ouvre aussi à l'écran.

**Mémoire.** Max tient un carnet, `~/Documents/Bureau/carnet.md`, avec ce qu'il apprend de toi. Il le relit à chaque réveil. Tu peux lui dire « oublie ça » ou modifier le fichier toi-même.

**Le bureau pixel art** fonctionne comme avant. Clique sur un robot (ou sur Max) pour voir sa tâche, tout ce qu'il a fait et son rapport. Les icônes au-dessus des robots : ☕ attend son tour, ✅ a fini, 💤 quota atteint (**▶️ Reprendre** plus tard), ❗ problème (clique dessus). Boutons du haut : **📄 Résultat**, **⏹ Arrêter**, **▶️ Reprendre**, **📜 Historique**, **📁 Dossier**. Tu peux aussi lancer une mission **sans passer par Max**, dans « Lancer une mission directement » en bas de la page.

## « Dis Siri, réveille Max »

À faire une seule fois, dans l'app **Raccourcis** du Mac :

1. Ouvre **Raccourcis**, puis **Fichier > Nouveau raccourci**.
2. Cherche l'action **« Exécuter un script shell »** et ajoute-la.
3. Dans la case du script, colle cette ligne (adapte le chemin si tu as cloné ailleurs) :
   ```bash
   /bin/bash ~/claude-agents/bureau/scripts/reveiller-max.sh
   ```
4. Nomme le raccourci **« Réveille Max »** (le nom en haut de la fenêtre). C'est la phrase que Siri reconnaîtra.
5. La première fois, Raccourcis peut demander d'autoriser les scripts : **Raccourcis > Réglages > Avancé > « Autoriser l'exécution des scripts »**.

Essaie : **« Dis Siri, réveille Max »**. Le Bureau démarre (une dizaine de secondes la première fois), la page s'ouvre et Max te salue. Si le Bureau tourne déjà, Siri réveille simplement Max.

- « Dis Siri » doit être activé : **Réglages Système > Siri**.
- La première fois, le Mac demande l'**autorisation du micro** pour Raccourcis (ou pour le Terminal si tu as fait `npm start`) : accepte. Si tu as refusé, active-la dans **Réglages Système > Confidentialité et sécurité > Micro**.
- Évite de nommer le raccourci « Bureau » : Siri ouvrirait le Bureau du Finder.
- Tu peux aussi glisser le raccourci dans le Dock pour le lancer en un clic.
- Le journal du Bureau démarré par Siri est dans `~/Library/Logs/Bureau.log`.

## Où sont les fichiers

```
~/Documents/Bureau/
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

## Ton quota d'abonnement

Chaque robot est une vraie session Claude Code, donc une mission à 4 robots consomme ton quota environ 4 fois plus vite qu'une conversation normale. Max utilise Opus (pour planifier, relire et te parler), les robots Sonnet. Parler avec Max consomme aussi un peu de quota à chaque réponse ; quand il dort, il ne consomme rien. Si Max n'a plus de quota, il te le dit. Si la limite est atteinte, rien n'est perdu : la mission se met en pause 💤 et tu cliques sur **▶️ Reprendre** quand ton quota est revenu. Le Bureau doit rester ouvert entre-temps ; s'il est fermé, la mission apparaît « interrompue » dans l'historique, avec les rapports déjà écrits.

## Dépannage

| Problème | Solution |
|---|---|
| Bandeau « claude introuvable » | Installe Claude Code, puis relance le Bureau. |
| Bandeau « pas connecté » | Lance `claude auth login` dans le Terminal, puis relance le Bureau. |
| « ⚠️ ffmpeg / whisper-cli introuvable » dans le panneau | `brew install ffmpeg whisper-cpp`, puis relance le Bureau. |
| « ⚠️ Modèle Whisper absent » | `npm run modele`, puis relance le Bureau. |
| Max ne t'entend pas | Vérifie l'autorisation du micro (Réglages Système > Confidentialité et sécurité > Micro). `npm run micros` montre le micro utilisé ; impose-en un autre avec `"voix": { "micro": ":1" }`. |
| Max réagit à la télé | Il ne répond qu'aux phrases qui commencent par « Max » : baisse un peu le son, ou mets-le en veille. |
| Max met du temps à répondre | Opus réfléchit quelques secondes. Pour plus de vitesse : `"modeles": { "conversation": "sonnet" }`. |
| Siri ouvre le Bureau du Finder | Renomme le raccourci « Réveille Max » (pas « Bureau »). |
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
