# Decision log

Why the agent is built the way it is. One entry per decision, written when the decision is
taken. Entries marked "decided by measurement" point to the tables in `docs/evaluation.md`.

### D-01 — Orchestrated workflow in code, not an autonomous agent or a framework

Date: 2026-10-01.
Context: AML screening. Results must be auditable, cost must be bounded, homonyms must be
handled explicitly.
Options: (a) an autonomous agent that plans and searches on its own; (b) a workflow in plain
TypeScript with targeted LLM steps; (c) an agent framework (LangGraph, Mastra, Vercel AI SDK).
Decision: (b). A state object, step functions, explicit conditions: the logic of a LangGraph
`StateGraph`, written directly.
Reasons: predictable control flow, each step measurable, score auditable, fewer tokens, nothing
hidden.
Consequences: more code, less magic. A framework would add checkpointing and resume,
asynchronous human-in-the-loop, declared branches and loops, parallelism, observability. Migrate
to (c) when the graph needs persisted state, resume on failure or complex loops.

### D-02 — TypeScript everywhere, one repository, modular monolith

Date: 2026-10-01.
Context: a Next.js app must call the agent, Vercel runs JavaScript natively, the deadline is
two days.
Options: (a) a Python agent as a separate service behind an HTTP API; (b) a TypeScript agent as a
module of the same repository, called as a function.
Decision: (b).
Reasons: one deployment, no second API to write and secure. The Anthropic TypeScript SDK has the
same capabilities as the Python SDK. The boundary is kept by construction (D-15).
Consequences: the agent must stay framework-agnostic to remain extractable later.

### D-03 — Deterministic in code, judgment in the LLM

Date: 2026-10-01.
Context: the LLM is a non-deterministic component. Compliance needs reproducibility, and every
token costs money.
Options: (a) let the model do everything: languages, queries, judgment, scoring; (b) split the
work: code does what is deterministic, the model does what needs judgment.
Decision: (b). Code: country to languages, name variants, negative keywords, query building, URL
validation, final score. LLM: running the searches, judging whether an article is about the same
person, qualifying each article (category, severity, status, date, source reliability).
Reasons: zero tokens for deterministic work, testable without network, the model is used only
where it beats code.
Consequences: language and keyword tables to maintain. The split is visible in the module layout:
`prepare`, `search`, `judge`, `score`.

### D-04 — Final risk computed in code, never by the LLM

Date: 2026-10-01.
Context: the risk level is what an analyst acts on. It must be explainable and stable across
model and prompt versions.
Options: (a) the model returns `low | medium | high`; (b) the model qualifies each article and a
deterministic grid in code aggregates the findings.
Decision: (b).
Reasons: deterministic and auditable, tunable without touching prompts, immune to instructions
found in web pages. The same findings always give the same risk.
Consequences: the grid in `score.ts` is the piece to defend and to tune against real results.
Every finding carries `countedInScore` so the analyst sees what drove the level.

### D-05 — Explicit identity resolution with a confidence level; `low` never counts

Date: 2026-10-01.
Context: common names return articles about other people. A false positive blocks a legitimate
customer, a false negative is a regulatory risk.
Options: (a) trust that the search results are about the person; (b) ask the model, per article,
whether it is the same person, with evidence and a confidence level, and count only `high` and
`medium`.
Decision: (b). `identityConfidence: high | medium | low` plus `identityEvidence[]`. Findings at
`low` are kept and displayed but excluded from the score. The global `confidence` is the minimum
over the counted findings.
Reasons: homonymy becomes explicit and visible. The analyst sees why an article was excluded. The
fixture "Jean Martin, FR" tests exactly this.
Consequences: more output tokens per article. `medium` and `high` results are still validated by
a human.

### D-06 — Claude's web search tool rather than a dedicated search provider

Date: 2026-10-01.
Context: the agent must search the open web in several languages. Claude offers a server-side web
search tool; dedicated search APIs, general or news-only, can also be called from code.
Options: (a) the `web_search` server tool, run by the API inside the model call; (b) a search API
called by our code, its results passed to the model, for instance as a client tool.
Decision: (a).
Reasons: one call searches and assesses (D-08), with no second vendor, key or contract. Searches are
billed with the call, $10 per 1,000 plus the tokens of their results. The tool takes `max_uses`,
`user_location` and domain filters, and stays eligible for zero data retention when called directly
(D-17). Its behaviour is measured on the fixtures like the rest of the agent.
Consequences: the engine cannot be tuned. It returns about ten results per query, has no date
filter, and search operators do not help (D-48); a quoted name binds to one term only, hence the
query form of D-39. A date window for the daily run and a news index need (b), next step 2 in
`docs/architecture.md`.

### D-07 — One call localized with `user_location`, not a native call and an international call

Date: 2026-10-01.
Context: the brief asks for the native language and English. `user_location.country` steers the
results of the whole call toward the country.
Options: (a) one call localized to the country, with a native query and an English query; (b) two
calls, one localized for the native queries and one without location for English.
Decision: (a), with (b) to measure if the native cases failed.
Reasons: (a) pays the fixed cost of a call once, writes one cached prefix, and lets one assessment
see the articles of every language together, so that one matter becomes one finding (D-22). (b)
doubles that fixed cost.
Consequences: the comparison was never needed: the native cases find their convictions through the
native query, and the seventeen cases pass with one localized call. Whether an English query
without location would add international coverage is not measured. Countries outside the language
table are searched in English without location.

### D-08 — One call searches and returns the structured assessment

Date: 2026-10-01.
Context: the model must run the searches, then return findings that fit a JSON schema. No page of
the docs says whether `output_config.format` works together with the web search server tool.
Options: (a) one call with web search and `output_config.format`; (b) two calls: search and a
text synthesis with citations, then a JSON extraction without tools, possibly on Haiku 4.5.
Decision: (a) for v1.
Reasons: a probe on 2026-10-01 showed the API accepts the combination: HTTP 200, JSON that fits a
schema with real enums, every finding URL among the search results, $0.067 for two searches.
Search results are read once. (b) sends the synthesis again to a second call, and its saving is
on output tokens, 14% of the probe's cost.
Consequences: two-step remains a v2 measurement. In structured mode the text block carries no
citations, so the source shown to the analyst is each finding's URL. `page_age` is a relative
"last updated" string, so a finding's date comes from the model's reading of the article.

### D-09 — Claude Sonnet 5.5 for v1, Opus 5.5 as the measured comparison

Date: 2026-10-01.
Context: the search step needs a model that supports web search with dynamic filtering (Claude
4.6+), judges identity reliably, and keeps the cost per screening bounded.
Options: (a) `claude-sonnet-5-5`, $2 / $10 per million input / output tokens; (b)
`claude-opus-5-5`, $4 / $20, the default the docs recommend, thinking always on; (c)
`claude-haiku-4-5`, $1 / $5.
Decision: (a) for v1. (b) is replayed on the fixtures to compare identity judgment against cost.
(c) is only a candidate for the JSON extraction call if two-step is adopted (D-08).
Reasons: half the price of Opus 5.5, 1M context, 512-token cache minimum, every tool feature the
pipeline needs. Haiku 4.5 cannot run dynamic filtering, needs a 4,096-token prefix to cache, and
its retirement commitment ends on 2026-10-15.
Consequences: decided by measurement, final numbers in `docs/evaluation.md`. Sonnet 5.5 rejects
a non-default `temperature`, assistant prefill and a forced `tool_choice`, so the request relies
on `tool_choice: auto` and structured outputs.
Measured on 2026-10-02 (`logs/comparison.md`): `MODEL=claude-opus-5-5` replays the fixtures on Opus
5.5, at the same effort and with the same prices in `cost.ts`. Opus with prompt v13 against Sonnet
with v12, on the five fixed cases, Jobs and Mouly, one query per language and one run each. The two
prompts differ by the definition of `investigation`, which bears on none of the points below.

