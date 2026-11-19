# Analyse du cahier des charges et décisions

## Ce que j'ai amélioré ou tranché dans le prompt

1. **Point de départ.** Le dépôt « Max » n'était pas accessible depuis la session : seuls `claude-agents`, `lifforge` et `Cynox-Fitness` l'étaient. Lifforge est un ancien prototype Figma Make, Cynox-Fitness est vide. J'ai donc construit Max dans `claude-agents/max`, qui a vocation à organiser la vie quotidienne. Le dossier peut être déplacé tel quel.
2. **Une seule boucle avant tout.** L'ordre de construction du prompt est respecté, avec la boucle « j'ajoute mon contrôle → ma journée change → je sais quoi faire » en premier. Cette boucle est testée automatiquement dans le navigateur.
3. **Règles de priorité explicites.** Le moteur trie les tâches dans un ordre stable et documenté : épingles, urgence de l'échéance (aujourd'hui ou demain, 3 jours, 7 jours, plus tard), importance, action qui débloque, priorité manuelle, date limite, créneau déjà accepté, date de création. Les créneaux déjà acceptés sont réessayés en premier : relancer sans fait nouveau ne déplace rien.
4. **« Heure inconnue ».** La préparation doit finir avant le jour J. Si le jour J est aujourd'hui, elle est placée tout de suite avec une alerte. Aucun créneau fictif n'est créé pour le contrôle.
5. **États dérivés plutôt qu'écrits.** Une échéance passée s'affiche « à renseigner » et un créneau passé non fait s'affiche « manqué », sans réécrire les données. Le passé reste passé.
6. **Annulation par lot avec détection de conflit** grâce à la version de chaque objet. Les modifications postérieures sans lien sont gardées. Si un objet du lot a été modifié depuis, le conflit est signalé.
7. **Import.** Par défaut, la donnée locale reste maîtresse. Une collision n'écrase rien sans coche explicite. Un objet supprimé ici ne ressuscite pas. Le fichier entier est validé avant toute écriture, puis écrit en une seule transaction.
8. **Reprise de contexte.** 12 propositions sourcées, à cocher (Réglages). Aucune n'est ajoutée sans accord. Les identifiants sont stables, donc reprendre deux fois ne crée pas de doublon.

## Vérifié dans cette session

- 49 tests unitaires et d'intégration (`npm test`) couvrent le moteur, les phrases du cahier des charges, les dialogues, la sécurité, l'IndexedDB (via fake-indexeddb), l'import en double, le fichier endommagé, la restauration, l'export privé, le journal, l'import .ics, les récurrences, le changement d'heure et le retour après 3 jours.
- 19 vérifications de bout en bout dans Chromium (`npm run e2e`), avec une horloge contrôlée, en émulation iPhone 13 et en bureau 1280 px. Elles couvrent : premier lancement, capture du TP puis du contrôle, question unique sur l'heure, validation du plan, débordement du TP et recalage en 3 pressions, rechargement, liste, cocher hors ligne, annuler depuis le toast, texte piégé, retour après 3 jours, reprise de contexte, ⌘K.

## Limites constatées (non vérifiées ou non livrées)

- **Pas de vrai iPhone ni de vrai Mac** ici : seulement une émulation Chromium. Le comportement de Safari iOS (installation, stockage durable, micro) reste à vérifier sur ton appareil.
- **Pas de synchronisation** Mac ↔ iPhone. Le transfert se fait par export et import, ce qui est indiqué dans les Réglages.
- **Voix** : la dictée du clavier fonctionne partout. Le bouton micro du navigateur n'apparaît que si l'API existe ; il est marqué expérimental et n'a pas été testé sur iPhone.
- **Assistant externe** : non branché, faute de serveur pour garder une clé privée. Aucun appel réseau n'est fait. La grammaire est prête pour lui.
- **Notifications** : pas de notification quand Max est fermé. On peut exporter les échéances en .ics avec alerte vers son agenda habituel.
- **Import .ics** : pris en charge pour les événements simples et les séries hebdomadaires (EXDATE, RECURRENCE-ID). Les autres récurrences sont signalées « à vérifier ».
- **Hébergement** : il faut ton accord avant toute mise en ligne (voir le README, section iPhone).

## Prochaines étapes proposées
1. Héberger en privé (par exemple Vercel avec protection par connexion) pour l'iPhone, après ton accord.
2. Synchronisation chiffrée entre les deux appareils, en suivant la règle de conflit par champ déjà prévue par les versions.
3. Assistant textuel facultatif derrière un petit serveur, avec un budget et des champs minimisés.
