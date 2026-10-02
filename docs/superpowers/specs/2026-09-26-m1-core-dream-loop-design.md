# DreamBUDDY M1 — Core Dream Loop (Design)

Date: 2026-09-26
Status: approved for implementation (user instructed: plan then implement the single highest-priority milestone)

## Repository reality (Phase 1 findings)

The GitHub repo `kswisse/DreamBUDDY` contains exactly three files on `main`
(single commit `d5341f5 "Initial commit"`):

- `README.md` — one sentence: "AI-powered app that records, analyzes, and interprets
  users' dreams using OpenAI's GPT-OSS model to promote mental wellness and creativity."
- `LICENSE` — MIT
- `.gitignore` — the standard GitHub Node.js template (Next.js/Nuxt/Vite build
  outputs, `node_modules/`, `.env` with `!.env.example`)

No source code, no package manifest, no tests, no CI, no wiki, no issues, no other
branches. Everything is "completely missing"; nothing is "partially implemented".
The intended stack is inferred from `.gitignore` (Node.js web app) and the README
(OpenAI GPT-OSS model). This design therefore defines the first milestone rather
than extending existing code.

## Product framing

DreamBUDDY is a single-user, local-first web app:

1. **Record** a dream right after waking (free text + date + optional title/mood).
2. **Analyze** it with an LLM (default: OpenAI `gpt-oss-120b`) into a structured
   interpretation: summary, themes, emotions, symbols, reflection prompt.
3. **Review** past dreams and their interpretations in a journal.

Mental-wellness scope limit: the app produces reflective prompts, not clinical
advice; the system prompt forbids diagnosis/treatment claims and says so in output.

## Milestone choice

**M1 = the core dream loop works end to end**: create a dream → AI analysis is
requested and stored → journal list and detail pages render with loading, error,
empty, and unconfigured-API states.

Why this milestone: every other feature (trends, voice capture, auth, exports,
dream streaks) depends on a dream record and an analysis record existing. With M1
the product is usable and each later milestone is additive.

## Architecture

Next.js 16 (App Router) + TypeScript, single Node process. No framework beyond
Next/React; no ORM; no queue.

```
src/
  lib/
    config.ts          env parsing (API key, base URL, model, DB path)
    db.ts              node:sqlite DatabaseSync singleton + schema bootstrap
    dreams.ts          DreamRepository: create/list/get/saveAnalysis
    analysis/
      schema.ts        DreamAnalysis zod schema + parse/normalize helpers
      prompt.ts        system + user prompt builders
      client.ts        OpenAI-compatible POST /chat/completions (fetch, timeout,
                       retries, JSON extraction, schema validation)
  app/
    layout.tsx, globals.css, page.tsx (journal)
    new/page.tsx         record form
    dreams/[id]/page.tsx detail (server) + analysis panel (client)
    api/dreams/route.ts            GET list, POST create
    api/dreams/[id]/route.ts       GET detail, DELETE
    api/dreams/[id]/analyze/route.ts  POST run/refresh analysis
tests/                    vitest unit + route tests
```

### Decisions

- **Persistence**: `node:sqlite` (built into Node 24) — zero native deps, file DB
  at `data/dreambuddy.db` (gitignored). Synchronous API keeps the repository dead
  simple; volume is one user's dream journal.
- **AI**: plain `fetch` to `${OPENAI_BASE_URL}/chat/completions` with
  `DREAMBUDDY_MODEL` (default `gpt-oss-120b`). Works against api.openai.com and
  any OpenAI-compatible local server (Ollama/vLLM) by changing base URL — no SDK
  dependency, and the OpenAI SDK would not help since gpt-oss is served over both
  Responses and Chat Completions routes depending on provider.
- **Structured output**: request JSON in the prompt, then defensively extract the
  first JSON object from the reply and validate with zod (`DreamAnalysis`).
  Invalid output surfaces as an analysis error the user can retry — never stored
  as if valid.
- **Analysis is a separate endpoint** from creation: recording a dream must
  succeed offline / without an API key; analysis runs on demand with an explicit
  retry. Statuses: `none` → `running` → `done` | `failed`.
- **No auth in M1**: single-user local app; `dev`/`start` bind explicitly to
  `127.0.0.1` (`next dev -H 127.0.0.1`) so the no-auth journal is never exposed
  to the LAN by default. Listed as P2 for later multi-user work.

### Data model

```sql
CREATE TABLE dreams (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,          -- ISO-8601 UTC
  dream_date TEXT NOT NULL,          -- YYYY-MM-DD (when the dream happened)
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  mood TEXT NOT NULL DEFAULT '',     -- optional one-word mood tag
  analysis_status TEXT NOT NULL DEFAULT 'none',  -- none|running|done|failed
  analysis_error TEXT NOT NULL DEFAULT '',
  analysis TEXT NOT NULL DEFAULT '', -- JSON of DreamAnalysis when done
  analyzed_at TEXT,                  -- ISO-8601 UTC
  model TEXT NOT NULL DEFAULT ''     -- model used for the stored analysis
);
```

`DreamAnalysis` (zod): `summary: string`, `themes: string[] (1..8)`,
`emotions: string[] (1..8)`, `symbols: {name, meaning}[] (0..10)`,
`reflection: string`, `mood_after: string`.

### API

| Route | Method | Behavior |
|---|---|---|
| `/api/dreams` | GET | list, newest first, `?limit` (1..100, default 50) |
| `/api/dreams` | POST | create `{content, dreamDate?, title?, mood?}` → 201; 400 on validation error |
| `/api/dreams/[id]` | GET | detail; 404 unknown id |
| `/api/dreams/[id]` | DELETE | delete; 404 unknown id |
| `/api/dreams/[id]/analyze` | POST | run analysis; 200 with analysis; 404 unknown; 503 `not_configured` when no API key; 502 `upstream_error` on LLM failure; 409 when already `running` |

Errors always `{ error: { code, message } }`.

### UI states (required)

- Journal: empty state ("No dreams yet"), list with status badges.
- Record form: validation errors, submitting state, success → redirect to detail.
- Detail: analysis panel with idle/running/done/failed/not_configured states and
  Retry; dream body always visible; delete with confirm.

### Config (`.env.local`, `.env.example` committed)

| Var | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | required for analysis |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible server |
| `DREAMBUDDY_MODEL` | `gpt-oss-120b` | chat model id |
| `DREAMBUDDY_DB_PATH` | `data/dreambuddy.db` | sqlite file |

### Testing

Vitest, no network in tests:
- `config.test.ts` — defaults, overrides, missing key.
- `dreams.test.ts` — repository CRUD against temp DB files.
- `schema.test.ts` — analysis validation + tolerant JSON extraction.
- `client.test.ts` — mocked `fetch`: request shape, retry, timeout error path,
  invalid-JSON and schema-violation errors.
- `routes.test.ts` — route handlers invoked directly with `Request` objects;
  analyze route with stubbed client (configured / unconfigured / upstream fail).

Verification gate: `npm run typecheck && npm run lint && npm test && npm run build`
plus a dev-server smoke test of the loop with a stubbed OpenAI-compatible endpoint.

## Non-goals for M1

Auth/multi-user, voice input, images, trends/statistics, export, reminders,
push notifications, Docker/CI, mobile app.