- Risk: the same seven levels.
- Counted findings: 10 and 10. Opus adds a November 2025 investigation into Valérie Bozzi's circle,
  and reports a relative of Madoff and one of Bozzi as associates, uncounted; Mouly's
  money-laundering investigation does not come back as a finding.
- Alias: Opus searched "Marco Mouly" itself, in two free searches, so the code's second turn did
  not run. Sonnet ran no free search in any case, and Madoff's nickname went to the code's second
  turn under both models.
- Wikipedia: Rennes 2026 is a finding under both; Opus's summary adds two suspended sentences, from
  1993 and 2019, without a finding for either.
- Dates: Opus dated Held's conviction to its finality, April 2023, which no Sonnet run had found
  (2021, 2021-09, 2022), and Mouly's matters to the day and to their latest stage. Madoff's
  conviction moved from the sentence to the plea, as it already does between Sonnet runs.
- Cost: $0.5741 to $1.1767 for the seven cases (+105%), $0.082 to $0.168 per screening; durations
  up to 34 s instead of 17 s.

The criterion set beforehand, two of four points improved without a change of risk, is met on the
alias and the dates, with the Wikipedia matters improved in the summary only.

### D-10 — Search and output limits, retries and time budget

Date: 2026-10-01.
Context: the cost and the duration of a screening must be bounded, and the synchronous API route
runs under the 300 s limit of Vercel's Hobby plan.
Options: the SDK defaults (two retries, a 10-minute timeout, no cap on searches), or explicit
limits.
Decision: `max_uses` = `MAX_SEARCHES` = 8, two of them left to the model (D-20); `max_tokens` =
8,000; at most 3 continuations of a paused turn; `maxRetries: 0` on the search call; one budget of
240 s for the whole turn, each request getting what remains of it. A timeout becomes a `timeout`
coverage error and the result is incomplete.
Reasons: a retried request whose answer never arrived would run and bill its searches again. 240 s
leaves 60 s for scoring and the response. The first Madoff run used 2 searches and 2,522 output
tokens, well under both caps.
Consequences: in recall, a person with many matters can exhaust the searches, which shows as
`max_uses_exceeded`. A transient 429 or 5xx fails the screening at once instead of being retried.
The usage of a request cut by the timeout is unknown although it may be billed. The values are
revisited with the v2 measurements.

### D-11 — Synchronous screening in the prototype, a job queue in the target

Date: 2026-10-01.
Context: a screening takes 5 to 12 s on the fixed cases, up to about a minute with a second turn.
On the Hobby plan Vercel stops a function after 300 s with fluid compute.
Options: (a) the API route waits for the screening and returns it; (b) the route queues a job, with
Inngest, QStash or Trigger.dev, and the page polls or receives a webhook.
Decision: (a) in the prototype, (b) in the target.
Reasons: (a) needs no queue service, no job table and no polling, and a one-shot screening fits the
function limit. The agent stops searching at 240 s and returns an incomplete result, and the route
answers 504 at 280 s, so a slow screening never ends in a platform timeout (D-10).
Consequences: the daily run inherits the limit: it starts screenings in its first 45 s only, 15 to
20 persons, capped by `MAX_DAILY_SCREENINGS`. Monitoring beyond that, retries and a status per case
need the queue (`docs/architecture.md`, section 5).

### D-12 — A minimal database, built last in the prototype, complete in the target

Date: 2026-10-01.
Context: the brief asks for a list of individuals and a daily check. The agent is what is
evaluated; the database serves the history and the daily delta.
Options: (a) no database, results in logs only; (b) a minimal schema, added once the agent was
measured and the app deployed; (c) the target model from the start: watchlist with owners, analyst
decisions, audit log, retention.
Decision: (b). Postgres on Neon through Drizzle, three tables, `persons`, `screenings` and
`findings`, every run stored, a `/history` page, then the daily cron with its delta on URL hashes.
Reasons: the agent's design came first and storage after. Three tables make the list and the daily
delta demonstrable. Neon comes from the Vercel Marketplace with its connection strings set, and
Drizzle keeps the schema typed and the migrations in SQL.
Consequences: the database is a record, not a dependency: a failed write is logged and the
screening is returned anyway. The classifications of a finding are text typed in TypeScript, since
the agent's schema still changed. The target adds a watchlist with owner and frequency, analyst
decisions, an audit log and a retention period.

### D-13 — Web content is untrusted data

Date: 2026-10-01.
Context: the model reads search results anyone can write. A page can carry instructions: rate this
person low, reveal the prompt, add a link.
Options: (a) rely on the model's own resistance; (b) treat every page as data and bound what the
answer can do.
Decision: (b), in three places. The system prompt declares search results untrusted and tells the
model to ignore any instruction in them; the name reaches the prompt inside tags declared as data.
The answer is validated against a JSON schema with closed enums. Every finding URL must be one of
the search results; any other goes to `rejectedUrls`.
Reasons: a prompt rule alone does not stop an injection. The schema bounds the form of the answer,
the URL check removes invented or planted links, and since the score is computed in code, the model
never sets the risk (D-04).
Consequences: an injection can still bend a judgment within a screening: an identity, a status, an
omitted finding. The detection measures came with D-31, D-36 and D-37; the six defense layers are
in `docs/security.md`.

### D-14 — Out of scope on purpose: transliteration, sanctions and PEP lists, accounts, alerts

Date: 2026-10-01.
Context: two days, and an evaluation of the agent's construction, quality and optimization.
Options: (a) build each of these partly; (b) leave them out and say so.
Decision: (b). Transliteration: a name is searched as typed and without diacritics, in no other
script. Sanctions and PEP lists: a separate screening step with its own data, not adverse media.
Authentication and roles: one shared password protects the deployed prototype, with no accounts.
Alerts: new findings show in `/history` and in the daily summary, and nobody is notified.
Reasons: each needs its own data, provider or accounts, and none changes how the agent searches and
judges. Built halfway, each would hide its real cost.
Consequences: all four are next steps or backlog items in `docs/architecture.md`: sanctions and PEP
lists through an API such as OpenSanctions, analyst accounts with roles, notification on change,
transliteration.

### D-15 — Modular monolith now, isolated worker later; the boundary is one JSON contract

Date: 2026-10-01.
Context: the agent processes untrusted web content and holds the API key. Next.js serves the UI.
Options: (a) agent code mixed with the app, imports across layers; (b) agent as a server-only
module with a single exported function; (c) a separate service from day one.
Decision: (b). Nothing under `src/agent/` imports from `next/*` or `src/app/`. The module exports
`screenIndividual(input)` and the only thing crossing the boundary is
`ScreeningInput -> ScreeningResult`. `import 'server-only'` fails the build if a client component
ever imports the agent, and an ESLint `no-restricted-imports` rule enforces the direction.
Reasons: (c) costs a second deployment and an API for a two-day prototype; (a) turns extraction
into a rewrite. The key never reaches the client bundle: no `NEXT_PUBLIC_` prefix, server-side
execution only.
Consequences: in the target architecture the agent becomes a worker (blast radius, least
privilege, execution profile, lifecycle) without rewriting. Next.js submits jobs and reads results.

### D-16 — Running the agent from the CLI with `tsx --conditions=react-server`

Date: 2026-10-01.
Context: `server-only` throws on import unless the module is resolved under the `react-server`
export condition, so `npx tsx scripts/screen.ts` would crash at start-up.
Options: (a) run the scripts with `tsx --conditions=react-server`, the condition Next.js applies
to its own server bundle, under which `server-only` resolves to a no-op; (b) drop `server-only`
and rely on the ESLint rule alone; (c) keep the guard in a wrapper file and let the scripts import
the implementation directly.
Decision: (a).
Reasons: the guard stays at the module entry point where it protects. The scripts run under the
same resolution condition as production. (c) opens a side door, (b) loses the build-time
guarantee.
Consequences: the npm scripts `screen` and `evaluate` carry the flag, documented in the README.

### D-17 — Web search called directly in v1, dynamic filtering measured in v2

