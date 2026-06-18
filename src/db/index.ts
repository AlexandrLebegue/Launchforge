/**
 * Database layer — better-sqlite3
 *
 * Why better-sqlite3 instead of sql.js:
 *   • sql.js loads the entire DB into RAM and flushes to disk manually
 *     (saveDb()) — crash between writes = data loss.
 *   • better-sqlite3 uses the real SQLite C library: every db.prepare().run()
 *     is atomically committed to the WAL file on disk immediately.
 *     No saveDb(), no in-memory risk, crash-safe.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns the singleton DB connection, creating it on first call.
 * Compatible with the old initEngine() + getDb() call pattern.
 */
export function getDb(): Database.Database {
  if (db) return db;

  const dbPath =
    process.env.DB_PATH ?? path.join(process.cwd(), 'data', 'launchforge.db');

  // Create parent directory if needed (e.g. /app/data inside Docker)
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);

  // WAL mode: readers never block writers, crash-safe atomic commits
  db.pragma('journal_mode = WAL');
  // Enforce FK constraints
  db.pragma('foreign_keys = ON');
  // Faster writes — OS crash could corrupt, but process crash is safe
  db.pragma('synchronous = NORMAL');

  runMigrations(db);

  console.log(`📦 Database: ${dbPath}`);
  return db;
}

/**
 * Kept for API compatibility with existing callers (routes, index.ts).
 * better-sqlite3 opens synchronously — no async init needed.
 */
export async function initEngine(): Promise<void> {
  getDb(); // open + migrate eagerly
}

/**
 * No-op — kept so existing storage.ts callers don't break.
 * better-sqlite3 writes atomically on every statement; no manual flush needed.
 */
export function saveDb(): void {}

