import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "@/lib/db";
import {
  dreamAnalysisSchema,
  type DreamAnalysis,
} from "@/lib/analysis/schema";

export type AnalysisStatus = "none" | "running" | "done" | "failed";

export interface Dream {
  id: string;
  createdAt: string;
  dreamDate: string;
  title: string;
  content: string;
  mood: string;
  analysisStatus: AnalysisStatus;
  analysisError: string;
  analysis: DreamAnalysis | null;
  analyzedAt: string | null;
  model: string;
}

export interface CreateDreamInput {
  content: string;
  dreamDate?: string;
  title?: string;
  mood?: string;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const MAX_CONTENT_LENGTH = 20000;
const MAX_TITLE_LENGTH = 200;
const MAX_MOOD_LENGTH = 64;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function today(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function now(): string {
  return new Date().toISOString();
}

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

interface DreamRow {
  id: string;
  created_at: string;
  dream_date: string;
  title: string;
  content: string;
  mood: string;
  analysis_status: string;
  analysis_error: string;
  analysis: string;
  analyzed_at: string | null;
  model: string;
}

const ANALYSIS_STATUSES: readonly string[] = [
  "none",
  "running",
  "done",
  "failed",
];

function toStatus(value: string): AnalysisStatus {
  return ANALYSIS_STATUSES.includes(value)
    ? (value as AnalysisStatus)
    : "none";
}

function toDream(row: DreamRow): Dream {
  let analysis: DreamAnalysis | null = null;
  if (row.analysis) {
    try {
      const parsed = dreamAnalysisSchema.safeParse(JSON.parse(row.analysis));
      analysis = parsed.success ? parsed.data : null;
    } catch {
      /* corrupt stored analysis — analysis stays null */
    }
  }
  return {
    id: row.id,
    createdAt: row.created_at,
    dreamDate: row.dream_date,
    title: row.title,
    content: row.content,
    mood: row.mood,
    analysisStatus: toStatus(row.analysis_status),
    analysisError: row.analysis_error,
    analysis,
    analyzedAt: row.analyzed_at,
    model: row.model,
  };
}

export interface Repository {
  create(input: CreateDreamInput): Dream;
  list(options?: { limit?: number }): Dream[];
  count(): number;
  get(id: string): Dream | null;
  remove(id: string): boolean;
  startAnalysis(id: string): boolean;
  completeAnalysis(id: string, analysis: DreamAnalysis, model: string): void;
  failAnalysis(id: string, message: string): void;
  close(): void;
}

export function createRepository(dbPath: string): Repository {
  const db: DatabaseSync = openDatabase(dbPath);

  function get(id: string): Dream | null {
    const row = db
      .prepare("SELECT * FROM dreams WHERE id = ?")
      .get(id) as DreamRow | undefined;
    return row ? toDream(row) : null;
  }

  return {
    create(input: CreateDreamInput): Dream {
      const content = input.content?.trim() ?? "";
      if (!content) {
        throw new ValidationError("Dream content must not be empty.");
      }
      if (content.length > MAX_CONTENT_LENGTH) {
        throw new ValidationError(
          `Dream content must be at most ${MAX_CONTENT_LENGTH} characters.`,
        );
      }
      const dreamDate = input.dreamDate ?? today();
      if (!isRealDate(dreamDate)) {
        throw new ValidationError(
          "dreamDate must be a real calendar date in YYYY-MM-DD format.",
        );
      }
      const title = (input.title ?? "").trim();
      if (title.length > MAX_TITLE_LENGTH) {
        throw new ValidationError(
          `Title must be at most ${MAX_TITLE_LENGTH} characters.`,
        );
      }
      const mood = (input.mood ?? "").trim();
      if (mood.length > MAX_MOOD_LENGTH) {
        throw new ValidationError(
          `Mood must be at most ${MAX_MOOD_LENGTH} characters.`,
        );
      }

      const id = crypto.randomUUID();
      const createdAt = now();
      db.prepare(
        `INSERT INTO dreams (id, created_at, dream_date, title, content, mood)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, createdAt, dreamDate, title, content, mood);

      const dream = get(id);
      if (!dream) throw new Error("Failed to persist dream");
      return dream;
    },

    list(options?: { limit?: number }): Dream[] {
      const requested = options?.limit ?? 50;
      if (!Number.isInteger(requested) || requested < 1 || requested > 100) {
        throw new ValidationError("limit must be an integer between 1 and 100.");
      }
      const rows = db
        .prepare(
          "SELECT * FROM dreams ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .all(requested) as unknown as DreamRow[];
      return rows.map(toDream);
    },

    get,

    count(): number {
      const row = db.prepare("SELECT COUNT(*) AS n FROM dreams").get() as {
        n: number;
      };
      return Number(row.n);
    },

    remove(id: string): boolean {
      const result = db.prepare("DELETE FROM dreams WHERE id = ?").run(id);
      return Number(result.changes) > 0;
    },

    startAnalysis(id: string): boolean {
      const result = db
        .prepare(
          `UPDATE dreams
              SET analysis_status = 'running', analysis_error = ''
            WHERE id = ? AND analysis_status != 'running'`,
        )
        .run(id);
      return Number(result.changes) > 0;
    },

    completeAnalysis(id: string, analysis: DreamAnalysis, model: string): void {
      // Only a running analysis may complete: a late result must not
      // overwrite a row that already failed (or was never started).
      db.prepare(
        `UPDATE dreams
            SET analysis_status = 'done',
                analysis = ?,
                analysis_error = '',
                analyzed_at = ?,
                model = ?
          WHERE id = ? AND analysis_status = 'running'`,
      ).run(JSON.stringify(analysis), now(), model, id);
    },

    failAnalysis(id: string, message: string): void {
      // Only a running analysis may fail: a late failure must not clobber
      // a completed analysis.
      db.prepare(
        `UPDATE dreams
            SET analysis_status = 'failed', analysis_error = ?
          WHERE id = ? AND analysis_status = 'running'`,
      ).run(message, id);
    },

    close(): void {
      db.close();
    },
  };
}
