# 🔥 LaunchForge

> **Le hub de promotion de votre startup, forgé par l'IA.**

LaunchForge construit votre plan de lancement, rédige et publie votre contenu
(posts, visuels, présentations), suit vos métriques, détecte vos prospects les
plus chauds — et se pilote depuis l'app web ou Telegram.

**Ce que ça fait, concrètement :**

- 🤖 **Onboarding par IA** — un chat vous interviewe, recherche votre entreprise sur le web et génère un plan de lancement tactique semaine par semaine.
- 📣 **Hub de contenu** — calendrier éditorial généré par l'IA, éditeur de posts avec assistant, images IA, présentations (slides) transformables en GIF/MP4.
- 🔁 **Séries récurrentes** — un post peut se republier tout seul (quotidien → mensuel), réécrit à chaque fois par l'IA avec un sujet différent, sans jamais se répéter.
- 🗓️ **Calendrier** — vue mensuelle de votre planning, synchronisable avec Google Calendar.
- 📈 **Performances** — métriques synchronisées automatiquement depuis vos comptes, graphiques d'évolution, analyse IA de chaque post, rapport de campagne hebdomadaire sur Telegram.
- 🎯 **Leads** — l'IA lit les commentaires de vos posts et votre boîte mail, repère les personnes intéressées et les score de 0 à 100.
- 💬 **Assistant** — un chat (dans l'app et/ou sur Telegram) qui sait tout faire : rédiger, publier, analyser, configurer les séries, enrichir la base de connaissances.
- 📚 **Base de connaissances** — vous décrivez votre entreprise une fois ; toutes les générations IA s'en servent (et l'enrichissent avec les enseignements de vos résultats).

---

## 🚀 Installation (5 minutes)

### Prérequis

