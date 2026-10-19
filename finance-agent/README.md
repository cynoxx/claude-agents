# Agent financier et administratif

Application web qui suit vos factures, vous rappelle les échéances (J-7, J-3, jour J), contrôle votre budget
mensuel et affiche un tableau de bord de vos dépenses.

## Ce qui est livré

| Priorité | Fonctionnalité | État |
|---|---|---|
| 1 | Authentification (inscription, connexion, session de 30 min prolongée tant que vous êtes actif) | ✅ |
| 2 | CRUD des factures, filtres (statut, catégorie, dates), tri, recherche, historique des payées | ✅ |
| 3 | Calendrier des échéances avec code couleur (rouge en retard, orange ≤ 3 j, jaune ≤ 7 j, vert > 7 j) | ✅ |
| 4 | Notifications : rappels de factures, alertes de budget (80 % puis 100 %), dans l'app et par email | ✅ |
| 5 | Tableau de bord : à payer en priorité, dépenses par catégorie, évolution sur 6 mois, budget vs réel | ✅ |
| 6 | Scanner d'emails | Interface prête (`src/services/emailScanner.ts`), branchement à la boîte mail à venir |
| 7 | Documents administratifs | Modèle de données prêt, écrans à venir |
| 8 | Rapports budgétaires | Budget par catégorie livré, rapports détaillés à venir |

En plus de la spec :
- **Catégorisation automatique** d'après le fournisseur (EDF, Orange, Free, MAIF, Netflix…), modifiable dans
  `server/src/lib/categories.ts`.
- **Factures récurrentes** (mensuelle, trimestrielle, annuelle) : marquer une facture payée crée la suivante.
- Catégorie **Abonnements** (Netflix, Spotify…).
- Rappels **rattrapés** si le serveur était arrêté le jour prévu, et jamais envoyés deux fois.

## Démarrer

### Avec Docker

```bash
cd finance-agent
cp .env.example .env        # puis renseignez JWT_SECRET (et SMTP si vous voulez les emails)
docker compose up --build
```

L'application est sur http://localhost:8080. Les migrations sont appliquées au démarrage de l'API.

### En développement

Prérequis : Node 22 et un PostgreSQL 16.

```bash
# API
cd finance-agent/server
cp .env.example .env         # ajustez DATABASE_URL
npm install
npx prisma migrate deploy
npm run seed                 # facultatif : compte demo@example.com / demo12345
npm run dev                  # http://localhost:3000

# Interface (autre terminal)
cd finance-agent/web
npm install
npm run dev                  # http://localhost:5173, /api est relayé vers l'API
```

## Configuration

Variables de l'API (`server/.env`) :

| Variable | Rôle | Défaut |
|---|---|---|
| `DATABASE_URL` | Connexion PostgreSQL | |
| `JWT_SECRET` | Secret de signature des sessions | à définir |
| `TZ_NAME` | Fuseau pour calculer « aujourd'hui » | `Europe/Paris` |
| `SESSION_TIMEOUT_MINUTES` | Expiration après inactivité | `30` |
| `REMINDER_INTERVAL_MINUTES` | Fréquence du planificateur de rappels | `60` |
| `AUTH_RATE_LIMIT` | Tentatives de connexion par minute et par IP | `10` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Envoi des emails ; sans `SMTP_HOST` ils sont journalisés | |
| `CORS_ORIGIN` | Origines autorisées (séparées par des virgules) | `http://localhost:5173` |

Les réglages propres à chaque utilisateur (jours de rappel, seuil d'alerte budget, canaux email et in-app) se
changent dans l'écran **Paramètres**.

## Architecture

```
finance-agent/
├── server/                    API Fastify + Prisma + PostgreSQL
│   ├── prisma/schema.prisma   Modèles User, Bill, Budget, AdminDocument, Notification
│   ├── src/routes/            auth, bills, budget, notifications, dashboard, import
│   ├── src/services/          billService, budgetService, notificationService, emailScanner, mailer
│   ├── src/lib/               dates (calendrier), categories (fournisseurs → catégorie), config
│   └── tests/                 Vitest : unitaires + API contre une vraie base
├── web/                       React + Vite + Tailwind + React Query + Zustand (graphiques en barres fines faits maison)
│   └── src/components/        Dashboard, Bills (liste, formulaire, calendrier), Budget, Notifications, Settings
└── docker-compose.yml         Postgres + API + interface (nginx)
```

**Rappels.** `notificationService.planReminder` retient, pour chaque facture non payée, le plus petit seuil
déjà atteint parmi les jours configurés (7, 3, 0 par défaut), ou « en retard ». Chaque notification porte une clé
unique (`bill:<id>:<échéance>:<seuil>`) : le planificateur peut tourner aussi souvent que voulu sans doublon.
Il s'exécute au démarrage, toutes les heures, et après chaque modification de facture ou de budget.

**Dates.** Les échéances sont des dates sans heure (`@db.Date`) ; tous les calculs se font sur des chaînes
`AAAA-MM-JJ` dans le fuseau configuré, ce qui évite les décalages au changement d'heure.

## API

Toutes les routes sauf `/api/auth/register` et `/api/auth/login` exigent `Authorization: Bearer <jeton>`.

```
POST   /api/auth/register        { email, password, name? }
POST   /api/auth/login           { email, password }
POST   /api/auth/refresh         renouvelle le jeton
GET    /api/auth/me
PUT    /api/settings             { name?, billReminderDays?, budgetWarningThreshold?, notifyEmail?, notifyInApp? }

GET    /api/bills                ?status=all|paid|unpaid|overdue&category=&from=&to=&q=&sort=&order=
GET    /api/bills/:id
POST   /api/bills                { title, provider, amount, dueDate, category?, recurrence?, reference?, documentUrl?, notes?, paid? }
PUT    /api/bills/:id
DELETE /api/bills/:id
PATCH  /api/bills/:id/pay        { paidDate? } → { bill, next }

GET    /api/budget               ?year=&month= → budget vs réel par catégorie
POST   /api/budget               { category, limitAmount, month, year } (crée ou remplace)
PUT    /api/budget/:id           { limitAmount }
DELETE /api/budget/:id

GET    /api/notifications        ?unread=true&limit=
PATCH  /api/notifications/:id/read
PATCH  /api/notifications/read-all

GET    /api/dashboard
POST   /api/import/email         501 tant que le scanner n'est pas connecté
```

## Tests

```bash
cd server && npm test            # base de test : TEST_DATABASE_URL (défaut postgresql://finance:finance@localhost:5432/finance_test)
cd server && npm run test:coverage
cd web && npm test
```

La CI (`.github/workflows/finance-agent.yml`) lance le typage, les tests avec couverture et le build de l'interface.

## Sécurité

- Mots de passe hachés avec bcrypt (coût 12), limitation des tentatives de connexion.
- Sessions JWT de 30 minutes, renouvelées seulement si l'utilisateur est actif.
- En-têtes de sécurité (`@fastify/helmet`), CORS restreint, chaque requête filtrée par utilisateur.
- À venir : double authentification, chiffrement AES-256 des champs sensibles, export des données.