Date: 2026-10-01.
Context: from `web_search_20260209` on, dynamic filtering is on by default: Claude runs the
searches from code execution and filters the results before they enter the context.
Options: (a) keep the default; (b) `allowed_callers: ["direct"]` on `web_search_20260318`; (c)
the basic `web_search_20250305`.
Decision: (b).
Reasons: results arrive as flat top-level `web_search_tool_result` blocks, so collecting and
validating URLs stays simple. The docs warn that for a few searches on a first turn, the container
and script overhead can exceed the savings. Dynamic filtering runs on code execution containers
kept up to 30 days and is not ZDR-eligible; direct calls are. (c) would tie a later switch to a
change of tool version.
Consequences: measured on 2026-10-01 (v2.1 in `docs/evaluation.md`), dynamic filtering left every
risk and counted finding unchanged and cost 14% more on the three fixtures, $0.3711 to $0.4244:
+44% and +42% on the two cases with two searches, -8% on the case with five or six, within the
run-to-run noise. Durations went from 7-12 s to 19-24 s, and output tokens rose because the model
writes the filtering code. Direct calls stay: cheaper at this number of searches, and the only
mode eligible for zero data retention, which a regulated institution may require. The collector
already reads searches run from code execution, so the switch can be measured again if the number
of searches per screening grows, for instance in daily monitoring.

### D-18 — Hand-written JSON schema with real enums, validated with zod on the client

Date: 2026-10-01.
Context: the model's output must fit the `Finding` contract. Category, severity and status are
closed sets that the score reads.
Options: (a) a zod schema converted by the SDK helper `zodOutputFormat` and sent with
`messages.parse`; (b) a JSON schema written by hand in `schema.ts`, sent as is in
`output_config.format`, the response validated by a zod schema; (c) no constrained decoding,
prompt instructions only.
Decision: (b), sent with `messages.create`, the JSON read from the last text block.
Reasons: in SDK 0.130.0 the helper folds `enum` into the `description` string, so the grammar
would not constrain the closed sets, while the API supports `enum` natively. `messages.parse`
parses every text block and throws on the first one that is not JSON, and the model often writes
a sentence before searching. Client-side zod keeps a runtime check. The API does not guarantee
enum casing, so values are compared case-insensitively.
Consequences: two schemas describe one shape. Both are built from the same `as const` value lists,
so the enums cannot drift. Schema limits apply: `additionalProperties: false` on every object, at
most 24 optional and 16 nullable parameters, no personal data in the schema itself.

### D-19 — Search in the languages of the national press, not every official language

Date: 2026-10-01.
Context: `prepare` searches in each country's languages plus English, and every language costs
searches out of a fixed budget.
Options: (a) every official language at national level; (b) the languages in which a national
press publishes at scale.
Decision: (b). German in Belgium, Romansh in Switzerland, Luxembourgish and Irish are left out.
Reasons: adverse media is written where the press is. (a) would take Switzerland to 10 queries,
over the search budget, for languages with little press coverage.
Consequences: a person covered only by a minority-language outlet can be missed. The criterion is
written next to the table in `country-languages.ts`, so any entry can be challenged.

### D-20 — Part of the search budget is left to the model

Date: 2026-10-01.
Context: `MAX_SEARCHES` caps the web search tool at 8 uses. The prepared queries use part of it,
and the model needs a few searches of its own to settle an identity doubt or try another form of
the name.
Options: (a) plan up to `MAX_SEARCHES`; (b) raise the cap for countries with three languages;
(c) keep `RESERVED_FREE_SEARCHES = 2` out of the plan and, when a country would exceed
`MAX_SEARCHES - 2`, merge the two queries of a native language into one, starting from the last
listed language.
Decision: (c).
Reasons: one constant bounds the cost for every country. The first listed language, which carries
the most press, keeps its two focused queries. English keeps its split because it covers the
international press.
Consequences: Switzerland runs one merged query in French and one in Italian instead of two each.
A test checks every country of the table against the budget, and `buildQueries` throws if a
future entry cannot fit even with every native language merged. `MAX_SEARCHES` lives in
`prepare.ts` because the plan is sized against it; `search.ts` reads it for `max_uses`.

### D-21 — No model fallback on refusal; a refusal is reported in `coverage.errors`

Date: 2026-10-01.
Context: Sonnet 5.5's safety classifiers can decline a request (HTTP 200,
`stop_reason: "refusal"`). Anthropic recommends a server-side fallback that answers with another
model.
Options: (a) server-side `fallbacks` (beta); (b) no fallback, the refusal surfaced as a coverage
error.
Decision: (b).
Reasons: a screening must be attributable to one model and one prompt version for audit. (a)
needs the beta client and its types, and the answering model would vary from one run to the next.
A refusal must be visible to the analyst, not absorbed.
Consequences: a refused screening returns no findings and an error with code `refusal`, never a
silent `low`; the analyst reruns or reviews manually. `max_tokens` and a turn still paused after
the last continuation are handled the same way.

### D-22 — One finding per matter, with corroborating URLs, at most 8 findings

Date: 2026-10-01.
Context: on the first real run, 10 of the findings about Madoff described the same conviction and
the output was 26% of the cost. The score's modulator "same facts reported by at least two
independent sources" needs to know which articles report the same facts.
Options: (a) one finding per article, corroboration inferred in code from matching category,
status and date; (b) the model groups the articles that report the same facts into one finding,
with up to 3 `corroboratingUrls`; (c) no grouping and no corroboration modulator.
Decision: (b), with `MAX_FINDINGS = 8` stated in the prompt.
Reasons: telling whether two articles report the same facts needs reading them, which is
judgment. Fewer findings mean fewer output tokens. Code still checks every corroborating URL
against the search results, like the main URL.
Consequences: structured outputs do not support `maxItems`, so the grammar enforces neither
limit. A longer findings list is kept, since its tokens are already paid; corroborating URLs are
cut to 3 after filtering. Independence is approximated by distinct domains in `score.ts`, so two
sites of one organization count once, but a wire story syndicated on several sites counts as
several sources.

### D-23 — Scoring grid: precedences and gaps settled

Date: 2026-10-01.
Context: implementing the grid of `PLAN.md` exposed overlaps and gaps: an acquittal in a critical
category, an old minor matter, a minor conviction, a conviction at medium identity, a rule made
redundant by another, and the confidence of a result that holds only homonyms.
Options: apply the grid literally and accept the odd cases, or rule on each case once and test it.
Decision: acquittals and old minor matters are low before any other rule. A conviction at high
identity is high when its severity is critical or moderate, medium when minor; a critical category
at high identity stays high whatever the severity. A conviction at medium identity is medium in
any category. The rule "recent allegation in a critical category" is removed: any counted critical
finding is already medium, and recency acts as a modulator. Two modulators out of three raise a
finding one level, and a medium identity caps at medium. With no counted finding, confidence is
low when coverage is incomplete, medium when uncounted findings fall in a critical category, high
otherwise.
Reasons: an analyst must be able to predict the level of any finding. Modulators make the facts
more credible, not the identity. With only a name and a country, a homonym hit in a critical
category cannot be ruled out.
Consequences: each rule has a test in `score.test.ts`, and the grid in `PLAN.md` section 4 states
the same rules as the code.

### D-24 — The run log is written by the callers, without names, under a keyed pseudonym

Date: 2026-10-01.
Context: every run appends a line to `logs/runs.jsonl`. The summary, the findings, the queries
and the URLs all contain the screened person's name. On Vercel, the filesystem is read-only
outside `/tmp`.
Options: (a) the agent writes the log; (b) the agent returns the result and its callers log it.
For the subject: a plain hash, a keyed hash (HMAC-SHA256), or nothing.
Decision: (b), with an HMAC-SHA256 of the name and country under `LOG_PSEUDONYM_KEY`. A line keeps
counts, error codes, usage, cost and duration, and no text from the result.
Reasons: (a) breaks on Vercel and ties the agent to a filesystem. A plain hash of a name is
reversed by hashing candidate names. The pseudonym still groups the runs of one person for the
v1 / v2 comparison.
Consequences: `screen` and `evaluate` refuse to start without the key, before any API call. The API
route will log the same entry to standard output.

