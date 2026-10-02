import { loadConfig } from "@/lib/config";
import { createRepository, type Repository } from "@/lib/dreams";

/**
 * Process-wide repository cache keyed by database path. Stored on globalThis
 * so it survives module reloads (dev HMR, test module resets): reopening the
 * same path must never hand out a second handle, because opening a handle
 * reruns startup recovery and would fail rows of a live analysis.
 *
 * Handles are only closed by closeRepository() — never on a config/path
 * change — so a repository already handed out stays usable afterwards.
 */
const CACHE_KEY = "__dreambuddy_repository_cache__";

function cache(): Map<string, Repository> {
  const holder = globalThis as unknown as Record<
    string,
    Map<string, Repository> | undefined
  >;
  holder[CACHE_KEY] ??= new Map<string, Repository>();
  return holder[CACHE_KEY];
}

/**
 * Process-wide repository bound to the configured database path.
 * Cached per path for the lifetime of the process.
 */
export function getRepository(): Repository {
  const dbPath = loadConfig().dbPath;
  const repos = cache();
  let repo = repos.get(dbPath);
  if (!repo) {
    repo = createRepository(dbPath);
    repos.set(dbPath, repo);
  }
  return repo;
}

export function closeRepository(): void {
  const repos = cache();
  for (const repo of repos.values()) repo.close();
  repos.clear();
}
