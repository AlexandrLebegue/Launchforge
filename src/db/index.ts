import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import path from 'path';
import fs from 'fs';

let db: SqlJsDatabase | null = null;
let dbPath: string | null = null;
let SQL: Awaited<ReturnType<typeof initSqlJs>> | null = null;

export async function initEngine(): Promise<void> {
  if (!SQL) {
    SQL = await initSqlJs();
  }
}

export function getDb(dbFile?: string): SqlJsDatabase {
  if (db) return db;

  dbPath = dbFile || process.env.DB_PATH || path.join(process.cwd(), 'data', 'launchforge.db');

  if (!SQL) {
    throw new Error('SQL.js engine not initialized. Call await initEngine() first.');
  }

  if (dbPath === ':memory:') {
    db = new SQL.Database();
  } else {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      db = new SQL.Database(buffer);
    } else {
      db = new SQL.Database();
    }
  }

  runMigrations(db);
  return db;
}

export function saveDb(): void {
  if (!db || !dbPath || dbPath === ':memory:') return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

function runMigrations(database: SqlJsDatabase): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      password TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      input TEXT NOT NULL,
      weekly_plan TEXT NOT NULL,
      community_targets TEXT NOT NULL,
      content_angles TEXT NOT NULL,
      outreach_strategy TEXT NOT NULL,
      launch_sequencing TEXT NOT NULL,
      validation_checklist TEXT NOT NULL,
      first_users_tactics TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);
  database.run(`
    CREATE TABLE IF NOT EXISTS feedback (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      userId TEXT NOT NULL,
      rating INTEGER NOT NULL,
      comment TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (planId) REFERENCES plans(id),
      FOREIGN KEY (userId) REFERENCES users(id)
    );
  `);
  saveDb();
}

export function closeDb(): void {
  if (db) {
    saveDb();
    db.close();
    db = null;
  }
}
