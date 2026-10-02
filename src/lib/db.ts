import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS dreams (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  dream_date TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',
  analysis_status TEXT NOT NULL DEFAULT 'none',
  analysis_error TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '',
  analyzed_at TEXT,
  model TEXT NOT NULL DEFAULT ''
);
`;

/**
 * Forward-only schema migrations keyed by PRAGMA user_version. Each entry runs
 * at most once per database; databases created before versioning start at 0
 * and are stamped as they pass through.
 */
const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: SCHEMA },
];

const loggedPaths = new Set<string>();

function userVersion(db: DatabaseSync): number {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version);
}

/**
 * Open (creating if needed) the SQLite database at dbPath and run migrations.
 * Rows still marked `running` belong to a crashed process — the single-user
 * app cannot have a second live analysis, so they are failed on startup.
 */
export function openDatabase(dbPath: string): DatabaseSync {
  const isFile = dbPath !== ":memory:";
  if (isFile) {
    const abs = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    // First open of a path: record where data actually lives (suppressed in
    // tests, where dozens of throwaway paths would flood the output).
    if (!process.env.VITEST && !loggedPaths.has(abs)) {
      loggedPaths.add(abs);
      console.info(`[DreamBUDDY] database: ${abs}`);
    }
  }

  const db = new DatabaseSync(dbPath, { timeout: 5000 });
  if (isFile) {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");
  }

  const version = userVersion(db);
  for (const migration of MIGRATIONS) {
    if (version < migration.version) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version};`);
    }
  }

  db.exec(
    `UPDATE dreams
        SET analysis_status = 'failed',
            analysis_error = 'Analysis was interrupted — please retry.'
      WHERE analysis_status = 'running';`,
  );
  return db;
}
