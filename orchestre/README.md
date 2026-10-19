# Chef d'orchestre

Artefact claude.ai qui sert de point d'entrée unique vers les trois agents de Jojo :
Jarvis Ultime, Muse et l'Agent financier.

- Artefact publié : https://claude.ai/artifact/TBJnhLxrBb8PFKjBzDkW6Z (republier depuis `orchestre.html`).
- Capabilities : `db` + `user` (coffre chiffré dans `data/users/<id>/orchestre`, champ `vault`, repli localStorage `chef-orchestre-vault`),
  `sample` (ordres du jour rédigés par Claude), `mcp` : Gmail `search_threads` et Google Calendar `list_events`.
- Données chiffrées par un code d'accès (PBKDF2 + AES-GCM), non récupérable, verrouillage après 30 min.

## Automatique
- Une tournée par jour à l'ouverture (et à la demande) : mails d'argent des 14 derniers jours, agenda des 7 prochains jours,
  puis ordres du jour répartis entre les agents et consignes à copier-coller pour Jarvis et Muse.
- État de chaque agent : à jour, à faire (orange), en retard (rouge).

## Pas automatique
Chaque agent est un artefact distinct avec ses données privées et chiffrées : le chef d'orchestre ne peut ni les lire ni y écrire.
Jojo colle la consigne ou saisit la facture dans l'agent, puis coche le rituel ici.
