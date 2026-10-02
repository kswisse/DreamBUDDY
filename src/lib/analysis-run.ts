/**
 * Process-wide registry of dream ids with a LIVE in-process analysis run.
 *
 * A row stuck in `analysis_status = 'running'` after a died handler can only
 * be told apart from a genuinely concurrent run by asking whether THIS
 * process still holds an invocation for that id. The registry lives on
 * globalThis (same pattern as the repository cache) so dev-HMR module
 * reloads reuse it instead of dropping live entries.
 */

const KEY = "__dreambuddy_active_analyses__";

function active(): Set<string> {
  const holder = globalThis as unknown as Record<string, Set<string> | undefined>;
  holder[KEY] ??= new Set<string>();
  return holder[KEY];
}

/** Claim the id for a run. Returns false when a run is already registered. */
export function beginRun(id: string): boolean {
  const set = active();
  if (set.has(id)) return false;
  set.add(id);
  return true;
}

/** Release the id once the run has completed or failed. */
export function endRun(id: string): void {
  active().delete(id);
}

/** True while this process holds a live analysis for the id. */
export function isActive(id: string): boolean {
  return active().has(id);
}

/** Test hook: force-mark an id active/inactive without starting a run. */
export function __setActiveForTest(id: string, value: boolean): void {
  if (value) active().add(id);
  else active().delete(id);
}
