# Bureau d'agents — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire `claude-agents/bureau/`, un bureau pixel art local où Max et ses robots (de vrais processus `claude -p`) exécutent une mission en direct.

**Architecture:** Un serveur Node/TypeScript (HTTP + WebSocket) orchestre une mission en trois phases (plan → étapes parallèles → relecture) en lançant des processus `claude -p`, traduit leur flux `stream-json` en bulles et diffuse un instantané complet de l'état à la page web. La page (Phaser 3, construite par Vite) dessine le bureau et anime les robots à partir de cet instantané.

**Tech Stack:** Node 20+, TypeScript, tsx, ws, zod, Phaser 3, Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-bureau-agents-design.md`

## Global Constraints

- Tous les textes visibles par l'utilisateur sont en français.
- Port par défaut `4747`, écoute sur `127.0.0.1` uniquement.
- Dossier des missions par défaut `~/Documents/Bureau`, un dossier par mission nommé `AAAA-MM-JJ HHhMM - <slug>`.
- Modèles par défaut : chef `opus`, robots `sonnet` (modifiables dans `bureau.config.json`).
- Limites par défaut : 5 robots, 3 étapes, 20 minutes par robot.
- Bulle : 60 caractères maximum, terminée par `…` si tronquée.
- Chaque robot est lancé sans shell (`spawn` avec un tableau d'arguments), avec `--tools` (outils réellement disponibles), `--allowedTools` (même liste, pré-approuvée), `--permission-mode acceptEdits`, `--disallowedTools "Bash(git push:*)" "Bash(rm -rf:*)" "Bash(sudo:*)"`, `--output-format stream-json --verbose`.
- Max planifie avec `--output-format json --json-schema <schéma>` et lit `structured_output`.
- Le binaire `claude` est remplaçable par la variable d'environnement `CLAUDE_BIN` (tests).
- Le Codeur travaille dans un `git worktree` sur la branche `bureau/<slug>`. Jamais de push.

## Review Focus

1. Une mission avec accents, guillemets ou retours à la ligne doit donner un slug propre et arriver intacte à `claude` (argv, pas de shell). Test : `slugify` + test d'intégration avec un texte à guillemets.
2. Deux missions identiques lancées dans la même minute ne doivent pas partager un dossier. Test : `createMissionDir` ajoute `-2`.
3. Le flux d'un processus peut arriver en morceaux coupés au milieu d'une ligne, ou contenir des lignes non JSON. Test : `LineSplitter` + traducteur qui ignore les lignes invalides.
4. Cliquer sur **Lancer** pendant qu'une mission tourne doit être refusé proprement. Test : `MissionManager.lancer` renvoie une erreur.
5. `claude` introuvable (ENOENT) ne doit pas faire planter le serveur. Test : `runAgent` avec un binaire inexistant renvoie `ok: false`.

---

### Task 1: Socle du projet, configuration et rangement

**Files:**
- Create: `bureau/package.json`, `bureau/tsconfig.json`, `bureau/vite.config.ts`, `bureau/.gitignore`
- Create: `bureau/shared/protocol.ts`, `bureau/server/config.ts`, `bureau/server/storage.ts`
- Test: `bureau/test/storage.test.ts`, `bureau/test/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(dir: string): BureauConfig`, `expandHome(p: string): string`, `slugify(text: string, maxWords = 6): string`, `missionDirName(date: Date, slug: string): string`, `createMissionDir(root: string, slug: string, date: Date): string`, `writeEtat(dir, etat: EtatFichier)`, `appendJournal(dir, entry: object)`, `listMissions(root): MissionResume[]`, `markInterrupted(root): number`.
- Produces (protocol): types `Phase`, `RobotStatut`, `RobotVue`, `MissionVue`, `EtatBureau`, `ServerMessage`, `ClientMessage`, `MissionResume`.

- [ ] Tests : `slugify("Compare 5 mutuelles à Paris !")` → `"compare-5-mutuelles-a-paris"` ; `missionDirName(new Date(2026,9,25,14,32), "x")` → `"2026-10-25 14h32 - x"` ; deux `createMissionDir` identiques → le second finit par `-2` ; `markInterrupted` passe une mission `en-cours` à `interrompue` ; `loadConfig` sans fichier renvoie les valeurs par défaut des Global Constraints et fusionne un fichier partiel.
- [ ] Vérifier l'échec, implémenter, vérifier le succès (`npx vitest run`).
- [ ] Commit.

### Task 2: Métiers, schéma du plan et traduction des événements

**Files:**
- Create: `bureau/server/roles.ts`, `bureau/server/plan-schema.ts`, `bureau/server/event-translator.ts`
- Test: `bureau/test/roles.test.ts`, `bureau/test/plan-schema.test.ts`, `bureau/test/event-translator.test.ts`, `bureau/test/fixtures/robot-ok.jsonl`

**Interfaces:**
- Produces: `ROLES: Record<RoleId, RoleDef>` (`chercheur | codeur | designer | redacteur | analyste`), `robotArgs(opts: {role, tache, prompt, model, extraDirs, resumeSessionId?}): string[]`, `planArgs(...)`, `reviewArgs(...)`.
- Produces: `PLAN_JSON_SCHEMA`, `parsePlan(raw: unknown, limites): Plan` (lève `PlanInvalide`), `type Plan = {titre, slug, projet: string|null, etapes: {robots: {role, tache}[]}[]}`.
- Produces: `class LineSplitter { push(chunk: string): string[]; flush(): string[] }`, `translate(line: string): Traduction | null` avec `Traduction = {bulle?: string; action?: string; sessionId?: string; resultat?: {ok: boolean; texte: string; quota: boolean; structured?: unknown}}`, `tronquer(texte, max = 60)`.

- [ ] Tests : `robotArgs` du chercheur contient `--tools` avec `WebSearch,WebFetch,Read,Write,Edit,Glob,Grep` et pas `Bash` ; celui du codeur contient `Bash` et les trois `--disallowedTools` ; `parsePlan` refuse un rôle inconnu, plus de 5 robots, plus de 3 étapes, une étape vide ; `translate` sur la fixture donne « Je cherche : … », « Je lis maif.fr… », « J'écris rapport.md », puis un résultat `ok: true` ; une ligne `not json` donne `null` ; un `result` avec « usage limit » ou `rate_limit_event` rejeté donne `quota: true` ; `LineSplitter` reconstitue une ligne coupée en deux morceaux.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit.

### Task 3: Lanceur d'agent, worktree Git et faux `claude`

**Files:**
- Create: `bureau/server/agent-runner.ts`, `bureau/server/git-worktree.ts`, `bureau/test/fake-claude.mjs`
- Test: `bureau/test/agent-runner.test.ts`, `bureau/test/git-worktree.test.ts`

**Interfaces:**
- Consumes: `LineSplitter`, `translate`.
- Produces: `runAgent(opts: {bin: string; args: string[]; cwd: string; timeoutMs: number; mode: "stream" | "json"; onTraduction?(t: Traduction): void; onRawLine?(l: string): void}): AgentHandle` avec `AgentHandle = {done: Promise<RunResult>; stop(): void}` et `RunResult = {ok; quota; sessionId?; texte; structured?; erreur?}`.
- Produces: `createWorktree(projectPath, targetDir, slug): Promise<{path, branch}>` (lève `ProjetInvalide`), `commitAll(worktree, message): Promise<boolean>`.
- `fake-claude.mjs` : mode JSON si `--json-schema` est présent (renvoie `FAKE_PLAN` ou un plan par défaut à 2 étapes) ; sinon écrit `rapport.md` (ou `RESULTAT.md` si le prompt contient `RELECTURE`) dans son cwd et émet des événements stream-json ; `FAKE_MODE=quota` → résultat quota sauf avec `--resume` ; `FAKE_MODE=crash` → exit 1 pour les robots ; `FAKE_MODE=bad-plan` → plan invalide.

- [ ] Tests : `runAgent` avec le faux claude renvoie `ok: true` et appelle `onTraduction` ; avec `/nexiste/pas` renvoie `ok: false` sans lever ; `stop()` termine le processus ; timeout de 200 ms sur un faux qui dort → `ok: false`, `erreur` mentionne le délai ; `createWorktree` sur un dépôt temporaire crée la branche `bureau/x` ; deux appels → `bureau/x-2` ; un dossier non Git → `ProjetInvalide` ; `commitAll` crée un commit quand il y a des changements.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit.

### Task 4: Orchestrateur de mission

**Files:**
- Create: `bureau/server/mission.ts`
- Test: `bureau/test/mission.test.ts`

**Interfaces:**
- Consumes: tout ce qui précède.
- Produces: `class MissionManager extends EventEmitter` (`"etat"` émis à chaque changement avec `EtatBureau`) : `constructor(config, bin)`, `lancer(texte: string): {ok: true} | {ok: false; erreur: string}`, `arreter(): void`, `reprendre(): {ok} | {ok:false; erreur}`, `snapshot(): EtatBureau`, `attendreFin(): Promise<void>` (tests).
- Déroulé : dossier + `MISSION.md` + `etat.json` → planification (2 essais) → `plan.json` → étapes en parallèle (dossier `equipe/<role>-<n>/`, codeur dans le worktree avec `--add-dir` de son dossier, tous avec `--add-dir` du dossier mission, prompt contenant les rapports des étapes précédentes) → relecture par Max (prompt marqué `RELECTURE`) → `RESULTAT.md` (repli sur le texte final si absent, section « Branche Git » ajoutée si worktree) → phase `termine`. Quota → phase `pause` et robots `quota` ; `reprendre` relance ces robots avec `--resume` puis continue. Toutes les actions vont dans `journal.jsonl`.

- [ ] Tests (faux claude) : mission complète → phase `termine`, `RESULTAT.md`, deux rapports, `journal.jsonl` non vide, robots `fini` ; `lancer` pendant une mission → refus ; `FAKE_MODE=quota` → phase `pause`, puis `reprendre` → `termine` ; `FAKE_MODE=crash` → robots `erreur`, la relecture a quand même lieu, `termine` ; `FAKE_MODE=bad-plan` → phase `echec` après 2 essais ; un texte avec guillemets et retour à la ligne arrive intact dans `MISSION.md`.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit.

### Task 5: Serveur HTTP/WebSocket et installation

**Files:**
- Create: `bureau/server/index.ts`, `bureau/server/http.ts`, `bureau/server/setup.ts`, `bureau/server/claude-check.ts`
- Test: `bureau/test/http.test.ts`

**Interfaces:**
- Consumes: `MissionManager`, `listMissions`, `markInterrupted`.
- Produces: `createBureauServer({config, manager, webDir}): http.Server` ; routes `GET /` (fichiers de `web/dist`), `GET /api/missions`, `GET /api/missions/:nom/resultat`, `GET /api/missions/:nom/fichier?chemin=…` (refuse `..`) ; WebSocket `/ws` : envoie `{type:"etat"}` à la connexion et à chaque changement ; reçoit `ClientMessage` (`lancer`, `arreter`, `reprendre`, `ouvrir-dossier`). `checkClaude(bin): Promise<{ok; version?; erreur?}>`. `npm run setup` crée `bureau.config.json` s'il manque et affiche le résultat de `checkClaude`. `index.ts` ouvre le navigateur (`open` sur macOS) sauf si `BUREAU_NO_OPEN=1`.

- [ ] Tests : `GET /api/missions` liste un dossier de mission ; `fichier?chemin=../../etc/passwd` → 400 ; un client WebSocket reçoit un message `etat` à la connexion ; envoyer `lancer` avec le faux claude fait passer la phase à `termine`.
- [ ] Vérifier l'échec, implémenter, vérifier le succès.
- [ ] Commit.

### Task 6: Le bureau pixel art

**Files:**
- Create: `bureau/web/index.html`, `bureau/web/main.ts`, `bureau/web/sprites.ts`, `bureau/web/office-scene.ts`, `bureau/web/robot.ts`, `bureau/web/ui.ts`, `bureau/web/style.css`

**Interfaces:**
- Consumes: `shared/protocol.ts`.
- `sprites.ts` génère les textures depuis des cartes de pixels en chaînes (robots par couleur de métier, Max, bureau, sol, porte, café). Scène 960×540, tuiles 16×16 ×3. Robots : marche entre porte → poste/café → table de Max ; bulle 60 caractères ; icônes ☕ ✅ 💤 ❗. UI HTML par-dessus le canvas : barre de mission, phase + chrono, panneau robot (tâche + fil d'actions + lien rapport), panneau résultat (Markdown simple rendu en HTML échappé), historique, bandeau d'erreur `claude`, boutons Arrêter / Reprendre / Ouvrir le dossier.

- [ ] `npm run build` passe sans erreur TypeScript.
- [ ] Vérification visuelle : serveur lancé avec `CLAUDE_BIN=test/fake-claude.mjs`, mission lancée via Playwright, captures d'écran pendant le travail et à la fin ; les robots, les bulles et le résultat sont visibles.
- [ ] Commit.

### Task 7: Documentation

**Files:**
- Create: `bureau/README.md`
- Modify: `README.md` (ajouter le lien vers `bureau/`), spec (ajustements constatés pendant la construction)

- [ ] README : prérequis, installation, `npm run setup`, configuration des projets, `npm start`, utilisation, quota, branches Git, dépannage.
- [ ] `npm test` et `npm run build` passent.
- [ ] Commit et push.
