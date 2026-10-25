# Le Bureau — guide et design

> Une équipe d'agents Claude Code qui travaille sous tes yeux, dans un bureau en pixel art.
> Inspiré du reel d'Alexis Dubain (15/10/2026).

**Statut : construit.** Le code est dans [`bureau/`](../../../bureau/README.md). Ce document explique à quoi sert le
Bureau, comment l'utiliser et comment il est construit.

---

## 1. À quoi ça te sert

Aujourd'hui, quand tu demandes quelque chose à Claude, **un seul** assistant fait tout, l'un après
l'autre, et tu ne vois qu'un long texte défiler. Le Bureau change trois choses :

1. **Une équipe au lieu d'un seul assistant.** Max, le chef, découpe ta mission et la confie à des
   spécialistes (chercheur, codeur, designer, rédacteur, analyste) qui travaillent **en même temps**.
   Une mission « recherche + tableau + texte » va plus vite et chaque partie est mieux faite, parce que
   chaque robot n'a qu'un seul travail à faire.
2. **Tu vois qui fait quoi, en direct.** Chaque robot affiche dans sa bulle ce qu'il fait vraiment
   (« Je lis maif.fr… », « J'écris StatsScreen.tsx… »). Tu cliques sur un robot pour voir tout son
   historique. Plus de boîte noire.
3. **Tout est rangé et vérifié.** Chaque mission a son dossier dans `Documents/Bureau`, avec le résultat
   final, le rapport de chaque robot et ses sources. Max relit tout avant de te rendre le résultat.

### Exemples de missions pour toi

| Domaine | Exemple de mission | Qui Max va probablement appeler |
|---|---|---|
| Vie perso / admin | « Compare 5 mutuelles pour un jeune actif à Paris, fais-moi un tableau prix/garanties » | Chercheur ×2 → Analyste |
| Vie perso / admin | « Prépare un week-end de 3 jours à Lisbonne en mai, budget 600 € » | Chercheur → Analyste → Rédacteur |
| Cynox Fitness | « Ajoute un écran de statistiques d'entraînement avec un graphique par semaine » | Designer → Codeur |
| Lifforge | « Trouve et corrige les bugs de l'onboarding, et ajoute des tests » | Codeur |
| Business / contenu | « Analyse 5 concurrents de Cynox et propose un positionnement » | Chercheur ×2 → Analyste → Rédacteur |
| Business / contenu | « Écris 10 posts Instagram pour lancer Lifforge, avec un calendrier de publication » | Chercheur → Rédacteur |

### Ce que le Bureau ne fait pas

- Il ne se connecte pas à tes comptes (banque, mail, sites avec mot de passe). Les robots lisent le web
  public et tes fichiers.
- Il ne pousse jamais de code sur GitHub et ne modifie jamais ta branche principale. Il te laisse une
  branche à relire.
- Il peut se tromper. Max relit, mais **vérifie toujours les chiffres importants** (prix, montants,
  dates) avant de t'en servir.

---

## 2. Comment l'utiliser (le jour où c'est construit)

### Installation, une seule fois

Prérequis : un Mac avec Claude Code installé et connecté à ton abonnement (c'est déjà ton cas), et
Node.js 20 ou plus (`node --version` pour vérifier ; sinon `brew install node`).

```bash
git clone https://github.com/cynoxx/claude-agents.git
cd claude-agents/bureau
npm install
npm run setup     # crée bureau.config.json et vérifie que `claude` répond
```

Ouvre ensuite `bureau.config.json` et indique où sont tes projets, pour que le Codeur puisse y
travailler :

```json
{
  "projets": [
    { "nom": "Cynox Fitness", "chemin": "~/Code/Cynox-Fitness" },
    { "nom": "Lifforge",      "chemin": "~/Code/lifforge" }
  ]
}
```

### Lancer le Bureau

```bash
cd claude-agents/bureau
npm start
```

Ton navigateur s'ouvre sur `http://localhost:4747`. Le bureau est accessible uniquement depuis ton Mac.

### Déroulé d'une mission

1. **Tu écris la mission** dans la barre du bas et tu cliques sur **Lancer** (ou tu appuies sur Entrée).
2. **Max planifie.** Sa bulle affiche « Je découpe la mission… ». En quelques secondes, il annonce son
   équipe.
3. **Les robots entrent** par la porte et vont à leur poste. Ceux de la première étape commencent tout
   de suite ; ceux de l'étape suivante attendent à la machine à café jusqu'à ce que les premiers aient
   fini.
4. **Tu regardes.** Les bulles bougent en direct. Clique sur un robot pour ouvrir son panneau : sa tâche,
   la liste de toutes ses actions et, quand il a fini, son rapport.
5. **Les robots apportent leur rapport à Max**, qui relit, corrige si besoin et écrit la synthèse.
6. **Le résultat s'affiche** dans un panneau, avec un bouton **Ouvrir le dossier** (Finder).

Une mission prend en général entre 5 et 30 minutes. Laisse ton Mac allumé et la fenêtre du Terminal
ouverte pendant ce temps.

### Retrouver une ancienne mission

- Dans le Bureau : bouton **Historique** en haut à gauche. Clique sur une mission pour relire son
  résultat.
- Dans le Finder : `Documents/Bureau/`, un dossier par mission.

### Quand le Codeur a travaillé sur Cynox ou Lifforge

Ta branche principale n'est pas touchée. Le Codeur travaille sur une branche à part, dont le nom est
donné à la fin de la mission (par exemple `bureau/ecran-stats`). Pour voir et récupérer son travail :

```bash
cd ~/Code/Cynox-Fitness
git diff main...bureau/ecran-stats   # voir les changements
git merge bureau/ecran-stats         # les garder si ça te plaît
```

### Les petites icônes au-dessus des robots

| Icône | Signification |
|---|---|
| 💬 bulle | le robot travaille ; la bulle montre son action en cours |
| ☕ | il attend son tour (étape suivante) |
| ✅ | il a fini et rendu son rapport |
| 💤 | ton quota Claude est atteint ; il reprendra quand tu cliqueras sur **Reprendre** |
| ❗ | il a rencontré un problème ; clique dessus pour voir lequel |

### Ton quota d'abonnement

Chaque robot est une vraie session Claude Code, donc une mission avec 4 robots consomme ton quota
environ 4 fois plus vite qu'une conversation normale. Pour l'économiser, **Max utilise Opus** (le plus
intelligent, pour planifier et relire) et **les robots utilisent Sonnet** (rapide et économe). Tu peux
changer ces choix dans `bureau.config.json`. Si le quota est atteint en pleine mission, rien n'est perdu :
les robots s'endorment (💤) et tu cliques sur **Reprendre** plus tard.

---

## 3. Comment c'est construit

### 3.1 Principe

Chaque personnage du bureau est **un vrai processus `claude -p`** (Claude Code en mode automatique),
lancé par un petit serveur Node.js sur ton Mac. C'est simplement toi qui utilises Claude Code, piloté par
un programme. Il utilise donc ta connexion et ton abonnement, sans clé API.

Avec l'option `--output-format stream-json`, chaque `claude -p` envoie en direct chacune de ses actions.
Le serveur les traduit en phrases courtes et les pousse à la page web par WebSocket. La page, un petit
jeu Phaser en pixel art, anime le robot correspondant.

```
 Navigateur (Phaser)  ◄── WebSocket ──►  Serveur Node.js  ──► claude -p (Max)
   bureau pixel art                       mission.ts       ──► claude -p (Chercheur)
   bulles, panneaux                       agent-runner.ts  ──► claude -p (Codeur)  …
                                          storage.ts       ──► ~/Documents/Bureau/
```

### 3.2 Arborescence

```
claude-agents/bureau/
├── package.json             scripts : start, setup, test
├── bureau.config.json       créé par `npm run setup` (projets, modèles, limites)
├── server/
│   ├── index.ts             démarre HTTP + WebSocket, vérifie `claude`, ouvre le navigateur
│   ├── mission.ts           machine à états d'une mission : plan → étapes → relecture
│   ├── agent-runner.ts      lance un `claude -p`, lit le flux JSON, émet des événements
│   ├── event-translator.ts  événement brut → phrase de bulle (« Je lis maif.fr… »)
│   ├── roles.ts             les 5 métiers + Max : instructions, outils autorisés, modèle
│   ├── plan-schema.ts       schéma JSON du plan de Max + validation
│   ├── storage.ts           dossiers de mission, journal, historique
│   └── git-worktree.ts      crée/nettoie la branche de travail du Codeur
├── web/
│   ├── index.html
│   ├── main.ts              connexion WebSocket, routage des messages
│   ├── office-scene.ts      la scène Phaser : carte, postes, porte, café, bureau de Max
│   ├── robot.ts             un robot : sprite, déplacements, bulle, icône d'état
│   ├── sprites-data.ts      cartes de pixels faites maison (16×16, agrandies ×3)
│   ├── markdown.ts          rendu de RESULTAT.md et des rapports
│   └── ui.ts                barre de mission, panneau robot, panneau résultat, historique
├── test/
│   ├── fixtures/            vrais flux stream-json enregistrés
│   ├── fake-claude.mjs      faux `claude` qui rejoue des fixtures (tests sans quota)
│   └── *.test.ts
└── README.md                version courte de la section 2 de ce guide
```

Stack : Node.js 20+, TypeScript, `ws` (WebSocket), Phaser 3, Vite (pour la page), Vitest (tests),
Zod (validation du plan). Pas de base de données, pas de framework serveur lourd.

### 3.3 L'équipe

| Personnage | Rôle | Modèle par défaut | Outils autorisés | Travaille dans |
|---|---|---|---|---|
| **Max** (chef) | planifie, puis relit et synthétise | Opus | Read, Glob, Grep, Write, Edit | dossier de la mission |
| 🔎 Chercheur | recherche web, sources, citations | Sonnet | WebSearch, WebFetch, Read, Write, Edit | `equipe/chercheur-N/` |
| 💻 Codeur | code, corrections, tests | Sonnet | Read, Write, Edit, Glob, Grep, Bash | branche Git du projet + son dossier |
| 🎨 Designer | maquettes HTML/SVG, palettes, parcours | Sonnet | Read, Write, Edit, Glob, WebFetch | `equipe/designer-N/` |
| ✍️ Rédacteur | textes, posts, mails, scripts | Sonnet | Read, Write, Edit | `equipe/redacteur-N/` |
| 📊 Analyste | tableaux, calculs, comparaisons, CSV | Sonnet | Read, Write, Edit, Bash | `equipe/analyste-N/` |

Chaque métier a ses instructions (`--append-system-prompt`) : style de travail, format du rapport
(`rapport.md` avec une section **Sources** obligatoire pour le Chercheur et l'Analyste), et la règle de
n'écrire que dans son dossier.

**Limites** : au maximum 5 robots par mission et 3 étapes. Max peut prendre deux robots du même métier
(par exemple deux chercheurs sur des sujets différents).

### 3.4 Déroulé technique d'une mission

**Phase 1 : planification.** Le serveur crée le dossier de mission et lance Max :

```
claude -p "<mission + liste des métiers + projets connus>" \
  --model opus --output-format json --json-schema <schéma du plan> \
  --tools Read,Glob,Grep --allowedTools Read,Glob,Grep --strict-mcp-config
```

Le plan validé ressemble à ceci :

```json
{
  "titre": "Comparatif mutuelles",
  "slug": "comparatif-mutuelles",
  "etapes": [
    { "robots": [
      { "role": "chercheur", "tache": "Prix et garanties MAIF, MACIF, Alan" },
      { "role": "chercheur", "tache": "Prix et garanties Harmonie, Swiss Life" } ] },
    { "robots": [
      { "role": "analyste", "tache": "Tableau comparatif et recommandation" } ] }
  ],
  "projet": null
}
```

Si le plan est invalide, Max a droit à une seconde tentative. Après un deuxième échec, la mission
s'arrête et l'erreur s'affiche.

**Phase 2 : travail, étape par étape.** Pour chaque étape, tous ses robots sont lancés en parallèle :

```
claude -p "<tâche + mission globale + rapports des étapes précédentes>" \
  --model sonnet --output-format stream-json --verbose \
  --permission-mode acceptEdits --tools <outils du métier> --allowedTools <outils du métier> \
  --strict-mcp-config --settings '{"permissions":{"deny":["Bash(git push:*)","Bash(rm -rf:*)","Bash(sudo:*)"]}}' \
  --append-system-prompt <instructions du métier>
  (cwd = dossier du robot ; --add-dir <worktree> pour le Codeur)
```

Les robots d'une étape reçoivent le chemin des rapports des étapes précédentes, pour pouvoir s'en
servir.

**Phase 3 : relecture.** Max est relancé dans le dossier de la mission. Il lit tous les `rapport.md`,
recoupe les chiffres, corrige ce qui est faux, signale ce qui reste incertain (section **À vérifier**)
et écrit `RESULTAT.md`.

**Garde-fous (option B validée : autonomie totale)** :
- aucune demande de validation ;
- `acceptEdits` + `cwd` : les écritures de fichiers sont limitées au dossier du robot (et au worktree
  pour le Codeur). Une écriture ailleurs est refusée automatiquement ;
- `--tools` limite vraiment les outils de chaque métier (Glob et Grep, en lecture seule, sont donnés à tous) ;
- Bash seulement pour le Codeur et l'Analyste, sans `git push`, `rm -rf` ni `sudo` (règles passées par `--settings`) ;
- `--strict-mcp-config` : les robots n'ont pas accès à tes connecteurs MCP (mails, agenda…) ;
- le Codeur travaille dans un `git worktree` sur la branche `bureau/<slug>`. Ta branche principale et
  ton dossier de travail habituel ne sont jamais modifiés ;
- **risque accepté** : une commande Bash peut techniquement lire des fichiers hors du dossier. C'est le
  prix de l'autonomie totale.

### 3.5 Le dossier d'une mission

```
~/Documents/Bureau/
└── 2026-10-25 14h32 - comparatif-mutuelles/
    ├── RESULTAT.md          ← la synthèse finale de Max (le fichier à ouvrir)
    ├── MISSION.md           ta demande, telle que tu l'as écrite
    ├── plan.json            le plan de Max
    ├── journal.jsonl        toutes les actions de tous les robots, horodatées
    ├── etat.json            état de la mission (en cours / terminée / en pause / échouée)
    └── equipe/
        ├── chercheur-1/rapport.md   (+ fichiers produits)
        ├── chercheur-2/rapport.md
        └── analyste-1/rapport.md, comparatif.csv
```

L'historique du Bureau est simplement la liste de ces dossiers.

### 3.6 L'écran

- **La scène** (960×540, pixel art 16×16 agrandi ×3, vue de dessus) : bureau de Max en haut au centre,
  6 postes de travail, une porte à gauche par où entrent les robots, une machine à café (zone d'attente)
  et une table où ils déposent leur rapport.
- **Les robots** : même silhouette, mais une couleur et un accessoire par métier (loupe, clavier,
  pinceau, plume, graphique). Animations : marche, frappe au clavier, attente, fête quand ils ont fini.
- **La bulle** : la dernière action traduite en français, 60 caractères maximum, remplacée au fil de
  l'eau.
- **Barre du bas** : champ de mission, bouton **Lancer**, phase en cours (Planification, Travail
  étape 1/2, Relecture, Terminé) et chrono.
- **Panneau robot** (clic sur un robot) : métier, tâche, fil de toutes ses actions, lien vers son
  rapport.
- **Panneau résultat** : `RESULTAT.md` mis en forme, bouton **Ouvrir le dossier**.
- **Boutons** : **Historique**, **Arrêter la mission** (stoppe tous les robots proprement), **Reprendre**
  (après un quota atteint).
- Une seule mission à la fois en version 1.

Traduction des actions en bulles (exemples) :

| Événement Claude Code | Bulle |
|---|---|
| `WebSearch` « mutuelle jeune actif prix » | « Je cherche : mutuelle jeune actif prix » |
| `WebFetch` https://www.maif.fr/… | « Je lis maif.fr… » |
| `Write` equipe/analyste-1/comparatif.csv | « J'écris comparatif.csv » |
| `Bash` npm test | « Je lance : npm test » |
| texte de réflexion | début de la phrase, tronqué |
| `result` succès | « Fini ! Je vais voir Max » |

### 3.7 Erreurs et cas difficiles

| Situation | Détection | Ce que tu vois | Ce que fait le Bureau |
|---|---|---|---|
| `claude` absent ou non connecté | `claude --version` + `claude auth status` au démarrage | bandeau rouge avec la commande pour corriger | refuse de lancer une mission |
| Quota d'abonnement atteint | message de limite dans le flux `result` | robots 💤, mission « en pause » | garde les `session_id` ; **Reprendre** relance avec `--resume` |
| Robot planté ou bloqué | code de sortie ≠ 0, ou plus de 20 min sans finir | ❗ sur le robot, détail dans son panneau | les autres continuent ; Max est prévenu qu'un rapport manque |
| Plan invalide | validation Zod | message « Max n'a pas réussi à planifier » | une seconde tentative, puis arrêt |
| Projet introuvable ou pas un dépôt Git | vérification avant le worktree | message clair | le Codeur ne démarre pas, la mission continue sans lui |
| Serveur fermé en pleine mission | au redémarrage, `etat.json` = en cours | mission marquée « interrompue » dans l'historique | les rapports déjà écrits sont conservés |
| Tu cliques sur **Arrêter** | — | robots qui sortent par la porte | arrêt propre de tous les processus, mission « arrêtée » |

### 3.8 Tests

- **Tests unitaires** (Vitest) : traduction des événements en bulles (à partir de vrais flux enregistrés
  dans `test/fixtures/`), validation du plan, nommage et rangement des dossiers, configuration des
  outils par métier, création et nettoyage des worktrees (sur un dépôt Git temporaire).
- **Test d'intégration sans quota** : la variable `CLAUDE_BIN` pointe vers `fake-claude.mjs`, qui rejoue
  des fixtures. Une mission complète (plan → 2 étapes → relecture → `RESULTAT.md`) est vérifiée de bout
  en bout, y compris les cas « quota atteint » et « robot planté ».
- **Test manuel sur ton Mac** : une petite mission réelle (« Trouve 3 idées de recettes protéinées et
  fais-en un tableau »), pour vérifier l'affichage et le vrai `claude`.

### 3.9 Hors périmètre de la version 1

Plusieurs missions en même temps, sons et musique, robots qui discutent entre eux, missions
programmées, accès à tes mails ou à ton agenda, application Mac native avec icône. Tout ça pourra venir
plus tard si la version 1 te plaît.
