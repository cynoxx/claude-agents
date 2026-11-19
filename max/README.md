# Max

Application personnelle pour savoir **quoi faire maintenant**, retrouver ses engagements et **recaler sa journée**.
En français, pour une seule personne, sur iPhone et Mac.

**Architecture** : application web installable (PWA) en React + TypeScript. Les données sont stockées dans IndexedDB, sur l'appareil.
Aucun serveur et aucun compte. Max fonctionne hors connexion une fois chargé.
Le moteur de recalage (`src/core/engine`) et l'interprétation des phrases (`src/core/nlu`) sont du code pur, testé, sans modèle de langage.

## Lancer

```bash
cd max
npm install
npm run build && npm run preview   # http://localhost:4173
```

Développement : `npm run dev`. Tests : `npm test` (moteur, interprétation, stockage, import et export). Parcours navigateur : `npm run e2e`, qui demande Playwright.

### Sur Mac
`npm run preview`, puis ouvre `http://localhost:4173` dans Safari ou Chrome. Dans Safari, utilise *Fichier → Ajouter au Dock* pour avoir une vraie fenêtre Max.

### Sur iPhone
L'iPhone doit pouvoir joindre l'adresse de Max :
- **Même Wi-Fi que le Mac** : lance `npm run preview` (déjà en `--host`) et ouvre `http://<IP-du-Mac>:4173` dans Safari. Le mode hors ligne et l'installation exigent HTTPS, donc ce mode ne sert qu'à essayer.
- **Usage réel** : une version hébergée en HTTPS avec un accès privé (voir `docs/analyse-et-decisions.md`). Ensuite, dans Safari, utilise *Partager → Sur l'écran d'accueil*.

Chaque appareil a **ses propres données** : il n'y a pas encore de synchronisation. Pour passer de l'un à l'autre, va dans *Réglages → Sauvegarde → Exporter*, puis *Importer* sur l'autre appareil (fusion sans doublon).

## Usage en 4 gestes

- **Ajouter un contrôle** : dans le champ du haut (⌘K sur Mac), écris « contrôle d'électricité jeudi, heure à vérifier, réviser les circuits » puis valide. Max crée l'échéance, la préparation et une tâche « vérifier l'heure ». Il te demandera l'heure sur Aujourd'hui.
- **Recaler aujourd'hui** : bouton *Recaler*, ou écris « le TP déborde jusqu'à 17 h ». Max affiche d'abord la décision et le résumé, puis le détail. *Tout appliquer* crée un seul lot, annulable depuis le toast ou depuis *Réglages → Historique*.
- **Retrouver une tâche décalée** : ouvre *Liste → À faire*. Une tâche sortie d'aujourd'hui y reste avec sa date et son projet.
- **Sauvegarder** : *Réglages → Sauvegarde → Exporter* (avec ou sans données privées).

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/core/types.ts` | Modèle de données (capture, domaine, projet, tâche, échéance, bloc, récurrence, vidéo, journal, préférences, lots) |
| `src/core/engine/planner.ts` | Moteur de recalage déterministe |
| `src/core/nlu/parse.ts` | Grammaire d'intentions v1.0 (voir `docs/grammaire-intentions.md`) |
| `src/core/backup.ts`, `ics.ts`, `batch.ts`, `recurrence.ts` | Sauvegarde et import, agenda .ics, annulation par lot, récurrences et changements d'heure |
| `src/app/` | Stockage IndexedDB transactionnel et actions de domaine |
| `src/ui/` | Vues Aujourd'hui, Agenda, Liste, Réglages et Journal ; capture ; Recaler |
| `e2e/run.mjs` | Parcours complet dans Chromium (iPhone et bureau) |
