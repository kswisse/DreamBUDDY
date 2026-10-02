import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, isConfigured, findProjectRoot } from "@/lib/config";

describe("loadConfig", () => {
  it("applies defaults for an empty environment", () => {
    const cfg = loadConfig({});
    expect(cfg.apiKey).toBeNull();
    expect(cfg.baseUrl).toBe("https://api.openai.com/v1");
    expect(cfg.model).toBe("gpt-oss-120b");
    expect(cfg.dbPath).toBe(path.join(findProjectRoot(), "data", "dreambuddy.db"));
  });

  it("resolves a relative dbPath to an absolute path under the project root", () => {
    const cfg = loadConfig({});
    expect(path.isAbsolute(cfg.dbPath)).toBe(true);
    expect(cfg.dbPath.startsWith(findProjectRoot())).toBe(true);
  });

  it("resolves a relative override against the project root", () => {
    const cfg = loadConfig({ DREAMBUDDY_DB_PATH: "tmp/other.db" });
    expect(cfg.dbPath).toBe(path.join(findProjectRoot(), "tmp", "other.db"));
  });

  it("keeps an absolute dbPath unchanged", () => {
    const abs = path.join(os.tmpdir(), "dreambuddy-abs.db");
    const cfg = loadConfig({ DREAMBUDDY_DB_PATH: abs });
    expect(cfg.dbPath).toBe(abs);
  });

  it("keeps :memory: unchanged", () => {
    const cfg = loadConfig({ DREAMBUDDY_DB_PATH: ":memory:" });
    expect(cfg.dbPath).toBe(":memory:");
  });

  it("reads overrides from the environment", () => {
    const cfg = loadConfig({
      OPENAI_API_KEY: "sk-test",
      OPENAI_BASE_URL: "http://localhost:11434/v1",
      DREAMBUDDY_MODEL: "llama3.1",
      DREAMBUDDY_DB_PATH: "tmp/other.db",
    });
    expect(cfg.apiKey).toBe("sk-test");
    expect(cfg.baseUrl).toBe("http://localhost:11434/v1");
    expect(cfg.model).toBe("llama3.1");
    expect(cfg.dbPath).toBe(path.join(findProjectRoot(), "tmp", "other.db"));
  });

  it("tolerates a trailing slash on the base url", () => {
    const cfg = loadConfig({ OPENAI_BASE_URL: "https://api.openai.com/v1/" });
    expect(cfg.baseUrl).toBe("https://api.openai.com/v1");
  });

  it("treats an empty api key as unset", () => {
    const cfg = loadConfig({ OPENAI_API_KEY: "   " });
    expect(cfg.apiKey).toBeNull();
  });
});

describe("isConfigured", () => {
  it("is false without a key against the official OpenAI endpoint", () => {
    const cfg = loadConfig({});
    expect(isConfigured(cfg)).toBe(false);
  });

  it("is true with a key", () => {
    const cfg = loadConfig({ OPENAI_API_KEY: "sk-test" });
    expect(isConfigured(cfg)).toBe(true);
  });

  it("is true without a key on a self-hosted endpoint", () => {
    const cfg = loadConfig({ OPENAI_BASE_URL: "http://localhost:11434/v1" });
    expect(isConfigured(cfg)).toBe(true);
  });
});

describe("findProjectRoot", () => {
  it("walks up to the nearest directory containing package.json", () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-root-"));
    try {
      fs.writeFileSync(path.join(tree, "package.json"), "{}");
      const nested = path.join(tree, "a", "b");
      fs.mkdirSync(nested, { recursive: true });
      expect(findProjectRoot(nested)).toBe(tree);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  it("falls back to the start directory when no package.json exists above", () => {
    const tree = fs.mkdtempSync(path.join(os.tmpdir(), "dreambuddy-noroot-"));
    try {
      const nested = path.join(tree, "deep");
      fs.mkdirSync(nested, { recursive: true });
      expect(findProjectRoot(nested)).toBe(nested);
    } finally {
      fs.rmSync(tree, { recursive: true, force: true });
    }
  });

  it("resolves the project root from this repo's own location", () => {
    const root = findProjectRoot();
    expect(fs.existsSync(path.join(root, "package.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "lib", "config.ts"))).toBe(true);
  });
});