### D-25 — A top-level `status: complete | incomplete` in the result

Date: 2026-10-01.
Context: an empty low result can mean that nothing exists or that the search failed. A fake low is
the failure to avoid.
Options: (a) leave integrators to read `coverage.errors`; (b) a fourth risk value, `undetermined`;
(c) a `status` next to the risk.
Decision: (c).
Reasons: the risk keeps its three values and the grid is unchanged. An integrator who reads only
the top of the result still sees that it is incomplete. A partial result keeps what was found: a
high finding seen before a timeout stays high.
Consequences: the result is incomplete when a planned query did not run or anything other than
`max_uses_exceeded` failed. The UI must show the status before the risk.

### D-26 — The result says how many articles were reviewed

Date: 2026-10-01.
Context: the first evaluation returned no finding for the homonym case, and nothing in the result
told "the searches brought nothing back" from "they brought articles, none of them negative". An
empty result is not a clean one.
Options: (a) leave the answer to the logs; (b) list every article reviewed in the result; (c) a
count, `coverage.articlesReviewed`.
Decision: (c).
Reasons: the analyst sees at once how much was read behind an empty result. A full list would
multiply the size of the result and of the page. The count is free to compute.
Consequences: the articles themselves stay out of the result. For diagnosis, `evaluate` saves the
full result of each fixed case in `logs/evaluation/`, and the run log keeps the count.

### D-27 — Public figures as test data; Jean Martin replaced by David Smith

Date: 2026-10-01.
Context: the fixed cases are replayed after every change, with known expected results, and they
name real people.
Options: (a) private individuals found in the press; (b) public figures whose cases were decided in
public hearings and widely reported, plus a fictional name and a very common name.
Decision: (b). Bernard Madoff for a known high, a fictional name for a clean result, and a common
name for namesakes. The homonym case first used Jean Martin, FR, and was replaced by David Smith,
GB.
Reasons: screening a private person for a test would process data on offences with no purpose. The
Jean Martin run returned 36 articles and no namesake with negative coverage, because French judicial
reporting rarely names ordinary defendants in full: the case no longer tested identity resolution.
British court reporting names defendants, so namesakes of David Smith with convictions come back and
must be rated low.
Consequences: the native cases and the extended set follow the same rule (`docs/security.md`, Test
data). The homonym case expects at least one namesake at low identity and no counted finding.

### D-28 — Each finding says who it is about; a finding about an associate never counts

Date: 2026-10-01.
Context: in the native-only measurement, an article about the screened mayor's partner, with
"association only" in its evidence, came back at medium identity and was counted. The prompt asked
for a low rating; the model followed it in one run out of two.
Options: (a) rely on the prompt; (b) match "association only" in `identityEvidence` in code; (c) a
schema field `subject: person | organization | associate`, with associate findings never counted
in `score.ts`.
Decision: (c).
Reasons: who an article is about is a fact the model reads, and the grammar makes it state it for
every finding. Excluding a kind of finding from the risk is a scoring rule, so it belongs to code,
where it is deterministic and tested. (b) would depend on free text.
Consequences: associate findings stay visible to the analyst. A finding about an organization
counts like one about the person, through its identity confidence. The homonym rule of D-23 ignores
associate findings, which are not homonyms. Runs from v2.2 final on carry the new schema.

### D-29 — Prompt caching on the static prefix

Date: 2026-10-01.
Context: every screening sends the same system prompt and output schema, and the server-side search
loop rereads the prefix and the earlier search results at each iteration.
Options: (a) no caching; (b) top-level automatic caching; (c) an explicit breakpoint on the last
static block.
Decision: (c), on the system block. The tool definition comes first and carries `user_location`,
so a breakpoint on it would cover a few hundred tokens that vary by country. (b) would place the
breakpoint on the user message, which changes with every screening.
Reasons: measured on the five cases (v2.3 in `docs/evaluation.md`): −15%, $0.4220 to $0.3573, with
the same searches and results. The saving comes from reads inside each turn at a tenth of the input
price, including the search results that the API caches between iterations once a breakpoint
exists.
Consequences: the prefix, about 4,900 tokens, is written at 1.25 times the input price by every
screening that does not find it warm. It is shared only between screenings of one country within
five minutes, so a daily batch should group screenings by country (about $0.011 saved per warm
hit). Effort and thinking settings stay fixed, since changing them invalidates the cache.

### D-30 — The search runs at medium effort

Date: 2026-10-01.
Context: Sonnet 5.5 defaults to high effort. Effort steers every output token, tool calls included.
Options: (a) high, the default; (b) medium; (c) low.
Decision: (b).
Reasons: measured on the five cases (v2.4 in `docs/evaluation.md`): −18%, $0.3573 to $0.2919,
output tokens −26%, every planned query executed, same risks and counted findings. The clean case
skipped the free search that made its cost vary. (c) was not tested: the docs state that lower
effort means fewer tool calls, and a screening must run all of its planned searches.
Consequences: fewer free searches. On a truly ambiguous identity, the model may skip the search that
would settle it, a situation the fixtures do not cover; the completeness check catches a skipped
planned query, not a skipped free one. The value is a constant, since changing it invalidates the
cache.

### D-31 — Four deterministic defenses around the model

Date: 2026-10-01.
Context: the prompt rule, the schema and the URL check (D-13) bound what an injection can do, but
nothing detected one, the name fields accepted any character, and any URL scheme or site could be
cited if the search returned it.
Options: (a) leave the defenses as they were; (b) add checks in code that cost no call; (c) a
classifier or a second model on the pages or the answer, at the price of a call.
Decision: (b), four checks: a canary in the system prompt that marks the result `compromised` if it
comes back; strict validation of the name fields; http and https as the only accepted URL schemes;
a block list of sites without editorial control.
Reasons: none costs a call or a token, and each is tested without network. (c) stays a target, as
layers 4 and 6 of `docs/security.md`.
Consequences: D-36 details the four measures and their first measurement. D-37 moves the block
list from the search tool to code, after the tool filter changed the whole result set, and adds the
`flooded` error.

### D-32 — An allegation alone starts at medium; any official step is high

Date: 2026-10-01.
Context: the grid gave high to any matter in a critical category at high identity, whatever its
status. The extended validation showed it on an ongoing trial, and the same rule applied to a press
allegation without any official step.
Options: (a) keep high for every status; (b) medium for investigations and allegations; (c) high
from the first official step, investigation, indictment, conviction or sanction, and medium for an
allegation alone, raised to high by two modulators.
Decision: (c). An unclear status stays high, the cautious reading when the article does not say;
an acquittal stays low.
Reasons: an official step means an authority found grounds to act, a press allegation does not.
Corroboration by other outlets, a reliable source or recency still take an allegation to high. The
trial of Daniela Santanchè stays high.
Consequences: one test per status in `score.test.ts`, and `PLAN.md` section 4 states the rule.
Each finding now exposes `riskLevel`, the level it gives the risk, null when it is not counted, so
the analyst sees which finding drives the result.

### D-33 — A status for final administrative and regulatory decisions

Date: 2026-10-01.
Context: in the extended validation, the FCA ban on Jes Staley came back as `unclear` in one run and
as `conviction` in the other, and an ineligibility pronounced by the Constitutional Council as
`conviction`. The risk then depended on an arbitrary label.
Options: (a) leave the model to choose among the existing statuses; (b) a status `sanctioned` for a
final administrative or regulatory decision against the person (fine, ban, ineligibility, listing
on a sanctions list), treated by the grid like a conviction.
Decision: (b).
Reasons: for an analyst, a final decision of a regulator or an administrative body is as settled as
a verdict. Naming it removes the arbitrary choice between two wrong labels.
Consequences: a sanction of critical or moderate severity at high identity is high in any category,
like a conviction; a minor one is medium. The schema describes the status, and the prompt has to
define it as well.

### D-34 — A finding about an organization is capped at medium

