import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createRepository,
  ValidationError,
  type Repository,
} from "@/lib/dreams";
import { openDatabase } from "@/lib/db";
import type { DreamAnalysis } from "@/lib/analysis/schema";

const analysis: DreamAnalysis = {
  summary: "A lucid flight over a quiet city.",
  themes: ["flight", "freedom"],
  emotions: ["calm", "joy"],
  symbols: [{ name: "wings", meaning: "self-directed agency" }],
  reflection: "Where in waking life do you feel unencumbered?",
  mood_after: "hopeful",
};

let dir: string;
let repo: Repository;
const openRepos: Repository[] = [];

function track(r: Repository): Repository {
  openRepos.push(r);
  return r;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-test-"));
  repo = track(createRepository(path.join(dir, "test.db")));
});

afterEach(() => {
  vi.useRealTimers();
  while (openRepos.length > 0) openRepos.pop()!.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function instantWhereUtcDateDiffersFromLocalDate(): Date | null {
  for (let hour = 0; hour < 48; hour++) {
    const candidate = new Date(Date.UTC(2026, 2, 9, hour, 0, 0));
    if (candidate.toISOString().slice(0, 10) !== localDateString(candidate)) {
      return candidate;
    }
  }
  return null;
}

describe("create", () => {
  it("persists a dream and reads it back", () => {
    const dream = repo.create({
      content: "I was flying over a silver ocean.",
      dreamDate: "2026-09-25",
      title: "Silver ocean",
      mood: "calm",
    });

    expect(dream.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(dream.content).toBe("I was flying over a silver ocean.");
    expect(dream.dreamDate).toBe("2026-09-25");
    expect(dream.title).toBe("Silver ocean");
    expect(dream.mood).toBe("calm");
    expect(dream.analysisStatus).toBe("none");
    expect(dream.analysis).toBeNull();
    expect(dream.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const loaded = repo.get(dream.id);
    expect(loaded).toEqual(dream);
  });

  it("defaults title and mood to empty strings", () => {
    const dream = repo.create({ content: "A short dream.", dreamDate: "2026-09-25" });
    expect(dream.title).toBe("");
    expect(dream.mood).toBe("");
  });

  it("defaults dreamDate to the LOCAL calendar date, not the UTC date", () => {
    const instant = instantWhereUtcDateDiffersFromLocalDate();
    const now = instant ?? new Date();
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const dream = repo.create({ content: "A morning dream logged without a date." });

    expect(dream.dreamDate).toBe(localDateString(new Date()));
    if (instant) {
      expect(now.toISOString().slice(0, 10)).not.toBe(localDateString(now));
      expect(dream.dreamDate).not.toBe(now.toISOString().slice(0, 10));
    }
    vi.useRealTimers();
  });

  it("rejects empty content", () => {
    expect(() => repo.create({ content: "   ", dreamDate: "2026-09-25" })).toThrow(
      ValidationError,
    );
  });

  it("rejects a malformed dream date", () => {
    expect(() =>
      repo.create({ content: "Valid content here.", dreamDate: "25/09/2026" }),
    ).toThrow(ValidationError);
  });

  it("rejects content above the length limit", () => {
    expect(() =>
      repo.create({ content: "x".repeat(20001), dreamDate: "2026-09-25" }),
    ).toThrow(ValidationError);
  });
});

describe("list", () => {
  it("returns newest first", () => {
    const a = repo.create({ content: "first", dreamDate: "2026-09-01" });
    const b = repo.create({ content: "second", dreamDate: "2026-09-02" });
    const list = repo.list();
    expect(list.map((d) => d.id)).toEqual([b.id, a.id]);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) {
      repo.create({ content: `dream ${i}`, dreamDate: "2026-09-01" });
    }
    expect(repo.list({ limit: 2 })).toHaveLength(2);
  });

  it("returns an empty array for a fresh database", () => {
    expect(repo.list()).toEqual([]);
  });
});

describe("count", () => {
  it("returns the total regardless of the list limit", () => {
    for (let i = 0; i < 5; i++) {
      repo.create({ content: `dream ${i}`, dreamDate: "2026-09-01" });
    }
    expect(repo.list({ limit: 2 })).toHaveLength(2);
    expect(repo.count()).toBe(5);
  });

  it("tracks removals and starts at zero", () => {
    expect(repo.count()).toBe(0);
    const dream = repo.create({ content: "one", dreamDate: "2026-09-01" });
    expect(repo.count()).toBe(1);
    repo.remove(dream.id);
    expect(repo.count()).toBe(0);
  });
});

describe("get / remove", () => {
  it("returns null for an unknown id", () => {
    expect(repo.get("nope")).toBeNull();
  });

  it("removes a dream and reports whether anything was deleted", () => {
    const dream = repo.create({ content: "delete me", dreamDate: "2026-09-25" });
    expect(repo.remove(dream.id)).toBe(true);
    expect(repo.get(dream.id)).toBeNull();
    expect(repo.remove(dream.id)).toBe(false);
  });
});

describe("analysis lifecycle", () => {
  it("moves none → running → done", () => {
    const dream = repo.create({ content: "analyze me", dreamDate: "2026-09-25" });

    expect(repo.startAnalysis(dream.id)).toBe(true);
    expect(repo.get(dream.id)?.analysisStatus).toBe("running");

    repo.completeAnalysis(dream.id, analysis, "gpt-oss-120b");
    const after = repo.get(dream.id);
    expect(after?.analysisStatus).toBe("done");
    expect(after?.analysis).toEqual(analysis);
    expect(after?.model).toBe("gpt-oss-120b");
    expect(after?.analyzedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(after?.analysisError).toBe("");
  });

  it("moves none → running → failed with the error message kept", () => {
    const dream = repo.create({ content: "fail me", dreamDate: "2026-09-25" });
    repo.startAnalysis(dream.id);
    repo.failAnalysis(dream.id, "upstream 500");

    const after = repo.get(dream.id);
    expect(after?.analysisStatus).toBe("failed");
    expect(after?.analysisError).toBe("upstream 500");
    expect(after?.analysis).toBeNull();
  });

  it("refuses to start an analysis that is already running", () => {
    const dream = repo.create({ content: "concurrent", dreamDate: "2026-09-25" });
    expect(repo.startAnalysis(dream.id)).toBe(true);
    expect(repo.startAnalysis(dream.id)).toBe(false);
  });

  it("refuses to start an analysis for an unknown id", () => {
    expect(repo.startAnalysis("missing")).toBe(false);
  });

  it("allows re-analysis after a completed analysis", () => {
    const dream = repo.create({ content: "again", dreamDate: "2026-09-25" });
    repo.startAnalysis(dream.id);
    repo.completeAnalysis(dream.id, analysis, "gpt-oss-120b");
    expect(repo.startAnalysis(dream.id)).toBe(true);
  });

  it("recovers rows left in running state by a crash", () => {
    const dbPath = path.join(dir, "recover.db");
    const first = track(createRepository(dbPath));
    const d = first.create({ content: "crashed", dreamDate: "2026-09-25" });
    first.startAnalysis(d.id);

    const reopened = track(createRepository(dbPath));
    const after = reopened.get(d.id);
    expect(after?.analysisStatus).toBe("failed");
    expect(after?.analysisError).toContain("interrupted");
    expect(reopened.startAnalysis(d.id)).toBe(true);
  });

  it("ignores a late completion for a dream that already failed", () => {
    const dream = repo.create({ content: "late arrival", dreamDate: "2026-09-25" });
    repo.startAnalysis(dream.id);
    repo.failAnalysis(dream.id, "upstream 500");

    repo.completeAnalysis(dream.id, analysis, "gpt-oss-120b");

    const after = repo.get(dream.id);
    expect(after?.analysisStatus).toBe("failed");
    expect(after?.analysisError).toBe("upstream 500");
    expect(after?.analysis).toBeNull();
  });

  it("ignores completion for a dream that never started", () => {
    const dream = repo.create({ content: "never started", dreamDate: "2026-09-25" });
    repo.completeAnalysis(dream.id, analysis, "gpt-oss-120b");
    expect(repo.get(dream.id)?.analysisStatus).toBe("none");
  });
});

describe("status normalization", () => {
  it("normalizes an unknown stored analysis_status to none", () => {
    const dream = repo.create({ content: "weird status", dreamDate: "2026-09-25" });

    const raw = openDatabase(path.join(dir, "test.db"));
    raw
      .prepare("UPDATE dreams SET analysis_status = ? WHERE id = ?")
      .run("bogus", dream.id);
    raw.close();

    expect(repo.get(dream.id)?.analysisStatus).toBe("none");
  });

  it("normalizes a non-JSON stored analysis to null instead of throwing", () => {
    const dream = repo.create({ content: "bad json", dreamDate: "2026-09-25" });

    const raw = openDatabase(path.join(dir, "test.db"));
    raw
      .prepare("UPDATE dreams SET analysis = ? WHERE id = ?")
      .run("not json", dream.id);
    raw.close();

    expect(repo.get(dream.id)?.analysis).toBeNull();
    expect(repo.list().find((d) => d.id === dream.id)?.analysis).toBeNull();
  });

  it("normalizes an empty-string stored analysis to null instead of throwing", () => {
    const dream = repo.create({ content: "empty json", dreamDate: "2026-09-25" });

    const raw = openDatabase(path.join(dir, "test.db"));
    raw.prepare("UPDATE dreams SET analysis = ? WHERE id = ?").run("", dream.id);
    raw.close();

    expect(repo.get(dream.id)?.analysis).toBeNull();
    expect(repo.list().find((d) => d.id === dream.id)?.analysis).toBeNull();
  });

  it("keeps every known analysis_status as-is", () => {
    const dream = repo.create({ content: "known status", dreamDate: "2026-09-25" });

    const raw = openDatabase(path.join(dir, "test.db"));
    for (const status of ["none", "running", "done", "failed"]) {
      raw
        .prepare("UPDATE dreams SET analysis_status = ? WHERE id = ?")
        .run(status, dream.id);
      expect(repo.get(dream.id)?.analysisStatus).toBe(status);
    }
    raw.close();
  });
});
