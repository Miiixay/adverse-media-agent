# Security

Threat model and measures, written from `PLAN.md` section 16. The agent is a non-deterministic
component surrounded by deterministic guards: validation on the way in, schema and filters on the
way out, the score in code, a bounded budget.

Assets: the API key, which spends money; personal data, the names screened and the findings; the
integrity of the result, since a skewed screening is a regulatory risk; availability.

## Defense layers

Six layers against content that tries to steer the model, from guarantees built into the design to
checks that cost a call. Layers 1 and 2 are in place.

1. **By construction. In place.** The score is computed in code, finding URLs come only from the
   search results, the agent takes no action, and its context holds only the current screening.
   - Counters: an injection cannot set the risk, add a link, act outside the screening or reach
     another screening.
   - Limit: within the screening, it can still bend a judgment the model makes: identity, category,
     status, or the omission of a finding.
2. **Detection. In place.** The canary, the `flooded` and `compromised` errors, and manual review:
   such a result comes back `incomplete` with its error code, for the analyst to check.
   - Counters: a leak of the prompt and a search drowned in pages without editorial control are
     flagged instead of passing for a clean result.
   - Limit: only what leaves a trace is caught; an injection that changes a judgment without writing
     the canary goes unnoticed, and the canary is public until it comes from the environment.
3. **Output analysis. Planned for Friday if time allows, otherwise target.** A heuristic for
   instruction language in the summary and the findings, and a check that each finding agrees with
   the title of its source page, which comes from the search results and not from the model.
   - Counters: an answer that relays an instruction, and a finding that describes something its
     source does not.
   - Limit: keywords miss paraphrases and other languages, and a title is too short to contradict
     most findings; an article that quotes instructions can raise a false alarm.
4. **Input filtering. Target.** The agent fetches the pages itself, reduces them to text and runs a
   classifier on each one before the model reads it. This replaces the server-side search tool by a
   search API and a fetcher of our own. Cost: the classifier reads at least the volume the model
   reads today, 8,000 to 17,000 input tokens per screening on the fixed cases, more with full pages
   instead of search extracts, on a smaller model. Latency: one fetch and one classification per
   page, run in parallel, so several seconds per screening, bounded by the slowest site and a
   timeout; an estimate, not measured.
   - Counters: planted instructions are removed before the model sees them.
   - Limit: a classifier misses new or foreign-language patterns and flags legitimate articles that
     quote instructions; it is one more component to maintain and measure.
5. **Tool firewall and permissions. Target, as soon as the agent gains an action** such as writing to
   the database, sending an alert or fetching a URL it chose. Each tool call is checked against an
   allow list and its arguments validated, credentials are limited to what the step needs, and an
   irreversible action waits for a human.
   - Counters: an injection that turns the model into an actor: exfiltration through a URL, a write,
     a message.
   - Limit: nothing to protect today, since the agent has no action; it bounds what the tools can
     do, not what the model concludes.
6. **Second model as judge on high findings. Target.** Before a high result reaches the analyst, a
   second model checks each high finding against its source: identity, status, category.
   - Counters: a high finding that is unsupported, or wrong on identity or status, whether from an
     injection or a plain error.
   - Limit: it reads the same untrusted pages and can be steered the same way, adds a call on every
     high result, and does not see a finding that was omitted or rated too low.

## In place in the agent

