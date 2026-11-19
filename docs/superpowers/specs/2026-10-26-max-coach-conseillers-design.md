# Max coach et les conseillers

**Statut : construit** (voir `bureau/README.md`, sections « Max, ton coach » et « Les conseillers »).
L'utilisateur a demandé, avant d'aller dormir, d'« installer tout ce qui peut être ultra utile pour Max », en tenant
compte de sa situation, puis a ajouté : « un agent pour chaque domaine de ma vie ». Le reste est décidé par
l'implémenteur et noté ici pour relecture.

## Ce qui a guidé les choix

La situation décrite par l'utilisateur : un examen le 14 décembre (PASS), un mois sans réviser, l'envie de
6 heures de travail par jour en partant de zéro, beaucoup de temps passé sur ses projets (un soulagement par rapport à
l'angoisse des cours), un rythme décalé (coucher vers 3 h, lever vers 11 h), du mal à démarrer et surtout à
continuer, et un réflexe, quand le retard grandit : refaire un plan ou construire un nouvel outil.

D'où trois principes :
1. **Max sert à démarrer et à tenir, pas à planifier.** La brique centrale est la session minutée lancée à la voix,
   avec une annonce à la fin, même si Max dormait. Pas de nouveau planning à remplir.
2. **Des chiffres vrais, sans culpabiliser.** Un journal des sessions et un bilan (jour, veille, 7 jours, série) ; la
   consigne demande une progression réaliste et interdit la morale.
3. **Les idées ne sont pas perdues, mais pas maintenant.** Un parking à idées remplace le « je m'y mets tout de
   suite » pendant les heures de travail ; l'utilisateur décide toujours.

## Coach (`server/max/coach.ts`)

| Brique | Détail |
|---|---|
| Profil | `~/Documents/Bureau/moi.md`, écrit par l'utilisateur (modèle dans `bureau/modeles/moi.md`, copié par `npm run setup`). Entier dans la consigne de Max et de chaque conseiller (8000 caractères au plus). |
| Échéances | lignes `- AAAA-MM-JJ : nom` (ou JJ/MM/AAAA) de moi.md ; l'outil `ajouter_echeance` les écrit dans la section « Échéances ». Compte à rebours en jours calendaires. |
| Sessions | une à la fois, 1 à 180 minutes (25 par défaut) ; pause de 1 à 60 minutes (5 par défaut), non comptée. Arrêter avant la fin note le temps réel (rien sous une minute). Lancer une pause pendant une session note la session. |
| Journal | `travail.jsonl` (une ligne par session). La nuit jusqu'à 5 h compte pour la veille (l'utilisateur se couche tard). |
| Bilan | aujourd'hui (et nombre de sessions), hier, 7 derniers jours et moyenne, série de jours d'affilée (aujourd'hui compte dès la première session, sinon la série d'hier est gardée). |
| Rappels | « dans N minutes » ou « à HH:MM » (demain si l'heure est passée). Dits tels quels par la voix de Max, sans passer par le modèle (fiable même quota atteint). |
| Redémarrage | minuteur et rappels sauvés dans le dossier des données : une session en cours reprend ; une session finie pendant que le Bureau était fermé est notée ; un rappel manqué de plus d'une heure est abandonné. |

**Max et le minuteur.** À la fin d'une session ou d'une pause, Max se réveille s'il dormait et reçoit un message
`[Bureau]` ; il félicite, demande ce qui a été fait, propose la pause ou la session suivante. Son accueil dit le travail
du jour s'il y en a. Chaque message de l'utilisateur est préfixé par l'heure (`[14:32]`) pour que Max sache l'heure
pendant une longue conversation. Ce qui est fait depuis la page (⏱ Session, ⏹ Stop) est transmis à Max avec le
message suivant (`[Bureau, pour info] …`), sinon il croirait encore la session en cours. La consigne contient un contexte du jour (date, échéances, bilan, minuteur, rappels,
idées) et une section « Coach » (plus petite étape, progression, retard sans culpabilité, parking à idées, matin,
soir et sommeil par petits pas, écoute en cas d'angoisse, orientation vers le service de santé universitaire ou
Santé Psy Étudiant si le mal-être dure, 3114 en cas d'idées noires).

**Le compte à rebours n'est pas dit à chaque réveil** (seulement à l'écran et quand on dit bonjour) : l'utilisateur
dit que l'échéance l'angoisse ; l'accueil met plutôt en avant le travail déjà fait.

## Conseillers (`server/max/conseillers.ts`)

Cinq conseillers par défaut, un par domaine : 🩺 Prof (études), 💪 Coach (santé), 💼 Associé (business), 📱 Dev (apps),
🏠 Majordome (vie perso). Remplaçables ou complétables dans `bureau.config.json` (`conseillers`) ; un conseiller qui
reprend l'id d'un défaut garde ce qui n'est pas changé.

- **Une consultation = un `claude -p`** (modèle des robots), WebSearch et WebFetch seulement, `--strict-mcp-config`,
  4 minutes au plus. Sa consigne : son domaine et sa manière (méthodes d'apprentissage actives pour le Prof, sources
  sérieuses et orientation vers un professionnel pour le Coach, rappel de la priorité du moment pour l'Associé…),
  le profil moi.md, ses notes, le contexte du jour.
- **Ses notes** : `conseillers/<id>.md` ; il y ajoute ses lignes « À retenir : … » (retirées de la réponse).
  Max peut aussi y écrire (`noter_pour_conseiller`).
- **Un à la fois par conseiller** ; plusieurs conseillers peuvent réfléchir en même temps.
- **Pourquoi pas des missions ?** Une mission sert un travail long qui produit des fichiers ; une consultation est une
  réponse rapide qui revient à Max dans la conversation. Pour un vrai travail, le conseiller recommande une mission.

**Écran.** La scène s'agrandit (960 × 690) : en bas, l'aile des conseillers, moquette bleue, un bureau chacun. Le
conseiller interrogé s'anime, son écran s'allume, sa bulle montre ce qu'il fait, puis « Réponse transmise à Max ».
Un clic montre sa dernière question et sa réponse complète. Au passage, la zone cliquable des robots, décalée d'un
demi-sprite vers le haut à gauche, a été recalée.

**Panneau de Max.** Puces ⏱ minuteur (compte à rebours à la seconde), 📚 travail du jour, 📅 J-N et prochaine
échéance ; boutons ⏱ Session 25 min et ⏹ Stop.

## Siri

Le raccourci s'appelle désormais **« Max au rapport »** : avec « Réveille Max », Siri répondait « à quelle heure dois-je
programmer l'alarme ? ». Le nom est réglable (`voix.phraseSiri`) et rappelé quand Max s'endort.

## Tests

Coach (minuteur avec horloge simulée, bilan, échéances, rappels, redémarrage), conseillers (faux `claude` en mode
conseiller), assistant (fin de session, rappels, accueil, horodatage), outils MCP de bout en bout avec un vrai client
MCP, WebSocket (session depuis la page, conseillers dans l'état), affichage (durées, temps restant). Vérifié dans un
vrai navigateur (Playwright) : aile des conseillers, bulle pendant une consultation, panneau d'un conseiller, puces du
coach. Essai réel avec le vrai `claude` (Opus) et les outils MCP : Max lance une session, consulte le Prof (qui note
un fait dans son carnet), propose de mettre une idée Instagram au parking pendant la session, puis annonce de
lui-même la fin d'une session d'une minute.

## Hors périmètre (pour plus tard, avec l'utilisateur)

Conseillers qui agissent seuls (publier des vidéos, Post for Me), statistiques graphiques, synchronisation avec un
agenda, rappels quand le Bureau est fermé (il faudrait un démarrage automatique, écarté jusqu'ici).
