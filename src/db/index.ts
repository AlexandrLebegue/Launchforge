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
      recurrence  TEXT NOT NULL DEFAULT 'none',
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
}