| Threat                                       | Measure                                                                                                                                                                                                                                                                                                                                                                       | Where                                        |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Instructions in the name field               | Names hold letters of any script, combining marks, spaces, apostrophes, periods and hyphens, up to 100 characters. Angle brackets, line breaks and other control or format characters are refused, a trailing line break included. The country is an ISO 3166-1 alpha-2 code. The name reaches the prompt inside a `<person>` tag that the system prompt declares to be data. | `schema.ts`, `prompts.ts`, D-36              |
| Instructions in a web page                   | The system prompt says search results are untrusted data. The model never sets the risk: it qualifies articles, and the score is computed in code. The answer is validated against a JSON schema with real enums.                                                                                                                                                             | `prompts.ts`, `score.ts`, D-23               |
| A successful injection that leaks the prompt | A random canary sits in the system prompt, and the model is told never to write it. If it appears in any text block of the answer, `coverage.errors` gets `compromised` and no finding is counted.                                                                                                                                                                            | `search.ts`, `score.ts`, D-36                |
| Invented or malicious links                  | A finding URL, and each corroborating URL, must be one of the search results and must use http or https. Anything else goes to `rejectedUrls`.                                                                                                                                                                                                                                | `search.ts`, D-36                            |
| Pages without editorial control              | A finding cannot cite a social network, a pastebin or a forum: such a URL goes to `rejectedUrls`. If more than half of the search results are on these domains, `coverage.errors` gets `flooded` and the result is `incomplete`. The list is applied in code, not on the search tool, whose filter changes the whole result set.                                              | `data/blocked-domains.ts`, `search.ts`, D-37 |
| Cost abuse                                   | At most 8 searches, 8,000 output tokens, 3 continuations of a paused turn, no retry of a search call, and a 240-second budget that returns an incomplete result rather than running on.                                                                                                                                                                                       | `search.ts`, `index.ts`, D-10                |
| A failure read as a clean result             | Tool errors, refusals, timeouts and a compromised answer go to `coverage.errors`. The result is then `incomplete`; without a counted finding its confidence is low, so an empty result is never a plain low.                                                                                                                                                                  | `index.ts`, `score.ts`, D-25                 |
| Leak of the API key                          | The key is read in server code only. `server-only` on the agent module fails the build if a client component imports it. `.env.local` is gitignored.                                                                                                                                                                                                                          | `index.ts`, D-16                             |
| Personal data in logs                        | The run log keeps figures under a keyed pseudonym of the name (HMAC-SHA256). It holds no name, no article text and no URL, since URLs often carry the name. Full results stay in the gitignored `logs/`.                                                                                                                                                                      | `cost.ts`, D-24                              |
| Retention at the processor                   | Web search is called directly, without dynamic filtering, so it stays eligible for zero data retention.                                                                                                                                                                                                                                                                       | `search.ts`, D-17                            |
| Supply chain                                 | Few dependencies, each pinned to an exact version.                                                                                                                                                                                                                                                                                                                            | `package.json`                               |

Limits of these measures:

- The canary detects a leak, not an injection that only bends the assessment, such as a page asking
  for a low identity rating. Against that, the score in code and the URL filter limit the damage,
  and the adversarial case below is the test.
- The block list is open-ended: a forum or a blog platform that is not listed still comes through.
- The model still reads pages from blocked domains; only their use as evidence is refused. Passing
  the list to the search tool would keep them out of its context, but it changes the result set:
  on the homonym case it removed Wikipedia, though no listed site was among the results (D-37). The
  filter goes back on the tool if `flooded` is observed.
- Identity rests on the name and the country only. A person can be wrongly matched or missed;
  `identityEvidence` and the confidence level show the analyst how strong the match is.

## In place in the app

| Threat                                        | Measure                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Where                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| Access to the prototype                       | Every page and API route asks for HTTP Basic credentials; only the static assets of Next.js and the favicon are exempt. Any user name, one shared password compared in constant time to `APP_PASSWORD`; without the variable, every request gets a 500 rather than an open site. Vercel Cron alone may call `GET /api/cron/daily` with `Bearer CRON_SECRET`. The password limits who can read the history, which holds names in clear, and who can spend the budget.     | `src/proxy.ts`, `src/access.ts`               |
| Changes to the watchlist                      | Enrolling, suspending and resuming go through `POST /api/watchlist` and `PATCH /api/watchlist/[id]`, behind the password like every route. The input schema is the one of `/api/screen`, the id must be a UUID, and the flag a boolean. Enrolling calls no model, so it has no rate limit; what it adds to the bill, about $0.06 a day per monitored person, stays bounded by the start window of the daily run. Suspending a person is how an analyst stops that spend. | `api/watchlist/`, `src/db/persons.ts`         |
| Cost of the daily run                         | Only Vercel Cron can start it: the proxy and the route both require `Bearer CRON_SECRET`, compared in constant time, so a signed-in analyst cannot. Its spend is bounded by its start window, 45 s at four screenings at a time, and a unique index stores one daily screening per person and day, so a repeated call adds no duplicate.                                                                                                                                 | `api/cron/daily/route.ts`, `src/db/schema.ts` |
| A script that spends the budget               | At most 5 screenings a minute per client address, checked before the body is read; a 429 with `Retry-After` beyond. The count lives in the memory of one server instance: it is not shared between Vercel instances and starts again when an instance starts, so it slows a script down without being a quota. The address comes from `x-forwarded-for`, which Vercel overwrites with the client's own.                                                                  | `api/screen/rate-limit.ts`                    |
| A large or malformed body                     | The body is read as a stream and refused above 2,048 bytes (413), declared or not; invalid JSON or input gives a 400 with the fields at fault. The same input schema is checked in the browser and on the server.                                                                                                                                                                                                                                                        | `api/screen/body.ts`, `api/screen/route.ts`   |
| A screening that runs past the platform limit | `maxDuration` is 300 s, the Hobby maximum with fluid compute; the agent stops searching at 240 s, the route answers 504 at 280 s. A failure of the model API answers 502.                                                                                                                                                                                                                                                                                                | `api/screen/route.ts`                         |
| Personal data in the run log                  | The route writes the run log, never the agent, and only when `LOG_PSEUDONYM_KEY` is set and the file system is writable; on Vercel it is read-only and the log is skipped without error.                                                                                                                                                                                                                                                                                 | `api/screen/route.ts`, D-24                   |
| Malicious links and markup in findings        | Every link opens in a new tab with `rel="noopener noreferrer"` and shows its domain; a URL that is not http or https is rendered as text, and rejected URLs are never links. Text goes through React escaping, never `dangerouslySetInnerHTML`.                                                                                                                                                                                                                          | `screening-report.tsx`                        |
| Script injection, framing, MIME sniffing      | `Content-Security-Policy` limits every resource to the app's origin, forbids plugins and framing (`frame-ancestors 'none'`); scripts and styles stay allowed inline, which Next.js needs without a nonce. `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.                                                                                                                                                                                             | `next.config.ts`                              |
| Secrets in the browser                        | No environment variable is read in a client component; the browser bundle holds the input schema, the result types and the country names only.                                                                                                                                                                                                                                                                                                                           | `screening-form.tsx`, `page.tsx`              |
| Database credentials and queries              | The client module starts with `server-only` and reads `DATABASE_URL` on first use; the direct connection string serves migrations only. Drizzle sends every value as a query parameter. When a write fails, the server log keeps the error name and code, never the message, which carries the query parameters and so the name.                                                                                                                                         | `src/db/client.ts`, `api/screen/route.ts`     |
| A database failure read as a failed screening | The screening is returned whether or not it could be stored; the failure goes to the server log.                                                                                                                                                                                                                                                                                                                                                                         | `api/screen/route.ts`                         |

