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
  if (!postCols.some((c) => c.name === 'metricsSyncedAt')) {
    database.exec(`ALTER TABLE posts ADD COLUMN metricsSyncedAt TEXT`);
  }
  // Thème Marp des présentations (choix + CSS custom généré par l'IA)
  if (!userCols.some((c) => c.name === 'marpTheme')) {
    database.exec(`ALTER TABLE users ADD COLUMN marpTheme TEXT`);
  }
  if (!userCols.some((c) => c.name === 'marpCustomCss')) {
    database.exec(`ALTER TABLE users ADD COLUMN marpCustomCss TEXT`);
  }

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
}
