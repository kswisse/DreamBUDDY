import { z } from "zod";

export const dreamAnalysisSchema = z.object({
  summary: z.string().min(1),
  themes: z.array(z.string().min(1)).min(1).max(8),
  emotions: z.array(z.string().min(1)).min(1).max(8),
  symbols: z
    .array(z.object({ name: z.string().min(1), meaning: z.string().min(1) }))
    .max(10),
  reflection: z.string().min(1),
  mood_after: z.string().min(1),
});

export type DreamAnalysis = z.infer<typeof dreamAnalysisSchema>;

const OPENING_BRACE = "{";
const MAX_THEMES = 8;
const MAX_EMOTIONS = 8;
const MAX_SYMBOLS = 10;

/** Index just past the balanced object starting at `start`, or -1. */
function matchBalanced(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

export interface JsonScan {
  candidates: unknown[];
  sawUnbalanced: boolean;
}

/**
 * Collect every top-level JSON object in arbitrary model output. Candidates
 * that fail to parse (malformed braces in prose) are skipped so a later,
 * well-formed object can still be used. `sawUnbalanced` records that some
 * `{` never closed, which distinguishes truncation from a missing object.
 */
export function scanJsonCandidates(text: string): JsonScan {
  const candidates: unknown[] = [];
  let sawUnbalanced = false;
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(OPENING_BRACE, cursor);
    if (start === -1) break;
    const end = matchBalanced(text, start);
    if (end === -1) {
      sawUnbalanced = true;
      break;
    }
    try {
      candidates.push(JSON.parse(text.slice(start, end)));
    } catch {
      // malformed candidate — keep scanning after it
    }
    cursor = end;
  }
  return { candidates, sawUnbalanced };
}

/**
 * Pull the first balanced JSON object out of arbitrary model output
 * ("bare JSON", "```json fences", or JSON embedded in prose) and parse it.
 */
export function extractJson(text: string): unknown {
  const { candidates, sawUnbalanced } = scanJsonCandidates(text);
  if (candidates.length > 0) return candidates[0];
  if (sawUnbalanced) {
    throw new Error("Model reply contains a truncated JSON object");
  }
  throw new Error("Model reply contains no JSON object");
}

function normalizeStringList(value: unknown, max: number): unknown {
  if (!Array.isArray(value)) return value;
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length === max) break;
  }
  return result;
}

function normalizeSymbols(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const result: { name: string; meaning: string }[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) continue;
    const { name, meaning } = item as { name?: unknown; meaning?: unknown };
    if (typeof name !== "string" || typeof meaning !== "string") continue;
    const trimmedName = name.trim();
    const trimmedMeaning = meaning.trim();
    if (!trimmedName || !trimmedMeaning) continue;
    result.push({ name: trimmedName, meaning: trimmedMeaning });
    if (result.length === MAX_SYMBOLS) break;
  }
  return result;
}

/**
 * Shape repairs for the common ways models miss the spec: padded strings,
 * duplicate list entries, and lists one or two items over the limit. Only
 * mechanical fixes — anything structurally wrong still fails validation.
 */
function normalizeAnalysisRaw(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const out = { ...(raw as Record<string, unknown>) };
  out.themes = normalizeStringList(out.themes, MAX_THEMES);
  out.emotions = normalizeStringList(out.emotions, MAX_EMOTIONS);
  out.symbols = normalizeSymbols(out.symbols);
  return out;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Extract a schema-valid analysis from model output. Every JSON object in the
 * reply is a candidate (models sometimes prepend a note object); each is
 * normalized, then validated, and the last failing candidate's validation
 * error is reported when nothing validates.
 */
export function extractAnalysis(text: string): DreamAnalysis {
  const { candidates, sawUnbalanced } = scanJsonCandidates(text);
  if (candidates.length === 0) {
    if (sawUnbalanced) {
      throw new Error("Model reply contains a truncated JSON object");
    }
    throw new Error("Model reply contains no JSON object");
  }

  let detail = "";
  for (const raw of candidates) {
    const result = dreamAnalysisSchema.safeParse(normalizeAnalysisRaw(raw));
    if (result.success) return result.data;
    detail = formatIssues(result.error);
  }
  throw new Error(`Model reply failed validation: ${detail}`);
}
