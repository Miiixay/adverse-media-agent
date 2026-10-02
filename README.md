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

| Variable                | Used by                                  | Purpose                                                                                           |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`     | the agent, server side                   | Claude API key                                                                                    |
| `APP_PASSWORD`          | every page and API route                 | Shared password of the HTTP Basic prompt; without it, every request gets a 500                    |
| `LOG_PSEUDONYM_KEY`     | `screen`, `evaluate`, `POST /api/screen` | Key of the HMAC that replaces names in `logs/runs.jsonl`; without it, the route writes no run log |
| `CRON_SECRET`           | `GET /api/cron/daily`                    | Secret that Vercel Cron sends as `Authorization: Bearer`; at least 16 random characters           |
| `DATABASE_URL`          | the app                                  | Neon connection string, pooled                                                                    |
| `DATABASE_URL_UNPOOLED` | `db:migrate`                             | Neon connection string, direct, for migrations                                                    |
| `QUERIES_PER_LANGUAGE`  | measurements only                        | `2` replays the v1 search plan, two queries per language; default `1`                             |
| `EFFORT`                | measurements only                        | `high` replays the v1 effort; default `medium`                                                    |
| `MODEL`                 | measurements only                        | `claude-opus-5-5` replays the fixtures on Opus 5.5 (D-09); default `claude-sonnet-5-5`            |

Generate `LOG_PSEUDONYM_KEY` with:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Generate `APP_PASSWORD` the same way, and set it in `.env.local` and in the Vercel project.

### Signing in

The whole site, pages and API routes, asks for HTTP Basic credentials. The browser shows its
login dialog: any user name, and `APP_PASSWORD` as the password. From the command line:

```
curl -u analyst:$APP_PASSWORD -H "content-type: application/json" \
  -d '{"firstName":"Bernard","lastName":"Madoff","country":"US"}' http://localhost:3000/api/screen
```

Vercel Cron calls `GET /api/cron/daily` with `Authorization: Bearer $CRON_SECRET` instead.

## Scripts

| Command                            | What it does                                                         |
| ---------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                      | Next.js dev server                                                   |
| `npm run lint`                     | ESLint                                                               |
| `npm run typecheck`                | `tsc --noEmit`                                                       |
| `npm run test`                     | Vitest, unit tests of the pure logic                                 |
| `npm run format`                   | Prettier                                                             |
| `npm run screen -- Jean Martin FR` | One screening, printed as JSON and logged                            |
| `npm run evaluate`                 | Replays `fixtures/test-cases.json` and prints the comparison table   |
| `npm run evaluate -- --extended`   | Replays `fixtures/extended-cases.json`, the wider validation set     |
| `npm run db:generate`              | Writes a SQL migration in `drizzle/` from `src/db/schema.ts`         |
| `npm run db:migrate`               | Applies the migrations of `drizzle/` through `DATABASE_URL_UNPOOLED` |

`screen` and `evaluate` call the Claude API and cost money. They run with
`tsx --conditions=react-server`, the resolution condition of the Next.js server bundle, so that
the agent's `server-only` guard lets them through (D-16).

The database is a Neon Postgres created from the Vercel Marketplace, which sets both connection
strings. After `npm run db:migrate`, every screening run from the page is stored, and `/history`
lists them. A database that does not answer fails the record, not the screening.

## Daily cron

`vercel.json` schedules `GET /api/cron/daily` once a day at 05:00 UTC. The route re-screens every
monitored person of the watchlist and stores a screening of kind `daily` that keeps only the findings whose
URL is new for that person; `/history` marks these screenings and shows their new findings. It
answers with a JSON summary: persons screened, new findings per person, total cost, and the
persons skipped or not reached.

- **Idempotent within a UTC day.** A person already screened by a daily run that day is skipped,
  and a unique index refuses a second daily screening even when two calls run at once. A second
  call the same day stores nothing and says so in its summary. Two calls at the very same time
  both pay for their screenings; only one is stored.
- **Bounded by the function duration.** A screening may take up to 240 s and the function stops
  at 300 s, so new screenings start during the first 45 s only, four at a time: about 15 to 20
  persons per run at the usual 10 s per screening. The others come first the next day.
- **Cost.** About $0.06 per person and per day, at the measured mean.
- **Hobby plan limits.** Once a day at most; the call lands anywhere within the scheduled hour;
  a failed run is not retried, and delivery is best effort, so a day can be missed or delivered
  twice. The next run catches up, and the daily check absorbs a duplicate.

The proxy lets the cron through with its bearer secret, and the route checks it again: an
analyst signed in with the password cannot start the run. Vercel Cron does not run locally; call
the route by hand, which runs real screenings and costs money:

```
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/daily
```

## Watchlist

`/watchlist` lists every recorded person: monitoring on or off, and the date, risk and new
findings of their latest daily screening, with a link to their history. A button per row switches
monitoring on or off (`PATCH /api/watchlist/[id]` with `{"monitored": false}`), and the form at
the top enrolls a person without screening them now (`POST /api/watchlist`, the same validation
as `/api/screen`); the next daily run screens them. Monitoring is off by default: a screening
from the home page is one-shot, unless the analyst ticks **Add to daily monitoring**, which enrolls
the person through the same route once the screening has succeeded. Screening an enrolled person
again leaves their monitoring as it is.
Each monitored person costs about $0.06 a day.

## Layout

```
src/agent/      the screening agent (prepare -> search -> judge -> score)
src/app/        Next.js pages (screening, /history, /watchlist) and the API routes
src/db/         Drizzle schema and queries: persons, screenings, findings
drizzle/        SQL migrations, generated and committed
scripts/        CLI entry points (single screening, evaluation on the fixed cases)
fixtures/       the test cases replayed after every change
docs/           architecture, decision log, security model, evaluation
logs/           run logs (gitignored)
```
