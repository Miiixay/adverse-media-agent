# Decision log

Why the agent is built the way it is. One entry per decision, written when the decision is
taken. Entries marked "decided by measurement" point to the tables in `docs/evaluation.md`.

### D-01 — Orchestrated workflow in code, not an autonomous agent or a framework

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

Context: a Next.js app must call the agent, Vercel runs JavaScript natively, the deadline is
two days.
Options: (a) a Python agent as a separate service behind an HTTP API; (b) a TypeScript agent as a
module of the same repository, called as a function.
Decision: (b).
Reasons: one deployment, no second API to write and secure. The Anthropic TypeScript SDK has the
same capabilities as the Python SDK. The boundary is kept by construction (D-15).
Consequences: the agent must stay framework-agnostic to remain extractable later.

### D-03 — Deterministic in code, judgment in the LLM

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

### D-09 — Claude Sonnet 5.5 for v1, Opus 5.5 as the measured comparison

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

### D-15 — Modular monolith now, isolated worker later; the boundary is one JSON contract

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
Consequences: v2 measures billed input tokens with and without it on the fixtures. Switching
requires the URL collector to read results nested under code execution blocks.

### D-18 — Hand-written JSON schema with real enums, validated with zod on the client

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

### D-08 — One call searches and returns the structured assessment

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

### D-21 — No model fallback on refusal; a refusal is reported in `coverage.errors`

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

### D-10 — Search and output limits, retries and time budget

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

### D-24 — The run log is written by the callers, without names, under a keyed pseudonym

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
