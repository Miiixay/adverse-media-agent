# Adverse Media Agent

Adverse-media screening for individuals. Given a first name, a last name and a country, the
agent searches the web in the country's native language and in English, judges whether each
article is about the same person, qualifies the negative coverage, and returns a
`low | medium | high` risk with the URLs of the sources.

Built with Next.js (App Router) and the Anthropic TypeScript SDK, without an agent framework.
The agent lives in `src/agent/` and is called by the app as a plain function; nothing under
`src/agent/` depends on Next.js.

## Setup

Requires Node.js 24 and npm.

```
npm install
cp .env.example .env.local
```

| Variable               | Used by                | Purpose                                                               |
| ---------------------- | ---------------------- | --------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`    | the agent, server side | Claude API key                                                        |
| `LOG_PSEUDONYM_KEY`    | `screen`, `evaluate`   | Key of the HMAC that replaces names in `logs/runs.jsonl`              |
| `CRON_SECRET`          | `GET /api/cron/daily`  | Bearer token expected from Vercel Cron                                |
| `DATABASE_URL`         | the app                | Postgres connection string                                            |
| `QUERIES_PER_LANGUAGE` | measurements only      | `2` replays the v1 search plan, two queries per language; default `1` |
| `EFFORT`               | measurements only      | `high` replays the v1 effort; default `medium`                        |

Generate `LOG_PSEUDONYM_KEY` with:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

## Scripts

| Command                            | What it does                                                       |
| ---------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                      | Next.js dev server                                                 |
| `npm run lint`                     | ESLint                                                             |
| `npm run typecheck`                | `tsc --noEmit`                                                     |
| `npm run test`                     | Vitest, unit tests of the pure logic                               |
| `npm run format`                   | Prettier                                                           |
| `npm run screen -- Jean Martin FR` | One screening, printed as JSON and logged                          |
| `npm run evaluate`                 | Replays `fixtures/test-cases.json` and prints the comparison table |
| `npm run evaluate -- --extended`   | Replays `fixtures/extended-cases.json`, the wider validation set   |

`screen` and `evaluate` call the Claude API and cost money. They run with
`tsx --conditions=react-server`, the resolution condition of the Next.js server bundle, so that
the agent's `server-only` guard lets them through (D-16).

## Layout

```
src/agent/      the screening agent (prepare -> search -> judge -> score)
src/app/        Next.js pages and API routes
scripts/        CLI entry points (single screening, evaluation on the fixed cases)
fixtures/       the test cases replayed after every change
docs/           architecture, decision log, security model, evaluation
logs/           run logs (gitignored)
```
