import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  apiKey: string | null;
  baseUrl: string;
  model: string;
  dbPath: string;
}

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
export const DEFAULT_MODEL = "gpt-oss-120b";
const DEFAULT_DB_PATH = "data/dreambuddy.db";

function read(env: Record<string, string | undefined>, key: string): string | null {
  const value = env[key]?.trim();
  return value ? value : null;
}

function walkUpForPackageJson(startDir: string): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Nearest directory containing package.json, searched upward from `startDir`.
 * Without an argument, searches upward from this module's own location (so
 * the result does not depend on the process working directory) and falls back
 * to `process.cwd()`. Returns `startDir` when nothing is found.
 */
export function findProjectRoot(startDir?: string): string {
  if (startDir) {
    return walkUpForPackageJson(startDir) ?? path.resolve(startDir);
  }
  try {
    const fromModule = walkUpForPackageJson(path.dirname(fileURLToPath(import.meta.url)));
    if (fromModule) return fromModule;
  } catch {
    // import.meta.url unavailable (bundled non-ESM) — fall through to cwd
  }
  return walkUpForPackageJson(process.cwd()) ?? process.cwd();
}

function resolveDbPath(raw: string): string {
  if (raw === ":memory:" || path.isAbsolute(raw)) return raw;
  return path.resolve(findProjectRoot(), raw);
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  return {
    apiKey: read(env, "OPENAI_API_KEY"),
    baseUrl: (read(env, "OPENAI_BASE_URL") ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: read(env, "DREAMBUDDY_MODEL") ?? DEFAULT_MODEL,
    dbPath: resolveDbPath(read(env, "DREAMBUDDY_DB_PATH") ?? DEFAULT_DB_PATH),
  };
}

export function isOfficialEndpoint(config: AppConfig): boolean {
  return config.baseUrl === DEFAULT_BASE_URL;
}

export function isConfigured(config: AppConfig): boolean {
  if (config.apiKey) return true;
  // Self-hosted OpenAI-compatible servers (Ollama, vLLM, LM Studio) do not
  // require a key, so a custom base URL counts as configured.
  return !isOfficialEndpoint(config);
}