| Outil | Version | Vérifier |
|---|---|---|
| [Node.js](https://nodejs.org) | **20 ou plus** | `node --version` |
| Git | n'importe laquelle | `git --version` |
| ffmpeg *(optionnel)* | — | uniquement pour l'export **MP4** des présentations (le GIF marche sans) |

### Étapes

```bash
# 1. Récupérer le code
git clone https://github.com/AlexandrLebegue/Launchforge.git
cd Launchforge

# 2. Installer les dépendances (serveur puis interface)
npm install
cd client && npm install && cd ..

# 3. Créer votre fichier de configuration
cp .env.example .env
```

Ouvrez ensuite le fichier **`.env`** dans un éditeur de texte et remplissez-le
(voir section suivante) — au minimum `JWT_SECRET` et, pour avoir l'IA,
`OPENROUTER_API_KEY`.

### Lancer l'application

**Option A — la plus simple (un seul terminal) :**

```bash
cd client && npm run build && cd ..   # construit l'interface (1 fois, ou après une mise à jour)
npm run build && npm start            # démarre tout sur http://localhost:3000
```

Ouvrez **http://localhost:3000**, créez votre compte, et laissez-vous guider
par l'onboarding. C'est tout. 🎉

**Option B — mode développement (rechargement à chaud, 2 terminaux) :**

```bash
# Terminal 1 — le serveur (API)
npm run dev

# Terminal 2 — l'interface
cd client && npm run dev
```

Puis ouvrez **http://localhost:5173**.

---

## ⚙️ Configuration (`.env`)

| Variable | Obligatoire ? | À quoi ça sert / où l'obtenir |
|---|---|---|
| `JWT_SECRET` | ✅ Oui | Sécurise les sessions. Générez-le avec `openssl rand -hex 32` (ou tapez une longue phrase aléatoire). |
| `OPENROUTER_API_KEY` | 🔶 Fortement recommandé | **Toute l'IA** (onboarding, rédaction, analyses, images). Clé à créer sur [openrouter.ai/keys](https://openrouter.ai/keys) — vous ne payez que ce que vous consommez (quelques centimes). |
| `OPENROUTER_MODEL` | Non | Modèle de texte (défaut : routage automatique). Ex. `deepseek/deepseek-chat` (très économique). |
| `COMPOSIO_MCP_URL` + `COMPOSIO_API_KEY` | Non | **Publication réelle** sur vos réseaux (LinkedIn, X, Instagram…), synchro des métriques, Gmail, Google Calendar. Compte sur [composio.dev](https://composio.dev) → créez un serveur MCP, copiez son URL et votre clé API. Sans : vous copiez-collez vos posts à la main. |
| `TELEGRAM_BOT_TOKEN` | Non | Pilotage par chat Telegram. Créez un bot en 30 s avec [@BotFather](https://t.me/BotFather) et collez le token. (Chaque utilisateur peut aussi brancher *son* bot dans la vue Configuration.) |
| `APP_URL` | En production | L'adresse publique du site (ex. `https://monsite.fr`) — sert aux liens des emails de réinitialisation de mot de passe. |
| `PORT`, `DB_PATH` | Non | Port du serveur (3000) et emplacement de la base SQLite (`./data/launchforge.db`). |

**Sans aucune clé**, l'app fonctionne quand même : plans en mode modèle,
posts rédigés à la main, métriques saisies manuellement. Chaque clé ajoutée
débloque son lot de super-pouvoirs — la vue **⚙️ Configuration** dans l'app
montre en temps réel ce qui est actif et ce qui manque.

---

## 🔌 Connecter ses comptes (après le premier lancement)

Tout se passe dans l'app, vue **⚙️ Configuration** :

1. **Réseaux sociaux & Google** (si Composio est configuré) : cliquez
   « 🔗 Connecter » sur LinkedIn, Gmail, Google Calendar… autorisez dans
   l'onglet qui s'ouvre — le statut passe à « Fonctionnel » tout seul.
   Le bouton « ✕ Déconnecter » permet de re-autoriser proprement si une
   plateforme change ses droits.
2. **Telegram** : liez votre compte avec le code généré, ou collez le token
   de votre propre bot @BotFather pour avoir un bot personnel.
3. **Synchro des métriques** : choisissez la fréquence de relevé automatique
   (ou laissez désactivé).
4. **Thème des présentations** : choisissez un thème, ou décrivez le vôtre et
   l'IA fabrique le CSS.

> 💡 **Multi-utilisateur** : chaque compte LaunchForge a son espace étanche et
> SES connexions — vous pouvez héberger l'app pour plusieurs personnes.

---

## 💾 Vos données

- Tout vit dans le dossier **`data/`** : une base SQLite (`launchforge.db`)
  + les médias générés (`data/uploads/`, purgés après 90 jours).
- **Sauvegarder = copier ce dossier.** Pour une sauvegarde propre pendant que
  l'app tourne : `sqlite3 data/launchforge.db ".backup data/backup.db"`.
- Aucun cookie tiers, mots de passe hachés (bcrypt), jetons chiffrés au repos.

---

## 🧪 Tests & scripts utiles

```bash
npm test            # la suite complète (150 tests)
npm run lint        # vérification TypeScript
npm run dev         # serveur en mode développement
npm run build       # compile le serveur dans dist/
npm start           # lance le serveur compilé (sert aussi l'interface buildée)
```

---

## 🌍 Mettre en ligne (résumé)

Un petit VPS suffit (l'app tient dans un seul process Node) :

1. Mêmes étapes d'installation que ci-dessus, builds compris.
2. Dans `.env` : un `JWT_SECRET` fort, `APP_URL=https://votre-domaine.fr`.
3. Un reverse proxy avec HTTPS automatique, par ex. [Caddy](https://caddyserver.com) :
   `votre-domaine.fr { reverse_proxy localhost:3000 }`.
4. Un service systemd (ou `pm2`) pour relancer `npm start` au démarrage.
5. Une sauvegarde quotidienne de `data/` (cron + `.backup`).
6. Complétez les champs ⟦entre crochets⟧ des pages `/legal` et `/privacy`
   (hébergeur, forme juridique).

---

## 🛠 Stack technique

| Couche | Technologie |
|---|---|
| Serveur | **Node.js 20+ · TypeScript strict · Express 4** |
| Base de données | **SQLite** (better-sqlite3, zéro configuration) |
| Interface | **React 18 · Vite · Recharts** |
| IA | **OpenRouter** (texte : au choix ; images : seedream) |
| Intégrations | **Composio MCP** (réseaux sociaux, Gmail, Calendar) · **Telegram Bot API** |
| Présentations | **Marp** (HTML/PDF) · GIF/MP4 maison (sharp + gifenc + ffmpeg) |
| Tests | **Vitest + Supertest** — 150 tests |

---

## 📄 Licence

MIT — faites-en bon usage. 🔥
