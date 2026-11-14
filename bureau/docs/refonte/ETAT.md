# État des lieux (14 novembre 2026)

Tests au départ : 535 passent, 1 ignoré. Captures « avant » : `avant/jarvis.png`, `avant/bureau.png`.

## Ce qui existe

| Partie | Fichiers | État |
|---|---|---|
| Cerveau | `server/max/assistant.ts`, `cerveau.ts`, `consigne.ts`, `outils-mcp.ts` | Solide. `claude -p` + serveur MCP, liste fermée d'outils, confirmations. |
| Coach, plan, sanctions, décisions | `coach.ts`, `plan.ts`, `vie.ts`, `planning.ts` | Solide et testé. |
| Deux écrans | `server/fenetre.ts`, `web/main.ts` | Fait, pas encore essayé sur le Mac de Johan. |
| Pointeur à la main, visage | `web/pointeur*.ts`, `visage*.ts`, `regard.ts` | Fonctionne. |
| Oreille | `web/ecoute*.ts` (Chrome), `server/voix/whisper.ts` | Marche, mais Chrome envoie le son à Google. |
| Bouche | `server/voix/bouche.ts`, XTTS, Piper, ElevenLabs, `say` | Marche. Voix jugée « horrible » par Johan avec `say`. |
| Écran Jarvis | `web/jarvis.ts`, `humanoide.ts`, `montagnes.ts`, `systeme*.ts`, `style.css` | Chargé : 9 panneaux, Max petit au milieu. |
| Écran Bureau | `web/office-scene.ts`, `sprites*.ts`, `decor*.ts` (Phaser) | Pixel art : un autre monde que l'écran Jarvis. |
| Ouverture | `web/oeil-code.ts`, `intro.ts`, `eclat.ts` | Belle, mais longue et en canvas 2D. |

## Ce que je garde

- Tout le serveur : cerveau, outils, coach, plan, sanctions, décisions, confirmations, deux écrans.
- Le pointeur à la main, la reconnaissance du visage, l'oreille qui coupe Max.
- La logique pure déjà testée (`*-pur.ts`), le protocole (`shared/protocol.ts`).
- L'œil noir et rouge comme premier plan de l'ouverture.

## Ce que je refais

- **Le rendu de Max** : aujourd'hui un buste en canvas 2D, petit. Il devient une forme de lumière en three.js, grande, pilotée par la voix.
- **L'écran Jarvis** : de 9 panneaux à 3 informations (mission, échéance, carte du moment).
- **L'écran Bureau** : le pixel art (Phaser) est remplacé par une salle des opérations en 3D, dans la même lumière que l'écran Jarvis. Phaser sort des dépendances.
- **L'ouverture** : même idée (l'œil), refaite dans le moteur 3D, 6 à 10 s, 2 s les fois suivantes.
- **`style.css`** (3 000 lignes, plusieurs époques) : remplacé par un petit système de variables (couleurs, lettres, verre).
- **La voix** : banc d'essai de voix locales, Johan choisit à l'oreille. ElevenLabs est coupé par défaut.
- **L'oreille** : reconnaissance locale, Chrome en secours.

## Ce qui était faux et que j'ai déjà corrigé

- Max croyait Johan en PASS avec un examen le 14 décembre. Plus rien dans le code ne parle de médecine : la filière vit dans `moi.md`.
- Il n'y avait pas de mode examen : ajouté (`examensProches`, `ligneModeExamen` dans `coach.ts`).
- La consigne disait « la question de la médecine est fermée » : remplacé par le refroidissement de 7 jours.

## Limites de cet état des lieux

Je travaille dans un conteneur Linux, sans le Mac. Je n'ai pas vu tourner : le vrai micro, la vraie caméra, deux vrais écrans, les voix sur puce Apple.

## Avancement

- [x] Étape 0 : état des lieux, direction, planches (validées par Johan : un visage dans la sphère, le Bureau en pôles de lumière, plus de niveau ni d'XP).
- [x] Étape 1 : MT2E à la place du PASS, mode examen.
- [x] Étape 3, première partie : Max en 3D (`web/max3d/`), ses sept humeurs, branché sur l'écran Jarvis à la place de l'ancien buste. Page d'atelier : `/atelier.html`.
- [ ] Étape 2 : la voix (banc d'essai, écoute à l'aveugle).
- [ ] Étape 3, suite : WebGPU quand le navigateur le permet (aujourd'hui : WebGL2 partout), la fenêtre couplée à la tête pour toute la scène.
- [ ] Étape 4 : l'ouverture. Étape 5 : les deux écrans. Étape 6 : l'oreille locale et le routeur. Étape 7 : la finition.

Ce qui reste simulé : la voix qui déforme Max. Le son de Max est joué par le serveur, pas par la page ; tant que c'est le cas, la page imite des syllabes (`voixSimulee`). Le vrai son arrivera avec l'étape de la voix (`Entite.nourrirVoix`).

Non vérifié : la fluidité sur le Mac. Les captures viennent d'un rendu logiciel, sans carte graphique.