/** Gracefully close the connection (useful in tests / process teardown). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function runMigrations(database: Database.Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id        TEXT PRIMARY KEY,
      email     TEXT UNIQUE NOT NULL,
      name      TEXT NOT NULL DEFAULT '',
      password  TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS plans (
      id                   TEXT PRIMARY KEY,
      userId               TEXT NOT NULL,
      input                TEXT NOT NULL,
      weekly_plan          TEXT NOT NULL DEFAULT '[]',
      community_targets    TEXT NOT NULL DEFAULT '[]',
      content_angles       TEXT NOT NULL DEFAULT '[]',
      outreach_strategy    TEXT NOT NULL DEFAULT '[]',
      launch_sequencing    TEXT NOT NULL DEFAULT '[]',
      validation_checklist TEXT NOT NULL DEFAULT '[]',
      first_users_tactics  TEXT NOT NULL DEFAULT '[]',
      kanban_state         TEXT NOT NULL DEFAULT '{}',
      createdAt            TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS feedback (
      id        TEXT PRIMARY KEY,
      planId    TEXT NOT NULL,
      userId    TEXT NOT NULL,
      rating    INTEGER NOT NULL,
      comment   TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (planId) REFERENCES plans(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);

  // Additive migration: add kanban_state column to existing DBs (idempotent)
  const cols = database.pragma('table_info(plans)') as { name: string }[];
  if (!cols.some((c) => c.name === 'kanban_state')) {
    database.exec(
      `ALTER TABLE plans ADD COLUMN kanban_state TEXT NOT NULL DEFAULT '{}'`
    );
  }
  // Projets : un plan actif par utilisateur
  if (!cols.some((c) => c.name === 'active')) {
    database.exec(`ALTER TABLE plans ADD COLUMN active INTEGER NOT NULL DEFAULT 0`);
  }


  // Agents tables (idempotent — safe to run on existing DBs)
  database.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id            TEXT PRIMARY KEY,
      userId        TEXT NOT NULL,
      name          TEXT NOT NULL,
      platform      TEXT NOT NULL,
      api_key       TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'inactive',
      approval_mode TEXT NOT NULL DEFAULT 'manual',
      lastRunAt     TEXT,
      createdAt     TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS onboarding_sessions (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      status    TEXT NOT NULL DEFAULT 'active',
      messages  TEXT NOT NULL DEFAULT '[]',
      profile   TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS agent_runs (
      id            TEXT PRIMARY KEY,
      agentId       TEXT NOT NULL,
      planId        TEXT NOT NULL,
      cardId        TEXT NOT NULL,
      cardTitle     TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'pending',
      result        TEXT,
      startedAt     TEXT NOT NULL,
      completedAt   TEXT,
      FOREIGN KEY (agentId) REFERENCES agents(id)
    );

    CREATE TABLE IF NOT EXISTS posts (
      id          TEXT PRIMARY KEY,
      userId      TEXT NOT NULL,
      platform    TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT '',
      content     TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'draft',
      scheduledAt TEXT,
      publishedAt TEXT,
      externalUrl TEXT,
      imageUrl    TEXT,
      recurrence  TEXT NOT NULL DEFAULT 'none',
      recurrenceBrief TEXT,
      impressions INTEGER NOT NULL DEFAULT 0,
      likes       INTEGER NOT NULL DEFAULT 0,
      comments    INTEGER NOT NULL DEFAULT 0,
      shares      INTEGER NOT NULL DEFAULT 0,
      clicks      INTEGER NOT NULL DEFAULT 0,
      createdAt   TEXT NOT NULL,
      updatedAt   TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS knowledge (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      category  TEXT NOT NULL DEFAULT 'other',
      title     TEXT NOT NULL,
      content   TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS contacts (
      id              TEXT PRIMARY KEY,
      userId          TEXT NOT NULL,
      name            TEXT NOT NULL,
      email           TEXT,
      company         TEXT,
      type            TEXT NOT NULL DEFAULT 'prospect',
      source          TEXT,
      interestScore   INTEGER,
      interestSummary TEXT,
      notes           TEXT,
      lastInteraction TEXT,
      createdAt       TEXT NOT NULL,
      updatedAt       TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS telegram_links (
      chatId    TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS reminders (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      text      TEXT NOT NULL,
      dueAt     TEXT NOT NULL,
      sent      INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);

  // Additive migration: pipeline de validation par agent (idempotent, pour
  // les bases créées avant l'ajout de la colonne)
  const agentCols = database.pragma('table_info(agents)') as { name: string }[];
  if (!agentCols.some((c) => c.name === 'approval_mode')) {
    database.exec(
      `ALTER TABLE agents ADD COLUMN approval_mode TEXT NOT NULL DEFAULT 'manual'`
    );
  }

  // Additive migration: URL externe des posts pour la synchro de métriques
  const postCols = database.pragma('table_info(posts)') as { name: string }[];
  if (!postCols.some((c) => c.name === 'externalUrl')) {
    database.exec(`ALTER TABLE posts ADD COLUMN externalUrl TEXT`);
  }
  // Additive migrations: publication automatique + synchro calendrier
  if (!postCols.some((c) => c.name === 'autoPublish')) {
    database.exec(`ALTER TABLE posts ADD COLUMN autoPublish INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postCols.some((c) => c.name === 'publishError')) {
    database.exec(`ALTER TABLE posts ADD COLUMN publishError TEXT`);
  }
  if (!postCols.some((c) => c.name === 'calendarSynced')) {
    database.exec(`ALTER TABLE posts ADD COLUMN calendarSynced INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postCols.some((c) => c.name === 'imageUrl')) {
    database.exec(`ALTER TABLE posts ADD COLUMN imageUrl TEXT`);
  }
  if (!postCols.some((c) => c.name === 'planId')) {
    database.exec(`ALTER TABLE posts ADD COLUMN planId TEXT`);
  }
  if (!postCols.some((c) => c.name === 'recurrenceBrief')) {
    database.exec(`ALTER TABLE posts ADD COLUMN recurrenceBrief TEXT`);
  }

  // ── Isolation par projet ───────────────────────────────────────────────────
  // Chaque projet (plan) a ses propres connaissances, contacts et agents.
  const knowledgeCols = database.pragma('table_info(knowledge)') as { name: string }[];
  if (!knowledgeCols.some((c) => c.name === 'planId')) {
    database.exec(`ALTER TABLE knowledge ADD COLUMN planId TEXT`);
  }
  const contactCols = database.pragma('table_info(contacts)') as { name: string }[];
  if (!contactCols.some((c) => c.name === 'planId')) {
    database.exec(`ALTER TABLE contacts ADD COLUMN planId TEXT`);
  }
  if (!agentCols.some((c) => c.name === 'planId')) {
    database.exec(`ALTER TABLE agents ADD COLUMN planId TEXT`);
  }

  // Backfill : les données créées avant l'isolation par projet sont rattachées
  // au projet actif (à défaut le plus récent) de leur utilisateur. Idempotent
  // (WHERE planId IS NULL) ; les utilisateurs sans aucun projet restent à NULL.
  for (const table of ['posts', 'knowledge', 'contacts', 'agents']) {
    database.exec(`
      UPDATE ${table} SET planId = (
        SELECT p.id FROM plans p WHERE p.userId = ${table}.userId
        ORDER BY p.active DESC, p.createdAt DESC LIMIT 1
      ) WHERE planId IS NULL
    `);
  }

  // Réparation : anciens posts LinkedIn auto-publiés dont externalUrl n'est
  // qu'un URN (le lien cliquable du Hub exige une URL http). On reconstruit
  // l'URL du feed à partir de l'URN. Idempotent (les valeurs déjà en https ne
  // matchent plus). Couvre la forme complète « urn:li:… » et la forme « li:… »
  // (préfixe urn: amputé par l'ancien extracteur).
  database.exec(`
    UPDATE posts
    SET externalUrl = 'https://www.linkedin.com/feed/update/' || externalUrl || '/'
    WHERE platform = 'linkedin' AND externalUrl LIKE 'urn:li:%'
  `);
  database.exec(`
    UPDATE posts
    SET externalUrl = 'https://www.linkedin.com/feed/update/urn:' || externalUrl || '/'
    WHERE platform = 'linkedin' AND externalUrl LIKE 'li:%'
  `);

  // ── Multi-utilisateur ──────────────────────────────────────────────────────
  // Identité Composio par utilisateur (entité user_id distincte sur le même
  // workspace) + bot Telegram personnel (token chiffré).
  const userCols = database.pragma('table_info(users)') as { name: string }[];
  if (!userCols.some((c) => c.name === 'composioUserId')) {
    database.exec(`ALTER TABLE users ADD COLUMN composioUserId TEXT`);
  }
  if (!userCols.some((c) => c.name === 'telegramBotToken')) {
    database.exec(`ALTER TABLE users ADD COLUMN telegramBotToken TEXT`);
  }
  if (!userCols.some((c) => c.name === 'telegramBotName')) {
    database.exec(`ALTER TABLE users ADD COLUMN telegramBotName TEXT`);
  }
  // Synchro automatique des métriques : intervalle par utilisateur (minutes,
  // 0 = désactivée) + horodatage de dernière synchro par post
  if (!userCols.some((c) => c.name === 'metricsSyncMinutes')) {
    database.exec(`ALTER TABLE users ADD COLUMN metricsSyncMinutes INTEGER NOT NULL DEFAULT 0`);
  }
  // Mise à jour automatique de la base de connaissances : intervalle par
  // utilisateur (minutes, 0 = désactivée). L'horodatage de dernière synchro
  // est porté par chaque source (knowledge_sources.lastSyncedAt).
  if (!userCols.some((c) => c.name === 'knowledgeSyncMinutes')) {
    database.exec(`ALTER TABLE users ADD COLUMN knowledgeSyncMinutes INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postCols.some((c) => c.name === 'metricsSyncedAt')) {
    database.exec(`ALTER TABLE posts ADD COLUMN metricsSyncedAt TEXT`);
  }
  // Posts récurrents : filiation des occurrences (seriesId = post d'origine)
  // + réglages IA de régénération par série
  if (!postCols.some((c) => c.name === 'seriesId')) {
    database.exec(`ALTER TABLE posts ADD COLUMN seriesId TEXT`);
  }
  if (!postCols.some((c) => c.name === 'recurrenceUseNews')) {
    database.exec(`ALTER TABLE posts ADD COLUMN recurrenceUseNews INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postCols.some((c) => c.name === 'recurrenceUseKnowledge')) {
    database.exec(`ALTER TABLE posts ADD COLUMN recurrenceUseKnowledge INTEGER NOT NULL DEFAULT 1`);
  }
  if (!postCols.some((c) => c.name === 'recurrenceUpdateKb')) {
    database.exec(`ALTER TABLE posts ADD COLUMN recurrenceUpdateKb INTEGER NOT NULL DEFAULT 0`);
  }
  // Multi-plateformes : les exemplaires d'un même contenu publiés sur
  // plusieurs plateformes partagent un crossPostId (groupe de cross-posts)
  if (!postCols.some((c) => c.name === 'crossPostId')) {
    database.exec(`ALTER TABLE posts ADD COLUMN crossPostId TEXT`);
  }
  // Reddit : subreddit cible du post (sans le préfixe « r/ »)
  if (!postCols.some((c) => c.name === 'subreddit')) {
    database.exec(`ALTER TABLE posts ADD COLUMN subreddit TEXT`);
  }
  // Réinitialisation de mot de passe (jeton haché + expiration)
  if (!userCols.some((c) => c.name === 'resetTokenHash')) {
    database.exec(`ALTER TABLE users ADD COLUMN resetTokenHash TEXT`);
  }
  if (!userCols.some((c) => c.name === 'resetTokenExpiresAt')) {
    database.exec(`ALTER TABLE users ADD COLUMN resetTokenExpiresAt TEXT`);
  }
  // Thème Marp des présentations (choix + CSS custom généré par l'IA)
  if (!userCols.some((c) => c.name === 'marpTheme')) {
    database.exec(`ALTER TABLE users ADD COLUMN marpTheme TEXT`);
  }
  if (!userCols.some((c) => c.name === 'marpCustomCss')) {
    database.exec(`ALTER TABLE users ADD COLUMN marpCustomCss TEXT`);
  }
  // Rapport de campagne hebdomadaire (Telegram, le lundi)
  if (!userCols.some((c) => c.name === 'lastWeeklyReportAt')) {
    database.exec(`ALTER TABLE users ADD COLUMN lastWeeklyReportAt TEXT`);
  }
  // Authentification OAuth (Google & co). `authProvider` = 'local' (email +
  // mot de passe) ou un fournisseur ('google'…). `providerId` = identifiant
  // stable du compte chez le fournisseur (claim `sub` pour Google). Les comptes
  // OAuth ont un `password` vide : verifyPassword n'est jamais appelé pour eux.
  if (!userCols.some((c) => c.name === 'authProvider')) {
    database.exec(`ALTER TABLE users ADD COLUMN authProvider TEXT NOT NULL DEFAULT 'local'`);
  }
  if (!userCols.some((c) => c.name === 'providerId')) {
    database.exec(`ALTER TABLE users ADD COLUMN providerId TEXT`);
  }
  // Tutoriel d'accueil : 1 à la création du compte, consommé (remis à 0) une
  // fois le tutoriel lancé — après le 1er projet. Lié au compte (et non au
  // navigateur), il ne se redéclenche donc pas aux connexions suivantes
  // (Google incluse). Les comptes existants restent à 0 → jamais redéclenché.
  if (!userCols.some((c) => c.name === 'tutorialPending')) {
    database.exec(`ALTER TABLE users ADD COLUMN tutorialPending INTEGER NOT NULL DEFAULT 0`);
  }

  // Historique des métriques : un instantané par synchro — alimente les
  // courbes temporelles de la vue Performances
  database.exec(`
    CREATE TABLE IF NOT EXISTS metric_history (
      id          TEXT PRIMARY KEY,
      postId      TEXT NOT NULL,
      userId      TEXT NOT NULL,
      planId      TEXT,
      at          TEXT NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      likes       INTEGER NOT NULL DEFAULT 0,
      comments    INTEGER NOT NULL DEFAULT 0,
      shares      INTEGER NOT NULL DEFAULT 0,
      clicks      INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_metric_history_plan ON metric_history(userId, planId, at);
    CREATE INDEX IF NOT EXISTS idx_metric_history_post ON metric_history(postId, at);
  `);

  // Commentaires récupérés sur les posts publiés (contenu réel, pas qu'un
  // compteur) — alimente la carte « Commentaires » de la vue Performances.
  // Le UNIQUE(postId, externalId) rend les re-synchros idempotentes.
  database.exec(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id          TEXT PRIMARY KEY,
      postId      TEXT NOT NULL,
      userId      TEXT NOT NULL,
      planId      TEXT,
      platform    TEXT NOT NULL,
      externalId  TEXT,
      author      TEXT,
      text        TEXT NOT NULL,
      likeCount   INTEGER NOT NULL DEFAULT 0,
      commentedAt TEXT,
      fetchedAt   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_post_comments_plan ON post_comments(userId, planId);
    CREATE INDEX IF NOT EXISTS idx_post_comments_post ON post_comments(postId);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_post_comments_dedup ON post_comments(postId, externalId);
  `);

  // Présentations Marp générées par l'IA
  database.exec(`
    CREATE TABLE IF NOT EXISTS decks (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      planId    TEXT,
      title     TEXT NOT NULL,
      markdown  TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_decks_user_plan ON decks(userId, planId);
  `);

  // Rapports de campagne IA archivés (historique des analyses)
  database.exec(`
    CREATE TABLE IF NOT EXISTS campaign_reports (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      planId    TEXT,
      report    TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_campaign_reports_user_plan ON campaign_reports(userId, planId, createdAt);
  `);

  // ── Équipes (collaboration multi-utilisateur sur un projet) ────────────────
  // Une équipe possède des projets (plans.teamId) ; ses membres y accèdent
  // selon leur rôle (owner/editor/viewer). Les invitations se font par code.
  database.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL,
      ownerId   TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (ownerId) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS team_members (
      teamId    TEXT NOT NULL,
      userId    TEXT NOT NULL,
      role      TEXT NOT NULL DEFAULT 'editor',
      createdAt TEXT NOT NULL,
      PRIMARY KEY (teamId, userId),
      FOREIGN KEY (teamId) REFERENCES teams(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS team_invites (
      id        TEXT PRIMARY KEY,
      teamId    TEXT NOT NULL,
      code      TEXT UNIQUE NOT NULL,
      role      TEXT NOT NULL DEFAULT 'editor',
      createdAt TEXT NOT NULL,
      expiresAt TEXT,
      FOREIGN KEY (teamId) REFERENCES teams(id)
    );
    CREATE INDEX IF NOT EXISTS idx_team_members_user ON team_members(userId);
    CREATE INDEX IF NOT EXISTS idx_team_invites_team ON team_invites(teamId);
  `);
  // Un projet peut appartenir à une équipe (null = projet personnel, comme avant)
  const plansInfo = database.pragma('table_info(plans)') as { name: string }[];
  if (!plansInfo.some((c) => c.name === 'teamId')) {
    database.exec(`ALTER TABLE plans ADD COLUMN teamId TEXT`);
  }
  // Projet actif PAR UTILISATEUR (l'ancien drapeau plans.active ne gérait pas
  // les projets d'équipe possédés par quelqu'un d'autre). Backfill depuis l'ancien.
  if (!userCols.some((c) => c.name === 'activePlanId')) {
    database.exec(`ALTER TABLE users ADD COLUMN activePlanId TEXT`);
    database.exec(
      `UPDATE users SET activePlanId =
         (SELECT p.id FROM plans p WHERE p.userId = users.id AND p.active = 1 LIMIT 1)
       WHERE activePlanId IS NULL`
    );
  }

  // ── Mise à jour automatique de la base de connaissances ────────────────────
  // Sources déclarées par projet (dépôt GitHub, site/page web) que l'IA analyse
  // pour proposer des fiches. Clé sur userId = propriétaire (comme knowledge).
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_sources (
      id           TEXT PRIMARY KEY,
      userId       TEXT NOT NULL,
      planId       TEXT,
      type         TEXT NOT NULL DEFAULT 'website',
      url          TEXT NOT NULL,
      label        TEXT NOT NULL DEFAULT '',
      lastSyncedAt TEXT,
      createdAt    TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_sources_user_plan ON knowledge_sources(userId, planId);
  `);

  // Index pour les requêtes scopées par projet (idempotent)
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_plans_user        ON plans(userId, active);
    CREATE INDEX IF NOT EXISTS idx_posts_user_plan   ON posts(userId, planId, status);
    CREATE INDEX IF NOT EXISTS idx_knowledge_user_plan ON knowledge(userId, planId);
    CREATE INDEX IF NOT EXISTS idx_contacts_user_plan  ON contacts(userId, planId);
    CREATE INDEX IF NOT EXISTS idx_agents_user_plan    ON agents(userId, planId);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_agent    ON agent_runs(agentId, status);
    CREATE INDEX IF NOT EXISTS idx_agent_runs_plan     ON agent_runs(planId, status);
  `);

  // ── Journal d'audit fondateur ──────────────────────────────────────────────
  // Trace les actions clés de tous les utilisateurs (inscriptions, publications,
  // créations de projets…). Lecture seule depuis le panneau d'administration.
  database.exec(`
    CREATE TABLE IF NOT EXISTS admin_events (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      action    TEXT NOT NULL,
      target    TEXT,
      metadata  TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_events_time   ON admin_events(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_events_user   ON admin_events(userId, createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_admin_events_action ON admin_events(action, createdAt DESC);
  `);

  // ── Historique des conversations avec l'assistant ──────────────────────────
  // Chaque conversation de la vue 💬 Assistant est persistée (un enregistrement
  // par fil, messages stockés en blob JSON — même schéma que onboarding_sessions).
  // Rétention : purge automatique des conversations inactives depuis plus d'un
  // mois (cf. conversationCleanup.ts), d'où l'index sur updatedAt.
  database.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      planId    TEXT,
      title     TEXT NOT NULL DEFAULT '',
      messages  TEXT NOT NULL DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_user   ON conversations(userId, updatedAt DESC);
    CREATE INDEX IF NOT EXISTS idx_conversations_expiry ON conversations(updatedAt);
  `);

  // ── Abonnement & facturation (offres « Braise » gratuite / « Brasier » payante) ─
  // Modèle freemium : tout compte démarre par un essai « reverse trial » de 15
  // jours en accès complet (trialEndsAt), puis retombe sur l'offre Braise
  // (limitée) tant qu'aucun abonnement Brasier (Stripe) n'est actif.
  //   subscriptionStatus : 'none' | 'trialing' | 'active' | 'past_due' | 'canceled'
  //     (le statut Stripe ; 'none' = jamais abonné. L'accès complet vient soit
  //     d'un abonnement actif, soit de l'essai non expiré — cf. entitlements.ts)
  if (!userCols.some((c) => c.name === 'subscriptionStatus')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscriptionStatus TEXT NOT NULL DEFAULT 'none'`);
  }
  if (!userCols.some((c) => c.name === 'stripeCustomerId')) {
    database.exec(`ALTER TABLE users ADD COLUMN stripeCustomerId TEXT`);
  }
  if (!userCols.some((c) => c.name === 'stripeSubscriptionId')) {
    database.exec(`ALTER TABLE users ADD COLUMN stripeSubscriptionId TEXT`);
  }
  // 'month' | 'year' — sert à l'affichage et n'est pas la source de vérité du prix
  if (!userCols.some((c) => c.name === 'subscriptionInterval')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscriptionInterval TEXT`);
  }
  // Fin de la période payée en cours (ISO) — accès maintenu jusque-là même après
  // résiliation programmée (cancel_at_period_end)
  if (!userCols.some((c) => c.name === 'subscriptionCurrentPeriodEnd')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscriptionCurrentPeriodEnd TEXT`);
  }
  // Date de résiliation programmée (ISO) — null si l'abonnement se renouvelle
  if (!userCols.some((c) => c.name === 'subscriptionCancelAt')) {
    database.exec(`ALTER TABLE users ADD COLUMN subscriptionCancelAt TEXT`);
  }
  // Fin de l'essai « reverse trial » (ISO) — accès complet tant que > maintenant
  if (!userCols.some((c) => c.name === 'trialEndsAt')) {
    database.exec(`ALTER TABLE users ADD COLUMN trialEndsAt TEXT`);
  }
  // Date du 1er paiement (ISO) — fenêtre de la garantie 14 jours satisfait/remboursé
  if (!userCols.some((c) => c.name === 'firstPaidAt')) {
    database.exec(`ALTER TABLE users ADD COLUMN firstPaidAt TEXT`);
    // Backfill : les comptes existants (bêta) reçoivent une période de grâce de
    // 30 jours en accès complet à partir de la migration — honore la promesse
    // « les premiers utilisateurs seront prévenus avant tout changement ».
    // WHERE trialEndsAt IS NULL : posé une seule fois (les boots suivants sautent).
    // strftime …'Z' : ISO 8601 UTC explicite — sinon datetime() renvoie
    // 'YYYY-MM-DD HH:MM:SS' (sans fuseau), que `new Date()` lit en heure LOCALE,
    // décalant l'expiration de l'essai du décalage horaire du serveur.
    database.exec(`UPDATE users SET trialEndsAt = strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+30 days') WHERE trialEndsAt IS NULL`);
  }

  // Compteurs d'usage mensuel des ressources IA (coût variable principal) —
  // bornent l'offre Braise. Un événement par génération ; comptage par mois
  // calendaire (month = 'YYYY-MM'). kind : 'ai_generation' | 'ai_image'.
  database.exec(`
    CREATE TABLE IF NOT EXISTS usage_events (
      id        TEXT PRIMARY KEY,
      userId    TEXT NOT NULL,
      kind      TEXT NOT NULL,
      month     TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_events_count ON usage_events(userId, kind, month);
  `);
}
