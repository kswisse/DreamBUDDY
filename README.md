# DreamBUDDY

AI-powered app that records, analyzes, and interprets users' dreams using OpenAI's GPT-OSS model to promote mental wellness and creativity.

## What it does

- **Record** a dream right after waking: free text, date, optional title and mood.
- **Analyze** it with an LLM (default `gpt-oss-120b`) into a structured
  interpretation — summary, themes, emotions, symbols, a reflection question,
  and how it should leave you feeling.
- **Review** past dreams and interpretations in a journal, with re-analysis and
  delete.

Single-user, local-first. Interpretations are reflective prompts, not medical
advice.

## Stack

Next.js 16 (App Router) + TypeScript, SQLite via Node's built-in `node:sqlite`
(no native modules), plain CSS, Vitest. AI calls go to any OpenAI-compatible
`/chat/completions` endpoint through `fetch`.

## Setup

Requires **Node 24+** — storage uses the built-in `node:sqlite` module, which
older runtimes do not provide.

```bash
npm install
cp .env.example .env.local   # then set OPENAI_API_KEY
npm run dev                  # http://localhost:3000 (bound to 127.0.0.1 only)
```

Recording dreams works without an API key; analysis returns a clear
`not_configured` error until one is set.

Pick a model your endpoint actually serves on `/chat/completions`. The default
`gpt-oss-120b` runs on OpenAI-compatible servers (Ollama, vLLM, LM Studio,
NVIDIA NIM…) but **not** on `api.openai.com`, which serves it only via the
Responses API — with the official API, set `DREAMBUDDY_MODEL` to a chat model
your key can access. A rejected model id shows as an `upstream_error` carrying
a `DREAMBUDDY_MODEL` hint.

The server binds to `127.0.0.1` only — the app has no auth in M1, so do not
expose it to your LAN unless you understand that anyone on the network can read
and delete your journal.

### Configuration (`.env.local`)

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | — | required for AI analysis |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | any OpenAI-compatible server (Ollama, vLLM, LM Studio…) |
| `DREAMBUDDY_MODEL` | `gpt-oss-120b` | chat model id — must be served by your endpoint on `/chat/completions` |
| `DREAMBUDDY_DB_PATH` | `data/dreambuddy.db` | SQLite file (created on first run) |

## Scripts

```bash
npm run dev         # dev server
npm run build       # production build
npm start           # serve the production build
npm run lint        # eslint (next/core-web-vitals + typescript)
npm run typecheck   # tsc --noEmit
npm test            # vitest suites for lib, routes, and components
```

## Architecture

```
src/lib/config.ts            env parsing + configuration check
src/lib/db.ts                SQLite schema bootstrap + crash recovery
src/lib/dreams.ts            dream repository (create/list/get/delete, analysis lifecycle)
src/lib/repository.ts        process-wide repository singleton
src/lib/analysis/schema.ts   DreamAnalysis schema + tolerant JSON extraction
src/lib/analysis/prompt.ts   system/user prompts
src/lib/analysis/client.ts   OpenAI-compatible call, retries, error taxonomy
src/app/                     pages: journal, record form, dream detail
src/app/api/dreams/…         REST routes (list/create, get/delete, analyze)
src/components/…             client components (analysis panel, delete)
tests/                       vitest suites for every lib + route
```

API: `GET/POST /api/dreams`, `GET/DELETE /api/dreams/:id`,
`POST /api/dreams/:id/analyze`. Errors are `{ error: { code, message } }` with
codes `validation_error`, `not_found`, `not_configured`, `analysis_running`,
`upstream_error`, `invalid_output`.

The analysis lifecycle is `none → running → done | failed`; rows interrupted by
a crash are failed on startup so a retry is always possible.

## Design

See `docs/superpowers/specs/2026-09-26-m1-core-dream-loop-design.md`.

## License

MIT
