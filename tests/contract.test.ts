import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// This test intentionally pins cross-layer string contracts: the analyze
// pipeline spreads error codes across client.ts, the analyze route, and
// AnalysisPanel.tsx as duplicated literals, so string drift between layers
// would otherwise pass all three suites unnoticed.

const ROOT = process.cwd();

function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function extract(source: string, re: RegExp): string[] {
  return [...source.matchAll(re)].map((m) => m[1]);
}

function uniqueSorted(codes: string[]): string[] {
  return [...new Set(codes)].sort();
}

const CLIENT_PATH = "src/lib/analysis/client.ts";
const ROUTE_PATH = "src/app/api/dreams/[id]/analyze/route.ts";
const PANEL_PATH = "src/components/AnalysisPanel.tsx";

const CLIENT_RE = /new AiError\(\s*"([^"]+)"/g;
const ROUTE_RE = /errorResponse\(\s*\d+,\s*"([^"]+)"/g;
const PANEL_RE = /code === "([^"]+)"/g;

const clientCodes = uniqueSorted(extract(readSource(CLIENT_PATH), CLIENT_RE));
const routeCodes = uniqueSorted(extract(readSource(ROUTE_PATH), ROUTE_RE));
const panelCodes = uniqueSorted(extract(readSource(PANEL_PATH), PANEL_RE));

describe("analyze error-code contract across layers", () => {
  it("extracts at least one code from each layer (regex self-guard)", () => {
    expect(
      clientCodes,
      `No codes extracted from ${CLIENT_PATH} with /${CLIENT_RE.source}/ — ` +
        `if the call shape changed (e.g. code passed via a variable), update the regex.`,
    ).not.toHaveLength(0);
    expect(
      routeCodes,
      `No codes extracted from ${ROUTE_PATH} with /${ROUTE_RE.source}/ — ` +
        `if the call shape changed (e.g. errorResponse refactored), update the regex.`,
    ).not.toHaveLength(0);
    expect(
      panelCodes,
      `No codes extracted from ${PANEL_PATH} with /${PANEL_RE.source}/ — ` +
        `if the branching style changed (e.g. switch on failure.code), update the regex.`,
    ).not.toHaveLength(0);
  });

  it("panel only branches on codes the route can actually emit", () => {
    const missing = panelCodes.filter((code) => !routeCodes.includes(code));
    expect(
      missing,
      `Panel branches on code(s) ${JSON.stringify(missing)} that ${ROUTE_PATH} ` +
        `never emits. Route emits: ${JSON.stringify(routeCodes)}.`,
    ).toEqual([]);
  });

  it("every client-thrown code is explicitly present in the route", () => {
    const missing = clientCodes.filter((code) => !routeCodes.includes(code));
    expect(
      missing,
      `Client throws code(s) ${JSON.stringify(missing)} that ${ROUTE_PATH} does ` +
        `not literally mention — the route's catch-all would rename them to ` +
        `"upstream_error". Client: ${JSON.stringify(clientCodes)}; ` +
        `route: ${JSON.stringify(routeCodes)}.`,
    ).toEqual([]);
  });
});