Date: 2026-10-01.
Context: in the v3 validation, a BaFin fine on N26 came back as a finding with `subject:
organization`, status `sanctioned`, moderate severity, at high identity. The grid rated it high,
twice over: a final sanction of moderate severity counts like a conviction (D-33), and three
modulators held. The risk of the co-founder was then high on a fine against the bank, with no case
against him personally.
Options: (a) leave organization findings on the grid of the person; (b) never count them, like
associates (D-28); (c) count them, capped at medium.
Decision: (c).
Reasons: a matter of an organization the person leads is relevant to an analyst, so it must weigh
on the risk; it does not establish the person's own part in it, which is what high means. The cap
works like the one on medium identity: modulators make the facts more credible, not the person's
involvement.
Consequences: three tests in `score.test.ts`. Replayed on the archived v3 results, only the
organization case changes, from high to medium, which the fixture accepts. A person charged or
convicted in the same matter gets a finding of their own, with `subject: person`, and the cap does
not apply to it.

### D-35 — A language tag in front of an executed query does not make the coverage incomplete

Date: 2026-10-01.
Context: the user message lists each planned query after its language tag, `[pl] "Józef Pinior" ...`.
In one run out of about forty-five, the model copied the tag into the four queries it ran. Every
planned query ran, but the exact comparison missed them, and the result came back `incomplete` with
no error.
Options: (a) change the user message so that it shows no tag next to the query, a prompt change;
(b) compare after removing a two-letter tag in brackets at the start of the executed query; (c)
compare loosely, ignoring case, punctuation or extra words.
Decision: (b).
Reasons: the tag is the only change observed, and the search engine runs the same query with or
without it. A loose comparison would also accept a query the model rewrote, which is the case the
check exists to catch. The prompt stays unchanged.
Consequences: `executedQueries` keeps the queries as the model ran them; only the comparison removes
the tag. Two tests in `score.test.ts`: a tagged query counts as run, any other change does not.
Replayed on the archived result, the coverage is complete.

### D-36 — Four defenses around the model: canary, strict input, web URLs only, blocked domains

Date: 2026-10-01.
Context: the model reads pages anyone can write and returns text that the interface will render.
The existing guards were the rule that web content is data, the schema-validated output, URLs
filtered on the search results, and a score computed in code. They did not detect an injection that
succeeded, nor stop a `javascript:` link or a line break at the end of a name.
Options: for detection, (a) nothing beyond the prompt rule, (b) a canary in the system prompt, (c) a
second model call that audits the answer; for sources, (a) no filter, (b) a block list, (c) an
allow list of outlets.
Decision: four deterministic measures. (1) A random canary in the system prompt, which the model is
told never to write; if it appears in any text block of the answer, the error `compromised` goes to
`coverage.errors` and no finding is counted (`untrustedScore`). (2) Names refuse control characters,
line breaks included, before trimming, on top of the letter-only pattern and the 100-character
limit. (3) A finding URL or corroborating URL must use http or https; any other scheme goes to
`rejectedUrls`, even when it came back as a search result. (4) `blocked_domains` on the search tool:
social networks, pastebins and forums, listed in `data/blocked-domains.ts`.
Reasons: each measure is code, testable without the network and free per screening. An audit call
would double the cost and is itself exposed to the injection it audits. An allow list would cut the
regional outlets that carried the native-language cases (`docs/evaluation.md`); a block list removes
pages without editorial control, where rumours and planted instructions are most likely.
Consequences: prompt `v6`. The canary detects a leak, not an injection that only bends the
assessment; the adversarial case planned in `docs/security.md` is the test for that. A compromised
result is reported low at low confidence and incomplete, like any blocking error, with its findings
visible and uncounted. On the five fixed cases, run once with the four measures: 5/5, no finding
expected lost, no false `compromised`. Wikipedia, which is not on the list, returned no result in
any case, against 22 URLs read in the previous run. Replayed on the homonym case, the cause is the
filter itself: with the full list or without the forums, the same result set without Wikipedia;
without the list, the result set of the run before it (see `logs/comparison.md`).

### D-37 — Blocked domains are filtered in code, not on the search tool

Date: 2026-10-01.
Context: with `blocked_domains` on the search tool (D-36), the search returned a different result
set, not the same set minus the listed sites. On the homonym case, the full list and a list without
the forums both returned ten URLs without Wikipedia; without the list, the result set of the run
before it came back, Wikipedia included. None of the 71 URLs read on the five fixed cases before the
list was on it. On those cases, the filter blocked nothing observed and removed 22 Wikipedia pages,
which the model uses to tell namesakes apart.
Options: (a) keep the filter on the tool and accept the loss; (b) drop the list; (c) keep the list
and apply it in code to the finding URLs, with a guard for a search that returns mostly blocked
pages.
Decision: (c). A finding URL or corroborating URL on a blocked domain goes to `rejectedUrls`, like a
URL outside the results or with another scheme. When more than half of the search results are on
blocked domains (`MAX_BLOCKED_SHARE`), `coverage.errors` gets `flooded` and the result is
`incomplete`.
Reasons: the code filter keeps the guarantee that no social network, pastebin or forum serves as
evidence, without changing what the search returns. The model can read those pages again, so the
injection surface is no longer reduced upstream; the canary, the score in code and the URL filter
remain. The guard makes the one case where the tool filter would matter visible: a name whose
results are mostly such pages.
Condition for going back: the filter returns to the search tool if `flooded` is observed in the
runs, on the fixed cases, the extended cases or in production logs. The run log keeps the error
codes, so the condition can be checked without names.
Consequences: five tests in `search.test.ts` and one in `score.test.ts`. On the five fixed cases,
run once: 5/5, Wikipedia back with 22 URLs, as many as before the list, no URL rejected, no
`flooded`.

### D-38 — Regulatory and civil terms in the merged query

Date: 2026-10-01.
Context: the query of each language held only criminal vocabulary: the first term of each offence
category and the proceedings terms. Regulatory and civil matters, which the categories `regulatory`
and `civil_litigation` are there to report, were found only when an article also used a criminal
word. Two real cases showed it, among them the SEC investigation of Apple's option backdating,
which named Steve Jobs and did not come back in nine URLs.
Options: (a) a third group of terms per language, appended to the merged query; (b) a separate
regulatory and civil query per language, one more search each; (c) terms tied to each regulator,
such as SEC, FCA or BaFin.
Decision: (a). Each language gets four to six terms for an inquiry, a lawsuit, a fine, a supervisor,
a settlement where the word is unambiguous, and a scandal; a term already among the proceedings terms
is not repeated (`procès` in French, `Ermittlungen` in German, `rechtszaak` in Dutch). German uses
`Bußgeld`, the word of BaFin decisions and of the press, rather than `Geldbuße`. The two-query plan
replayed by `QUERIES_PER_LANGUAGE=2` is unchanged.
Reasons: no extra search and no extra cost; (b) would add a search per language, (c) does not scale
to seventeen languages and their regulators.
Consequences: the documentation of the search tool gives no maximum query length. The longest query,
English, grows from 174 to 248 characters and 38 words with a 14-letter name; none of the 17 cases
run returned `query_too_long`, and every case carries the English query. Measured on 2026-10-01
(`logs/comparison.md`): no risk changed on the fifteen earlier cases and every one passes; findings
not counted did not grow. The Jobs case still fails: on a famous name, the longer OR list brings
back pages about the terms themselves, because the quoted name does not bind them, and the model
used no free search to recover. The vocabulary widens recall where the name is rare; it does not
fix a famous name drowned by generic pages.

### D-39 — The name is repeated in every clause of the query

