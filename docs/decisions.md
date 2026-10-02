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
Consequences: measured on 2026-10-01 (v2.1 in `docs/evaluation.md`), dynamic filtering left every
risk and counted finding unchanged and cost 14% more on the three fixtures, $0.3711 to $0.4244:
+44% and +42% on the two cases with two searches, -8% on the case with five or six, within the
run-to-run noise. Durations went from 7-12 s to 19-24 s, and output tokens rose because the model
writes the filtering code. Direct calls stay: cheaper at this number of searches, and the only
mode eligible for zero data retention, which a regulated institution may require. The collector
already reads searches run from code execution, so the switch can be measured again if the number
of searches per screening grows, for instance in daily monitoring.

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

### D-28 — Each finding says who it is about; a finding about an associate never counts

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

### D-32 — An allegation alone starts at medium; any official step is high

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
