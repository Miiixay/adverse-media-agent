# Adverse Media Agent

Screens an individual for adverse media in open sources, for compliance analysts: from a first name,
a last name and a country, it returns a low, medium or high risk with the source of every finding.
It does not check sanctions or PEP lists, and does not query commercial adverse-media databases.

## How it was built

Built in two days with Claude Code as a coding assistant, under the rules of a project file.
The design, every decision, the prompt, the reviews and the measurements are the author's.
Fifty-one decisions are recorded with their context and measurements in `docs/decisions.md`.

## Key choices

1. A workflow in plain TypeScript, not an agent framework (D-01).
2. The risk is computed in code by a fixed grid, never by the model (D-04).
3. A finding URL must be one of the search results (D-13).
4. One query per language, with the name bound to each clause (D-39).
5. The web search tool is called directly, which keeps zero data retention possible (D-17).
6. A second search turn under an alias is decided in code (D-42).
7. A canary detects a leaked prompt; sites without editorial control are filtered in code (D-36, D-37).
8. Escalation to a stronger model is built and off by default (D-49).
9. Sonnet 5.5 was measured against Opus 5.5 and kept (D-09).
10. Every change is replayed on fixed cases, with usage and cost logged per run (D-24, D-27).

## Results

- 17/17 cases pass: fourteen public figures, two namesake cases, one fictional name.
- The model's own level is recorded beside the grid: it differed on 2 of 17 cases, always lower (D-51).
- Cost per screening: $0.134 in v1; now $0.072 on the same five cases, $0.086 on all seventeen.
- Kept: one query per language (−37%), prompt caching (−15%), medium effort (−18%), the alias turn.
- Rejected: dynamic filtering (+14%), page reads by the model, search operators, two queries per language, Opus by default (+105%). See `docs/evaluation.md`.

## Quick start

Requires Node.js 24, npm, a Claude API key and a Postgres database. `screen` and `evaluate` call the
Claude API and cost money.

```
npm install
cp .env.example .env.local            # fill it, see the variables below
npm run db:migrate                    # once, through DATABASE_URL_UNPOOLED
npm run dev                           # http://localhost:3000, password APP_PASSWORD
npm run screen -- Bernard Madoff US   # one screening, printed as JSON
npm run evaluate                      # the five fixed cases, with a table of results
```

## Environment variables

| Variable                | Role                                                             | Default                                                 |
| ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | Claude API key, read in server code only                         | required                                                |
| `APP_PASSWORD`          | Shared password of the HTTP Basic prompt on every page and route | required; unset, every request gets a 500               |
| `CRON_SECRET`           | Bearer secret that Vercel Cron sends to `GET /api/cron/daily`    | required for the daily run                              |
| `DATABASE_URL`          | Neon connection string, pooled, used by the app                  | required to store screenings                            |
| `DATABASE_URL_UNPOOLED` | Neon connection string, direct, used by `npm run db:migrate`     | required for migrations                                 |
| `LOG_PSEUDONYM_KEY`     | Key of the HMAC that replaces names in `logs/runs.jsonl`         | required by the scripts; unset, the route writes no log |
| `MAX_DAILY_SCREENINGS`  | Most screenings one daily run starts                             | `20`                                                    |

Measurement switches, read in `src/agent/config.ts`:

| Variable               | Role                                              | Default              |
| ---------------------- | ------------------------------------------------- | -------------------- |
| `QUERIES_PER_LANGUAGE` | `2` replays the v1 search plan                    | `1`                  |
| `EFFORT`               | `high` replays the v1 effort                      | `medium`             |
| `MODEL`                | Model of the screening                            | `claude-sonnet-5-5`  |
| `ESCALATION_MODEL`     | Model of a second screening after a signal (D-49) | unset: no escalation |

Generate secrets with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
Leave `ANTHROPIC_LOG` unset: at `debug`, the SDK logs request bodies, names included.

## Scripts

- `npm run dev`, `npm run build`: Next.js dev server, production build.
- `npm run lint`, `npm run typecheck`, `npm run format`: ESLint, `tsc --noEmit`, Prettier.
- `npm run test`: Vitest, unit tests of the deterministic steps, no network.
- `npm run screen -- <first> <last> <country>`: one screening; `npm run evaluate`: the five fixed
  cases, or with `-- --extended` the twelve others.
- `npm run db:generate`, `npm run db:migrate`: write a migration from `src/db/schema.ts`, apply them.

## Deployment

1. Create a Vercel project from the repository, framework preset Next.js.
2. Add a Neon database from the Vercel Marketplace; it sets both connection strings.
3. Set `ANTHROPIC_API_KEY`, `APP_PASSWORD`, `CRON_SECRET` and, if needed, `MAX_DAILY_SCREENINGS`.
4. Run `npm run db:migrate` once against that database, then deploy.

`vercel.json` runs the cron at 05:00 UTC, once a day without retry on the Hobby plan, with
`Authorization: Bearer $CRON_SECRET`. Pages and routes ask for any user name and `APP_PASSWORD`.

## Repository layout

```
src/agent/        the screening agent, independent of Next.js
  index.ts        screenIndividual: prepare, search, alias turn, score, report
  prepare.ts      languages, name variants, queries
  search.ts       the model call, result collection, source checks
  score.ts        the risk grid
  data/           country languages, negative keywords, blocked domains
src/app/          pages (screening, /history, /watchlist) and API routes
src/db/           Drizzle schema and queries: persons, screenings, findings
src/proxy.ts      HTTP Basic access and the cron bearer
drizzle/          SQL migrations
scripts/          screen.ts and evaluate.ts
fixtures/         five fixed cases and twelve extended cases
docs/             architecture, decisions, evaluation, security
```

## Documentation

- [`SPEC.md`](SPEC.md): the one-page specification.
- [`docs/architecture.md`](docs/architecture.md): deployment, state graph, interfaces, data model, target, next steps.
- [`docs/decisions.md`](docs/decisions.md): fifty-one decisions with their alternatives and measurements.
- [`docs/evaluation.md`](docs/evaluation.md): method, cases, results by version, measured dials.
- [`docs/security.md`](docs/security.md): threat model, defense layers, measures in place and in the target.

## Test data

The fixtures name only public figures whose cases were decided in public hearings and widely
reported, two namesake cases, and one fictional name. No private individual is
screened, and full results stay in the gitignored `logs/`.
