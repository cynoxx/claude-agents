# 🏢 Le Bureau

Une équipe d'agents Claude Code qui travaille sous tes yeux, dans un bureau en pixel art.

Tu donnes une mission à **Max**, le chef. Il choisit son équipe : 🔎 Chercheur, 💻 Codeur, 🎨 Designer, ✍️ Rédacteur, 📊 Analyste. Les robots travaillent en même temps, chacun dans sa bulle, puis Max relit tout et te rend le résultat. Chaque robot est un vrai `claude -p` qui tourne sur ton Mac avec **ton abonnement Claude**, sans clé API.

> Le guide complet (à quoi ça sert, comment c'est construit) : [`docs/superpowers/specs/2026-10-25-bureau-agents-design.md`](../docs/superpowers/specs/2026-10-25-bureau-agents-design.md)

## Installation (une seule fois)

Il te faut :
- un Mac avec **Claude Code** installé et connecté (`claude` doit marcher dans le Terminal) ;
- **Node.js 20 ou plus**. Vérifie avec `node --version` ; sinon installe-le avec `brew install node`.

```bash
git clone https://github.com/cynoxx/claude-agents.git
cd claude-agents/bureau
npm install
npm run setup
```

`npm run setup` crée `bureau.config.json` et vérifie que Claude Code est prêt. Ouvre ensuite ce fichier et indique où sont tes projets, pour que le Codeur puisse y travailler :

```json
{
  "port": 4747,
  "dossierMissions": "~/Documents/Bureau",
  "projets": [
    { "nom": "Cynox Fitness", "chemin": "~/Code/Cynox-Fitness" },
    { "nom": "Lifforge", "chemin": "~/Code/lifforge" }
  ],
  "modeles": { "chef": "opus", "robots": "sonnet" },
  "limites": { "robots": 5, "etapes": 3, "minutesParRobot": 20 }
}
```

| Réglage | À quoi il sert |
|---|---|
| `dossierMissions` | où sont rangées les missions (un dossier par mission) |
| `projets` | les dépôts Git sur lesquels le Codeur a le droit de travailler |
| `modeles.chef` | le modèle de Max (planification et relecture) |
| `modeles.robots` | le modèle des robots ; `sonnet` économise ton quota, `haiku` encore plus |
| `limites` | au maximum 5 robots et 3 étapes par mission, 20 minutes par robot |

## Lancer le Bureau

```bash
cd claude-agents/bureau
npm start
```

Ton navigateur s'ouvre sur **http://localhost:4747**. Laisse la fenêtre du Terminal ouverte pendant que tu utilises le Bureau. `Ctrl+C` le ferme.

## Utilisation

1. **Écris ta mission** en bas, puis appuie sur Entrée (ou clique sur 🚀 Lancer). Par exemple :
   - « Compare 5 mutuelles pour un jeune actif à Paris et fais-moi un tableau »
   - « Ajoute un écran de statistiques d'entraînement dans Cynox Fitness »
   - « Écris 10 posts Instagram pour lancer Lifforge, avec un calendrier »
2. **Max planifie** (🧠), annonce son équipe, et les robots entrent par la porte.
3. **Les robots travaillent.** Ceux qui attendent leur tour patientent au café ☕. Les bulles montrent ce que chacun fait vraiment.
4. **Clique sur un robot** (ou sur Max) pour voir sa tâche, tout ce qu'il a fait et son rapport.
5. **Max relit** (🔍), corrige si besoin et écrit la synthèse, qui s'ouvre toute seule à la fin.

Les icônes au-dessus des robots :

| Icône | Signification |
|---|---|
| ☕ | il attend son tour |
| ✅ | il a fini et rendu son rapport |
| 💤 | ton quota Claude est atteint : clique sur **▶️ Reprendre** plus tard |
| ❗ | il a eu un problème : clique dessus pour voir lequel |

Boutons du haut : **📄 Résultat**, **⏹ Arrêter**, **▶️ Reprendre** (après un quota atteint), **📜 Historique** (missions passées), **📁 Dossier** (ouvre le dossier dans le Finder).

## Parler à Max (micro et voix)

- **🎤 Parler** (ou **Option + Espace**) : dis ta mission, elle s'écrit dans la zone en bas. Le micro s'arrête tout seul quand tu fais une pause. Tu peux relire et corriger avant d'appuyer sur Entrée.
- **Lancer dès que j'ai fini de parler** : coche cette case pour que la mission parte toute seule, sans toucher au clavier.
- **Max te répond à voix haute** quand il annonce son équipe, quand la mission est finie (il lit le résumé en 3 lignes) et en cas de pause ou d'échec.
- **🔊 / 🔇** en haut : coupe ou remet sa voix. Ton choix est retenu.

À savoir :
- Ça marche dans **Chrome ou Safari**. Firefox ne sait pas faire de dictée : les boutons n'y apparaissent pas.
- Le navigateur te demande l'autorisation du micro la première fois. Sur Safari, la **Dictée** du Mac doit être activée (Réglages Système > Clavier).
- Pour transcrire ta voix, le navigateur l'envoie à **Google (Chrome) ou Apple (Safari)**. Le Bureau, lui, ne l'enregistre nulle part.
- Pour une voix de Max plus naturelle, télécharge une voix française « améliorée » ou « Premium » dans les réglages d'accessibilité du Mac (rubrique « Contenu énoncé »). Le Bureau choisit tout seul la meilleure voix française installée.
- Si tu recharges la page pendant une mission, clique une fois n'importe où dans la page : sans ça, le navigateur peut empêcher Max de parler.

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

```bash
cd ~/Code/Cynox-Fitness
git diff HEAD...bureau/ecran-stats   # voir les changements
git merge bureau/ecran-stats         # les garder si ça te plaît
```

Pour faire le ménage une fois la branche fusionnée ou abandonnée : `git worktree prune`, puis `git branch -D bureau/ecran-stats`.

## Ce que les robots ont le droit de faire

- Ils travaillent **sans te demander de validation** (autonomie totale).
- Chaque métier n'a que ses outils : seuls le Codeur et l'Analyste peuvent lancer des commandes, et seuls le Chercheur et le Designer vont sur le web.
- `git push`, `rm -rf` et `sudo` sont interdits.
- Les écritures de fichiers sont limitées au dossier de la mission (et à la copie de travail du Codeur).
- Les robots n'ont **pas accès à tes connecteurs** (mails, agenda, Drive…).

## Ton quota d'abonnement

Chaque robot est une vraie session Claude Code, donc une mission à 4 robots consomme ton quota environ 4 fois plus vite qu'une conversation normale. Max utilise Opus, les robots Sonnet. Si la limite est atteinte, rien n'est perdu : la mission se met en pause 💤 et tu cliques sur **▶️ Reprendre** quand ton quota est revenu. Le Bureau doit rester ouvert entre-temps ; s'il est fermé, la mission apparaît « interrompue » dans l'historique, avec les rapports déjà écrits.

## Dépannage

| Problème | Solution |
|---|---|
| Bandeau « claude introuvable » | Installe Claude Code, puis relance `npm start`. |
| Bandeau « pas connecté » | Lance `claude auth login` dans le Terminal, puis relance `npm start`. |
| « Le port 4747 est déjà utilisé » | Le Bureau est sans doute déjà ouvert dans un autre Terminal. Sinon, change `port` dans `bureau.config.json`. |
| Le Codeur ne démarre pas (❗) | Vérifie le `chemin` du projet dans `bureau.config.json` : ce doit être un dépôt Git. |
| Un robot reste bloqué | Au bout de 20 minutes, il s'arrête tout seul (❗) et Max continue sans lui. Tu peux aussi cliquer sur **⏹ Arrêter**. |

## Pour les développeurs

```bash
npm test          # tests (avec un faux « claude » : aucun quota consommé)
npm run build     # vérification TypeScript + construction de la page
```

`CLAUDE_BIN=/chemin/vers/claude` change le binaire utilisé ; `BUREAU_NO_OPEN=1` évite d'ouvrir le navigateur. `test/fake-claude.mjs` imite `claude -p`, ce qui permet de voir le Bureau tourner sans rien dépenser :

```bash
CLAUDE_BIN=$PWD/test/fake-claude.mjs FAKE_DELAY=1200 npm start
```