Date: 2026-10-01.
Context: the Steve Jobs case still missed the SEC backdating matter after D-38. Three probes of the
search tool, one query each (`docs/evaluation.md`, "Search engine query semantics"), showed that the
engine binds a quoted name only to the term that follows it: `"Name" a OR b OR c` reads as
`("Name" a) OR b OR c`. The agent's queries were unions of clauses without the name, and on a famous
name the clauses without it brought back pages about the terms. Grouping the terms in parentheses
changed nothing.
Options: (a) repeat the name in every clause, `"Name" t1 OR "Name" t2 ...`, with fewer clauses to
stay within the query limits; (b) one query per term, several searches per language; (c) keep the
form and rely on free searches.
Decision: (a). One query per language, clauses added in order of priority while the query stays
within 380 characters and 48 words: the first term of fraud, money laundering, corruption and
sanctions; the conviction and charge terms; the investigation, lawsuit and scandal terms. A long
name keeps fewer clauses; the first clause stays whatever its length. The keyword table carries the
roles by position, and three terms were added for them: `rinvio a giudizio` (Italian charge),
`aangeklaagd` (Dutch charge), `Ermittlungen` (German investigation). The two-query plan replayed by
`QUERIES_PER_LANGUAGE=2` keeps its two groups in the same repeated form.
Reasons: every clause then targets the person, at the cost of one search per language as before;
(b) multiplies searches, (c) spends the reserved searches on what the plan should do. The limits stay
under both figures found for the engine's query: 600 characters and 75 words in Brave's API
reference, 400 and 50 in older documentation; Anthropic documents `query_too_long` without a figure.
Reserve: terrorism, organised crime and violence are no longer searched as terms. A case in those
reaches the press through the conviction and charge terms, which are kept; an allegation in those
fields that has not reached a charge may be missed.
Consequences: the longest fixture name, Friederike Wenzlaff-Obermaier, keeps 8 of 9 clauses; the
Turkish query of Mehmet Hakan Atilla uses 47 of 48 words. Measured on 2026-10-01 together with
prompt v8, which allows a targeted free search (`logs/comparison.md`): the Jobs case finds the
backdating matter through the planned query alone, as a shareholder class action, but is rated high
where its fixture expects low; the Mouly case finds its two verified matters and loses a third,
reported by an encyclopedia only.

### D-40 — High is kept for critical categories and final decisions

Date: 2026-10-01.
Context: once D-39 found the Steve Jobs matters, the case came out high on two civil claims: a 2007
shareholder class action over the option backdating and the no-poach antitrust case, both
`civil_litigation` at status `allegation`. Two modulators, a reliable source and corroboration,
raised each from medium to high. A civil claim never decided weighed like a criminal charge, and
kept its weight for twenty years.
Options: (a) keep the grid; (b) cap moderate categories at medium and let old undecided claims fall
to low; (c) never count civil claims.
Decision: (b). High is reserved for critical categories and for final decisions (`conviction`,
`sanctioned`): modulators no longer take any other finding above medium. A finding of a moderate
category (`civil_litigation`, `regulatory`, `controversy`, `violence`) at status `allegation` or
`unclear`, dated more than `RECENT_YEARS` before the screening, is low.
Reasons: modulators measure how credible the facts are, not how grave; a claim nobody decided within
two years is history for an analyst, not a live risk. A regulatory sanction or a conviction keeps
reaching high in any category, and a recent claim stays visible at medium.
Consequences: five tests in `score.test.ts`, four earlier tests moved to a critical category, and
`PLAN.md` section 4. Replayed on the archived D-39 results, two levels change: the Jobs findings, then
undated, go from high to medium, and the JPMorgan suit against Jes Staley, dated 2023, from high to
low; no other risk changes. An undated claim stays at medium, since a missing date is neither recent
nor old: the Jobs case is low only when the model dates its findings, as it did in the run of
2026-10-01 (2007 and 2014).

### D-41 — Output schema ordered aliases, findings, summary: tried and rejected

Date: 2026-10-01.
Context: under constrained decoding, required properties are written in the order of the schema
(structured outputs documentation). The summary came first, and the Mouly runs showed summaries
naming matters that had no finding, against the prompt.
Tried: findings first and the summary last, with an `aliases` field first for the other names the
sources use; within a finding, identity evidence before identity confidence and the facts before the
summary; prompt `v10` with "Write the findings first; the summary describes the findings listed."
Measured once on 2026-10-01 on the five fixed cases, Jobs and Mouly (`logs/comparison.md`):

- the homonym case ran to the 8,000-token output cap and returned no assessment, cause not
  established, the result keeping no raw text;
- Mouly was not improved: one finding instead of two, and a summary still citing four matters
  without a finding, which it said rested on an encyclopedia only;
- Jobs proved unstable: the class action came back as `fraud`, undated, and high, where the run
  before had it as `civil_litigation`, dated, and low.
  The other cases were unchanged. The field order cannot steer the searches anyway, since the JSON is
  written after them: the alias Marco was recognized and not searched.
  Decision: rejected. The schema keeps the summary first and prompt `v9` is restored. The instability
  of the Jobs label led to D-43.

### D-42 — A second search turn under an alias

