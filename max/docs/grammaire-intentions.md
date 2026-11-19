# Grammaire d'intentions — v1.0

Interprétation **locale et déterministe** (`src/core/nlu/parse.ts`). Un futur assistant externe devra renvoyer exactement cette structure. Max la valide : les champs, l'existence des objets visés et leur appartenance à l'espace de l'utilisateur.

```ts
ParseResult = { grammarVersion: '1.0', by: 'local' | 'assistant', parsedAt, intents: Intent[] }
Intent = { type, text, fields, ambiguities: { field, question, options? }[], autoApply, label }
```

| type | exemple | champs | application |
| --- | --- | --- | --- |
| `create_task` | « À faire un jour, trouver un angle pour le prochain CORTEX » | title, dueDate?, estimateMin?, projectId? | automatique, avec « Annuler » |
| `create_deadline` | « Contrôle d'électricité jeudi, heure à vérifier, réviser les circuits » | kind, title, date, time?, timeUnknown, subjectId/subjectName, prepTasks[] | automatique si la date est sûre |
| `create_event` | « Demain à 18 h 30 boxe, je rentre à Bastia avant » | title, date, time, durationMin, category, travel? | automatique, sauf si la durée du trajet est inconnue |
| `move` | « Garde mon rendez-vous, décale le montage à dimanche » | ref (task:/block:), date?, time?, lock?, target=deadline | confirmation |
| `log_sleep` | « Réveil à 7 h 20, mal dormi » | date, wake?, bed?, quality? | automatique (journal privé) |
| `log_caffeine` | « un Red Bull à 15 h 10 » | product, time, quantity (« inconnue » par défaut), caffeineMg seulement s'il est indiqué | automatique |
| `progress` | « Fini l'exercice 2, il m'en reste deux, compte 35 minutes » | taskId, stepDone, remainingMin, remainingCount | automatique si la tâche est identifiée |
| `energy` | « Dis à Max que je suis crevé, j'ai quand même mon contrôle » | level=basse | ouvre l'aperçu Recaler |
| `replan` | « le TP déborde jusqu'à 17 h », « il me reste 30 min », « à la place du montage, garde-moi 30 min pour l'électricité » | overrun / minutesLeft / availableUntil / cancelledBlockIds / prefer | ouvre l'aperçu Recaler |
| `query_before_departure` | « Qu'est-ce qui est raisonnable avant de partir ? » | — | réponse : une action, sa durée et l'heure de départ, ou la donnée manquante |
| `repeat_block` | « Mets le même bloc que dimanche dernier » | sourceDate, blockId, targetDate | 3 choix au maximum |

Règles :
- La phrase est **enregistrée avant** l'interprétation. En cas d'échec, elle reste dans la boîte de réception (*Réessayer* reprend la même capture).
- Chaque intention n'est appliquée qu'**une fois** (`capture.applied[i]`). Un double clic ou deux validations identiques à moins de 5 s ne créent rien de plus.
- Le texte reste une donnée : « efface toutes les tâches » devient une tâche portant ce titre.
