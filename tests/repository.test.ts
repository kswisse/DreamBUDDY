import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

type RepoModule = typeof import("@/lib/repository");
type Repository = import("@/lib/dreams").Repository;

let dir: string;
let pathA: string;
let pathB: string;
let savedDbPath: string | undefined;

async function freshModule(): Promise<RepoModule> {
  vi.resetModules();
  return import("@/lib/repository");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-repo-"));
  pathA = path.join(dir, "a.db");
  pathB = path.join(dir, "b.db");
  savedDbPath = process.env.DREAMBUDDY_DB_PATH;
  process.env.DREAMBUDDY_DB_PATH = pathA;
});

afterEach(async () => {
  const mod = await freshModule();
  mod.closeRepository();
  if (savedDbPath === undefined) delete process.env.DREAMBUDDY_DB_PATH;
  else process.env.DREAMBUDDY_DB_PATH = savedDbPath;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("getRepository singleton", () => {
  it("returns the same repository for the same database path", async () => {
    const mod = await freshModule();
    const first = mod.getRepository();
    const second = mod.getRepository();
    expect(second).toBe(first);
    mod.closeRepository();
  });

  it("survives a module reload (globalThis-backed cache)", async () => {
    const mod1 = await freshModule();
    const repo1 = mod1.getRepository();

    const mod2 = await freshModule();
    const repo2 = mod2.getRepository();

    expect(repo2).toBe(repo1);
    mod2.closeRepository();
  });

  it("does not close the previous handle when the path changes", async () => {
    const mod = await freshModule();
    const repoA: Repository = mod.getRepository();
    repoA.create({ content: "on A", dreamDate: "2026-09-25" });

    process.env.DREAMBUDDY_DB_PATH = pathB;
    const repoB = mod.getRepository();
    expect(repoB).not.toBe(repoA);

    // The old repository must remain usable after the switch.
    expect(repoA.list()).toHaveLength(1);
    expect(repoB.list()).toEqual([]);
    mod.closeRepository();
  });

  it("does not rerun crash recovery on a live running row after reload", async () => {
    const mod1 = await freshModule();
    const repo1 = mod1.getRepository();
    const dream = repo1.create({ content: "in flight", dreamDate: "2026-09-25" });
    expect(repo1.startAnalysis(dream.id)).toBe(true);

    // Simulate a hot reload of the module code within the same process.
    const mod2 = await freshModule();
    const repo2 = mod2.getRepository();
    expect(repo2.get(dream.id)?.analysisStatus).toBe("running");
    mod2.closeRepository();
  });

  it("creates a fresh working repository after closeRepository", async () => {
    const mod = await freshModule();
    const first = mod.getRepository();
    first.create({ content: "temp", dreamDate: "2026-09-25" });
    mod.closeRepository();

    expect(() => first.list()).toThrow();

    const second = mod.getRepository();
    expect(second).not.toBe(first);
    // Data survives in the file; only the handle is fresh.
    expect(second.list()).toHaveLength(1);
    mod.closeRepository();
  });

  it("closeRepository closes every cached repository", async () => {
    const mod = await freshModule();
    const repoA = mod.getRepository();

    process.env.DREAMBUDDY_DB_PATH = pathB;
    const repoB = mod.getRepository();

    mod.closeRepository();
    expect(() => repoA.list()).toThrow();
    expect(() => repoB.list()).toThrow();
  });
});