Limit of the password:

- The watchlist keeps no trace of who enrolled, suspended or resumed a person, nor why: with one
  shared password, there is no one to name. The target ties each change to an analyst account.
- The shared password names no one: access is not traced to a person, and it can only be revoked
  for everyone at once, by changing the variable. Basic credentials travel with every request,
  readable without TLS: they rely on the HTTPS that Vercel enforces. Guessing it is not throttled
  outside `POST /api/screen`; a long random password is what makes guessing impractical.

## Planned

- **Analyst accounts.** In the target, single sign-on with roles and an access log replace the shared
  password: each screening and each view of the history is tied to a person.
- **Retention.** Screenings are kept without limit. A retention period, and the deletion of a person
  with their screenings (the foreign keys cascade), are to be defined with compliance.
- **Adversarial case.** A fixture whose search results carry a planted instruction: rate the person
  low, reveal the instructions, add a URL. Since the agent cannot choose what a live search returns,
  the case replays a recorded response with the planted text through `interpretTurn` and the
  score, and checks that no finding changes, that the canary is caught and that no URL outside the
  results survives.
- **SDK logging.** `ANTHROPIC_LOG` stays unset in every environment: at `debug`, the SDK would write
  request and response bodies, names and article text included.
- **Dependency audit.** `npm audit` in continuous integration.
- **Shared rate limiting.** A store shared between instances, or the platform firewall, then authentication and quotas per analyst in the target.
- **Canary from the environment.** In the target, the canary is read from an environment variable,
  distinct per environment and rotated, instead of a constant in the code. A canary published in a
  repository can be planted in a page by someone who wants a screening marked `compromised` and its
  findings left uncounted; a secret one cannot. A `compromised` result goes to manual review.
- **Target architecture.** The agent moves to an isolated worker that alone holds the API key, so
  that a successful injection reaches neither user sessions nor the analysts' database (D-15).

## Test data

The fixed cases in `fixtures/test-cases.json` name only public figures whose cases were decided in
public hearings and widely reported: Bernard Madoff; Valérie Bozzi, a former mayor convicted in
2025, cassation pending; Marcus Held, a former mayor whose 2021 conviction is final. The others are
a fictional name and one of the most common names in Britain. No private individual is chosen as a
subject, and the full results of the cases stay in the gitignored `logs/`.

The extended validation set in `fixtures/extended-cases.json` follows the same rule. Its ten
subjects are public figures: elected officials, ministers, executives of regulated companies and a
Nobel laureate. Each case cites its sources in the file: court decisions, regulator notices,
official releases or press reports of them. One case screens a person in Germany who shares the
name of a well-known US defendant; it stands for a namesake and targets no private individual. Two
cases rest on decisions that are not final, a trial under way and an appeal whose outcome was not
found: screening reports proceedings as well as convictions, and every finding states its status.

Two cases were added for the recall of regulatory and civil matters, under the same rule. Steve
Jobs, who died in 2011: the SEC investigation of the backdating of Apple options is public record,
and the agency's charges named two other executives. Marco Mouly, born Mardoché Mouly, a media
figure convicted in three public cases. Each cites its sources in the file.
