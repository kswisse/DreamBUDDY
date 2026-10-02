import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@/lib/db";

let dir: string;
const openHandles: DatabaseSync[] = [];

function open(p: string): DatabaseSync {
  const db = openDatabase(p);
  openHandles.push(db);
  return db;
}

function pragma(db: DatabaseSync, name: string): Record<string, unknown> {
  return db.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-db-"));
});

afterEach(() => {
  while (openHandles.length > 0) {
    try {
      openHandles.pop()!.close();
    } catch {
      // already closed
    }
  }
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("openDatabase logging", () => {
  it("logs the absolute database path exactly once per path", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    const saved = process.env.VITEST;
    delete process.env.VITEST;
    try {
      const p = path.join(dir, "logged.db");
      open(p);
      open(p);

      const logged = spy.mock.calls
        .flat()
        .map(String)
        .filter((line) => line.includes("database"));
      expect(logged).toHaveLength(1);
      expect(logged[0]).toContain(path.resolve(p));
    } finally {
      if (saved !== undefined) process.env.VITEST = saved;
    }
  });

  it("does not log when running under vitest", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    open(path.join(dir, "quiet.db"));
    expect(
      spy.mock.calls.flat().map(String).filter((line) => line.includes("database")),
    ).toEqual([]);
  });
});

describe("openDatabase pragmas", () => {
  it("enables WAL journal mode for file databases", () => {
    const db = open(path.join(dir, "wal.db"));
    expect(String(pragma(db, "journal_mode").journal_mode).toLowerCase()).toBe("wal");
  });

  it("sets a 5000ms busy timeout", () => {
    const db = open(path.join(dir, "timeout.db"));
    expect(Number(pragma(db, "busy_timeout").timeout)).toBe(5000);
  });

  it("sets synchronous to NORMAL", () => {
    const db = open(path.join(dir, "sync.db"));
    expect(Number(pragma(db, "synchronous").synchronous)).toBe(1);
  });

  it("stamps schema user_version", () => {
    const db = open(path.join(dir, "version.db"));
    expect(Number(pragma(db, "user_version").user_version)).toBeGreaterThanOrEqual(1);
  });

  it("supports :memory: databases", () => {
    const db = open(":memory:");
    db.exec("CREATE TABLE t (x INTEGER)");
    db.prepare("INSERT INTO t (x) VALUES (?)").run(1);
    expect(Number((db.prepare("SELECT x FROM t").get() as { x: number }).x)).toBe(1);
  });
});

describe("openDatabase migrations", () => {
  it("migrates a legacy v0 database without losing rows", () => {
    const p = path.join(dir, "legacy.db");
    const legacy = new DatabaseSync(p);
    legacy.exec(`
      CREATE TABLE dreams (
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
    `);
    legacy
      .prepare(
        "INSERT INTO dreams (id, created_at, dream_date, content) VALUES (?, ?, ?, ?)",
      )
      .run("legacy-1", "2026-01-01T00:00:00.000Z", "2026-01-01", "old dream");
    legacy.close();

    const db = open(p);
    const row = db
      .prepare("SELECT content FROM dreams WHERE id = ?")
      .get("legacy-1") as { content: string } | undefined;
    expect(row?.content).toBe("old dream");
    expect(Number(pragma(db, "user_version").user_version)).toBeGreaterThanOrEqual(1);
  });

  it("is idempotent across repeated opens", () => {
    const p = path.join(dir, "idempotent.db");
    open(p).close();
    const db = open(p);
    expect(Number(pragma(db, "user_version").user_version)).toBeGreaterThanOrEqual(1);
  });

  it("still fails rows left running by a crash", () => {
    const p = path.join(dir, "crash.db");
    const first = open(p);
    first
      .prepare(
        `INSERT INTO dreams (id, created_at, dream_date, content, analysis_status)
         VALUES ('r1', '2026-01-01T00:00:00.000Z', '2026-01-01', 'x', 'running')`,
      )
      .run();
    first.close();

    const reopened = open(p);
    const row = reopened
      .prepare("SELECT analysis_status, analysis_error FROM dreams WHERE id = 'r1'")
      .get() as { analysis_status: string; analysis_error: string };
    expect(row.analysis_status).toBe("failed");
    expect(row.analysis_error).toContain("interrupted");
  });
});