Date: 2026-10-01.
Context: the sources name Mardoché Mouly "Marco Mouly"; with the name bound to every clause (D-39),
pages that give only the alias never match, and his 2024 insolvency conviction was missed in every
run. The model reports the other names in `aliases` (D-44) but does not search them.
Options: (a) leave alias searches to free searches (prompt v9), which the model did not run; (b) a
second turn in code when the first alias was not queried; (c) an alias field in the input.
Decision: (b). When `coverage.aliases` is not empty and no executed query contains the first alias,
`index.ts` runs `searchAdverseMedia` again on a plan built from the alias, same country and so same
languages, within the remaining time budget, and only with at least 60 s left. One alias. The alias
is validated like a name typed in the form before it reaches the prompt: it comes from the model,
which read web pages. The two outcomes are merged: queries, errors, usage and calls are added,
`usage.apiCalls` is 2, and the coverage lists both plans. A second-turn finding is dropped when its
URL is already reported; when it has the same category, status and year as a first-turn finding,
it is taken for the same matter and its URL joins that finding's corroborating URLs, beyond the
usual cap of three. The same holds for two stages of one matter, same category and year, statuses
along allegation, investigation, indictment, then a final outcome: the finding at the later stage is
kept and the other URL joins its corroborating URLs. Two final outcomes, or a status with no stage
(`unclear`), are never matched. An undated finding is never matched either.
Reasons: the search is cheap next to a missed conviction; code decides when to search again, the
model only says which names the sources use. (c) would be the target, where an analyst knows the
aliases.
Consequences: measured on 2026-10-01 (`logs/comparison.md`): Mouly gains his insolvency conviction
and a money-laundering investigation, for $0.171 instead of $0.08. Two limits showed. The merge by
URL keeps one matter twice when the two turns cite it from different URLs (Mouly's carbon tax,
Madoff's conviction). And a well-known nickname triggers the second turn for nothing: "Bernie
Madoff" almost doubled the cost of the Madoff case and added a duplicate. The merge on category,
status and year now folds such duplicates. The trigger on a well-known nickname is left as it is:
about $0.04 more for a famous person known by a short name, the price of not missing an alias like
Mouly's. On the full regression of 2026-10-01, the second turn ran on five of seventeen cases: a
nickname, a full legal name, a maiden name, a spelling variant and Mouly's alias. It changed no
risk and gained three matters: Staley's 2018 FCA fine, a third indictment of Daniela Santanchè and
Mouly's money-laundering investigation. It raised the cost of the seventeen cases by 34%, the
costliest case reaching $0.24: accepted. Since then, an alias holding both the first and the last
name entered, compared word by word without case or accents, starts no second turn; replayed on that
run, the rule alone skips none of the five, since "James Edward Staley" does not hold "Jes". Prompt
v12 narrows the aliases to names the sources use instead of the legal name, excluding longer legal
forms and maiden names. Measured on the full regression under v12, the same day: Santanchè no
longer lists her maiden name, Staley still lists his longer legal form; four second turns instead
of five, the same seventeen risks, 7% less in cost.

### D-43 — An allegation alone stays below high

Date: 2026-10-01.
Context: D-40 kept high for critical categories, where an allegation alone still reached high on
two modulators (D-32). In the D-41 run, the Steve Jobs shareholder class action came back as `fraud`
at status `allegation`, undated, and two modulators made the case high; the run before had the same
matter as `civil_litigation`, and low. The risk turned on a label the model sets differently from
one run to the next.
Options: (a) keep D-32; (b) cap a finding at status `allegation` at medium, whatever its category
and modulators.
Decision: (b).
Reasons: an allegation is a claim no authority has taken up; however many outlets repeat it, it is a
reason to look, not a high risk. Any official step, from investigation to final decision, still
reaches high in a critical category (D-32), and a final decision in any category (D-40).
Consequences: the allegation and modulator tests in `score.test.ts` now use a minor final sanction
to show modulators at work, and a test checks the cap in four categories; `PLAN.md` section 4.
Replayed without any API call: nothing changes on the D-39 and D-40 archives beyond D-40 itself; on
the D-41 run, the Jobs class action goes from high to medium. It falls to low only as a moderate
category with a date over two years old (D-40), as in the D-40 run; labelled `fraud`, it stays at
medium.

### D-44 — Findings, then summary, then aliases; encyclopedias named as a source

Date: 2026-10-01.
Context: D-41 put `aliases` first and the summary last; the homonym case then ran to the output cap,
and Mouly's Wikipedia-only matters stayed in the summary. One change per hypothesis this time.
Decision: the root of the output schema is written findings, summary, aliases: the summary follows
the findings it should describe, and the aliases come last, described as other names the sources use
for the screened person only, never for namesakes, at most three, usually empty. The list is cut to
three in `search.ts`, since the grammar cannot bound an array, and carried into
`coverage.aliases`: a name the search did not query. `encyclopedia` joins the `sourceReliability`
values; the prompt asks for it instead of `unknown` for an encyclopedia-only matter, and the grid
weighs it like `unknown`, not as a reliable source. Prompt `v10` adds "Write the findings first; the
summary describes the findings listed."
Consequences: measured on 2026-10-01 on homonym, Mouly and Jobs, one run each
(`logs/comparison.md`): homonym is low with its two namesakes and no runaway output, no alias; Mouly
has his alias, `Marco Mouly`, and one Wikipedia-only matter as a finding, but his insolvency
conviction and another Wikipedia-only matter remain in the summary only; Jobs is medium, the class
action labelled `fraud` again. Stored screenings from before have no aliases and read as an empty
list.

### D-45 — A warning when the summary cites years no finding is dated in

Date: 2026-10-01.
Context: summaries kept describing matters that had no finding, against the prompt (D-41, D-44).
Decision: `summary-check.ts` lists the four-digit years of the summary that no finding is dated in;
when there are some, `coverage.errors` gets `unsourced_summary`, "the summary mentions years without a dated finding", with those years. It is a warning: it
does not make the coverage incomplete, and the page shows it next to the summary.
Reasons: a deterministic check that needs no extra call, and points the analyst to the matter to
look for in the sources.
Consequences: on the run of 2026-10-01 it named 2022 for Mouly, a matter cited without a finding,
and 2008 and 2021 for Madoff, the years of his arrest and death: years of context raise it as well.

### D-46 — Reading a page in full when its extract leaves a status or a date open: tried and rejected

Date: 2026-10-02.
Context: a search result gives the model a title and a short extract. When the extract does not
say where a matter stands or when, the finding comes back `unclear` or undated, and the grid cannot
age it: the Jobs class action stayed undated in most runs (D-40).
Tried: the web fetch tool, `web_fetch_20260318`, in the search turn, with `max_uses` 3,
`max_content_tokens` 8,000, `allowed_callers: ["direct"]`, `url_sources` limited to the web search
results so that a link planted in a page read could not be followed, and the blocked domains that
have no path. A page read in full was not a source: findings still cited search results only, the
pages read were listed in the coverage, and a failed read was a warning. The tool has no fee; the
pages are billed as input tokens. Prompt `v13` added: "When a search extract attributes a matter to
the person but does not establish its status or the date of that status, read that page in full
with the web fetch tool. Read at most three pages, web pages only, never a PDF." Alternatives left
aside: a second call, decided by code, reading the pages of undated or `unclear` findings; dynamic
filtering, which nests the results under code execution and cost 14% more on search (D-17).
Criterion set beforehand: statuses or dates corrected on at least two cases, and a mean cost under
+25%. Measured once on 2026-10-01 on the five fixed cases, Mouly, Jobs, regulator and investigation,
against the `v12` run of the same day (`logs/comparison.md`):

- one page read in nine cases, the FCA final notice on Staley, a PDF, which the prompt excluded and
  `max_content_tokens` does not cut: about 18,000 more tokens, +27% on that case, and no date made
  more precise;
- undated findings remained, two for Mouly and Staley's civil claim, without the model reading
  their page; every other change of status or date came without a read, from run-to-run variation;
- the nine cases passed with the same risks except Jobs, medium to low on a date found without a
  read; the cost rose by 4.2%, the tool definition adding about 2,000 tokens to the cached prefix
  of every screening.

Decision: rejected, the criterion is not met. The code returns to its state before the trial and
prompt `v12` is restored. The API accepted `url_sources`, which appears in the SDK types and
changelog (0.130.0) but not on the tool's documentation page.

### D-47 — A second call, decided by code, to settle dates and statuses: planned, not implemented

Date: 2026-10-02.
Context: the date and the status of a finding come from a search extract, and they move between
runs on the same article. The Justice Department release on Madoff was dated 2009-06-29 in one run
and 2009-03-12 in the next. The article on Mouly's money-laundering investigation, the same URL
each time, was dated 2023-06, then 2024-06, then left undated, over three runs on 2026-10-01.
Leaving the reading of pages to the model failed: in nine cases it read one page, a PDF it was told
not to read, and left the undated findings unread (D-46).
Planned: after the search turn, code picks the counted findings that are undated or `unclear`, the
highest level first, at most three, and leaves out URLs ending in `.pdf`. A second call, with the
web fetch tool only (`max_uses` 3, `max_content_tokens` 8,000, `allowed_callers: ["direct"]`,
`url_sources` limited to the URLs of the user message), receives these URLs as data. It returns, for
each, the status and the date of that status as the page states them, or null. Code applies them to
the finding of that URL only. It changes neither the URL, nor the category, nor the identity, and
adds no finding; a page that settles nothing leaves the finding as it was. A failed read is a
warning, and the coverage stays complete.
Alternatives: reading at the model's discretion in the search turn (D-46, rejected). Reading the
page of every counted finding, which would steady dated findings as well, but adds a call and up to
three pages to most screenings. A second call without fetch, re-reading the extracts, which hold no
more than they did the first time.
Reasons: code decides when and what to read, so the cost is bounded and paid only when a finding is
open: one call, at most 24,000 input tokens of pages. Leaving out URLs ending in `.pdf` keeps the
case `max_content_tokens` does not cut out of the reads (D-46), without a guarantee: a PDF served
under another URL still passes.
Limits: the trigger misses a dated finding whose date varies, like the Madoff release or the Mouly
article dated twice. Within one run, code cannot tell a steady date from an unsteady one.
Status: not implemented. To be measured against the criterion of D-46 before adoption: statuses or
dates corrected on at least two cases, and a mean cost under +25%.

### D-48 — Search operators `inpage:`, `intitle:`, `after:` and `lang:`: measured, not adopted

Date: 2026-10-02.
Context: repeating the name in every clause (D-39) spends most of the 380 characters and 48 words a
query may hold, so a query keeps at most nine clauses. An operator applying the name to the whole
query would free that room, and a date operator would let the daily re-screening look at recent
articles only.
Tried: five probes on 2026-10-02, with the method of D-39 (`logs/probe-operators.mts`): one search,
the query run exactly as written, checked in the tool call, and the model classifying each result
from its extract. One run per probe, $0.26 in all. Probes 1 to 3 are localized to the United States,
4 and 5 to France.

| probe                                                                        | about the person               | name in title           | backdating | off-topic                                           |
| ---------------------------------------------------------------------------- | ------------------------------ | ----------------------- | ---------- | --------------------------------------------------- |
| (1) `inpage:"Steve Jobs" fraud OR "money laundering" OR ... OR scandal`      | 5 of 9                         | 4                       | 1          | 3, and Holmes as "the female Steve Jobs"            |
| (2) the same with `intitle:`                                                 | 5 of 9, 8 URLs shared with (1) | 5                       | 2          | the same 3, and Holmes                              |
| (3) control, `"Steve Jobs" fraud OR "Steve Jobs" investigation OR ...`       | 9 of 9, 1 URL shared           | 7                       | 3          | 0                                                   |
| (4) `inpage:"Mardoché Mouly" lang:fr fraude OR escroquerie OR ... OR procès` | 4 of 9                         | 4, all as "Marco Mouly" | n/a        | 5 pages of one site on financial cases in Mauritius |
| (5) `"Marco Mouly" condamnation after:2025-01-01`                            | 2 of 9                         | 1                       | n/a        | 7, namesakes and footballers named Marco            |

- `inpage:` and `intitle:` bind like a quoted name, to the first clause only: the other clauses
  search alone and bring back Steve Madden, a corruption scandal in San Francisco and a Justice
  Department release on another chief executive. Probes 1 and 2 return almost the same results, and
  fall below the control on every count. The sources of 1 and 2: five press articles, three
  encyclopedia pages and one official release each; the control returns nine press articles.
- `after:` does not filter by publication date, since a TV episode of November 2022 came back, and
  the result set collapsed: no press article on the 2025 conviction.
- `lang:fr`: the nine pages of probe 4 are in French, but the query was also localized to France,
  as the agent's national queries are. Without a control, its effect is undetermined.

Decision: none of these operators is adopted. The form of D-39, with the name repeated in every
clause, remains the best measured. A time window for the daily re-screening cannot come from the
search tool, which has no date parameter: it needs direct access to the engine.

### D-49 — A second screening on a stronger model when the first shows a signal: built, off by default

Date: 2026-10-02.
Context: Opus 5.5 searched an alias itself and dated matters more precisely than Sonnet, at twice
the cost of every screening (D-09). Most persons screened have nothing adverse, and the Sonnet
result is enough for them.
Decision: `index.ts` screens with Sonnet first. When that screening holds a counted finding, an
alias the queries did not cover (the one D-42 would search), an `unsourced_summary` warning or an
incomplete status, it screens the person again from the start on the model `ESCALATION_MODEL`
names, such as `claude-opus-5-5`; unset, nothing escalates. The second screening runs inside the
remaining time budget, and only with 120 s of it left. It replaces the first; tokens, cost and calls add up, each
screening priced at its own model, and `coverage.escalatedTo` names the model. A compromised answer
(D-36), a refusal (D-21) or a timeout never escalates. With escalation on, the Sonnet screening
skips its alias turn: an alias escalates anyway, and the Opus screening runs its own.
Alternatives: (a) Opus for every screening, $0.168 on average over seven cases (D-09), paid for clean
persons too. (b) Sonnet only, with D-42: the cheapest, without the dates and aliases Opus brings.
(c) Escalation on a counted finding only: fewer escalations, but an alias or a doubtful summary on a
person with nothing counted would stay with Sonnet.
Reasons: the stronger model is paid where an analyst will read findings, and the signals are
deterministic, so code decides.
Measured on 2026-10-02 (`logs/comparison.md`), prompt v13, against the same prompt on Sonnet with
escalation off, on the seventeen cases:

- 14 of 17 cases escalated, and no risk changed. Counted findings went from 25 to 42, most added at
  low or medium level: controversies, acquittals, allegations. clean-public-figure gained a blog
  allegation, counted at low, against an expectation of none.
- Dates: Held's conviction dated to its finality, April 2023, and Mouly's matters to the day; but
  Staley's 2018 fine came back as an undated investigation, and one of Pinior's convictions undated.
- Cost: $1.4683 to $3.7756. A screening without signal cost $0.0639 on average, an escalated one
  $0.2560, the discarded Sonnet screening included. With 80% of screenings without signal, $0.1023
  per screening; the $0.12 bound holds up to 29% of screenings escalated.
- Durations up to 53 s.

Criterion set beforehand, no risk regression and a weighted mean under $0.12: met. clean-public-figure
escalated on a signal its discarded Sonnet screening showed, which the base run did not; the
signals were not kept then.
Outcome: the code stays, off by default. The fixtures are adverse by design, so their 14 escalations
out of 17 say nothing of the share in use, and the $0.12 bound needs it under 29%; Opus also adds
low-level findings the analyst has to read; and that share has not been measured. Every screening
now records the signals it showed in `coverage.escalationSignals`, escalated or not, and the run
log carries them with `escalatedTo`: the share can be read from screenings run with escalation off
before `ESCALATION_MODEL` is set.

### D-50 — A finding sourced from a blog or a social network is shown, never counted

Date: 2026-10-02.
Context: under escalation (D-49), clean-public-figure, a Nobel laureate, came back with a
harassment allegation relayed by a science-integrity blog, counted at low; the Jobs case had a
Grunge article counted at medium. Neither page has editorial control.
Decision: `score.ts` never counts a finding whose `sourceReliability` is `blog` or `social`, as it
never counts a finding about an associate (D-28) or at low identity. The finding stays on the page,
under "Shown, not counted", labelled "Blog or social source".
Alternatives: (a) count it with a cap at low or medium: the level then rests on a page anyone can
write. (b) Block blog domains in code, as social networks are (D-37): no closed list of blogs
exists, and the analyst would lose the lead. (c) Leave the grid as it is: low-reliability pages
keep adding counted findings, as the escalated runs showed.
Reasons: the label comes from the model, which names the source type of the page it cites as
`url`, the most authoritative it found (prompt rule): when that is a blog, no press or official
source carried the matter. A blog finding in a critical category still keeps the confidence at
medium when nothing is counted, as an uncounted homonym does: the analyst should read it.
Consequences: replayed without API call on the v13 Sonnet and D-49 archives
(`logs/rescore-d50.mts`): no risk and no confidence changed, clean-public-figure passes again (one
counted finding to none), and the Jobs case counts two findings instead of three, still medium. A
matter reported only by a blog no longer weighs on the risk, even when it is true.

### D-51 — The model's own level is recorded beside the grid, as an opinion

Date: 2026-10-02.
Context: the grid in code sets the risk (D-04). Whether the model, reading the same articles, would
reach the same level was never recorded, so a gap between the two could not be seen.
Options: (a) keep the model silent on the overall risk, the rule of prompts up to `v13`; (b) ask for
the model's level and record it beside the computed one, without scoring it; (c) let the model set
the risk, which D-04 rules out; (d) blend both levels.
Decision: (b). The answer schema gains `suggestedRisk`, written after the findings and before the
summary. The result exposes `modelSuggestedRisk` and `riskDisagreement`, true when the model gave a
level that differs from the computed one; the page shows the model's level under the badges and
flags a difference. Both fields are stored in `coverage_json`, without a migration, and read as
`null` and `false` on older rows. A compromised answer gives no opinion (D-36); after an alias turn
the higher of the two views stands; an escalated screening keeps the opinion of its second model.
Prompt `v14` replaces the rule against assessing the overall risk.
Reasons: a disagreement points the analyst to a case worth a second look and shows where the grid
and the model read the same facts differently, at the cost of a few output tokens.
Consequences: measured on 2026-10-02 on the seventeen cases, once each: 17/17 pass, $1.4140 in all,
a mean of $0.0832 per screening, against $1.4683 under `v13`. The model differs from the grid on 2
of 17 cases, 11.8%, both times lower. Staley: the grid gives high for a final regulatory sanction,
the FCA's lifetime ban upheld in 2025; the model says medium. Jobs: the grid gives medium for two
undated civil class actions, which cannot age to low without a date (D-40); the model says low.
Both fall where the grid is deliberately conservative. The model was more lenient than the policy
in both, a final FCA ban at medium and undated civil actions at low, and never stricter; the cost is
unchanged.
