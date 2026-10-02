# Adverse Media Agent: technical specification

## 1. What it does

From a first name, a last name and a country, the agent searches the press of that country in its own language and the international press in English, judges every article, and returns a risk level, low, medium or high, with each finding and the link to its source. A compliance analyst reviews the result: the agent prioritises, it does not decide. It works on open sources only, not on sanctions lists, PEP lists or commercial adverse-media databases.

Input: `{ firstName, lastName, country }`. Output: a `ScreeningResult` with the risk, a confidence, a summary, the findings (URL, date, category, status, identity confidence with its evidence, source reliability, counted or not), the coverage (languages, queries run, articles read, errors), the cost in tokens and dollars, and the model's own level, stored as an opinion with a flag when it differs from the computed risk.

## 2. How the agent works

A workflow in plain TypeScript, no agent framework. TypeScript keeps the agent and the Next.js app in one repository and one deployment, with the same Anthropic SDK capabilities as Python; the agent module imports nothing from Next.js and can move to a separate service without a rewrite. At a larger scale, LangGraph would add checkpointing, human interruption and parallel branches, and a Python worker would suit a Python data team; the state and the steps are already shaped as a graph, so either migration is mechanical. The code orders the steps and handles everything that must be reproducible; the model does what code cannot: search, judge identity, read articles. Steps marked (code) are deterministic and unit-tested; (model) steps call Claude Sonnet 5.5.

1. **Validate** (code). Any script, up to 100 characters; angle brackets, line breaks and control characters are refused, so no input can break out of the data tags of the prompt.
2. **Prepare** (code). Press languages of the country plus English; name variants (order, initials, without diacritics) for the identity judgement; one query per language, `"Name" fraud OR "Name" "money laundering" OR …`, nine terms by priority within the engine's limits.
3. **Search and assess** (model). One Messages API call with the `web_search` server tool and a JSON schema as output format. The model runs every planned query, may run up to two more only for an identity doubt, another name used by the sources, or a public figure whose results are only biographical, and returns one finding per matter: category, status, date of the latest status, identity confidence with evidence, source reliability, up to three corroborating URLs, plus its own overall level as an opinion. The system prompt is cached.
4. **Interpret** (code). A finding is kept only if its URL is one of the search results, uses http(s) and is not on a list of social networks and forums; others are rejected and listed. The title comes from the search result. The code checks for a canary marker in the answer and for a flood of blocked domains.
5. **Alias turn** (code, then model). If the model reports another name the sources use and no query used it, the agent searches again with it and merges the findings; the same matter at two stages becomes one finding at the later stage, the other URL a corroboration.
6. **Score** (code). A grid gives a level to each finding and the overall risk. The model never sets the risk.
7. **Report** (code). An empty result is `complete` only when every planned query ran and nothing failed; a timeout, a refusal or a schema error gives `incomplete`, never a plain low.

The model is autonomous only inside step 3, within a budget of eight searches; the code runs every other step. An optional escalation screens the person again on Opus 5.5 when the first result shows a signal (a counted finding, an alias, a doubtful summary, an incomplete status): built, measured, off by default.

## 3. The scoring grid

- Shown but never counted: findings at low identity confidence (probable namesakes), about an associate, or sourced from a blog or a social network.
- **High**: a counted finding at high identity in a critical category (money laundering, fraud, corruption, sanctions, terrorism, organised crime) beyond a simple allegation, or a final conviction or sanction in any category.
- **Medium**: an allegation of a financial crime, a civil or regulatory matter, a matter about an organisation the person leads, or a serious matter at medium identity. Two of three modulators (recency under two years, an official or national-press source, corroboration by two domains) raise a finding one level, never above the caps.
- **Low**: nothing counted, or only acquittals, minor matters older than ten years, or civil claims undecided for two years.
- Confidence is the lowest identity among counted findings; with none, it stays medium if a namesake appears in a critical category.

The grid is a risk policy with named thresholds that compliance can change without touching the prompt; the model's own level is an opinion, the grid decides.

## 4. Optimisations, measured

Five fixed cases were replayed after every change and twelve more real cases before each release: seventeen persons in six languages, including a famous name, a common name, a fictional name, a fraudster known under an alias and an executive whose company was fined. Cost per screening: $0.134 (v1) to $0.086 (final, seventeen cases); $0.064 for a person with nothing to report.

| lever in place | effect |
| --- | --- |
| One query per language instead of two | −37% cost, same convictions found |
| Prompt caching of the static prefix | −15% |
| Medium effort instead of high | −18%, 26% fewer output tokens, same risks on the five cases |
| Name repeated in every search clause | the engine binds a quoted name to the next term only; 9/9 pages on the person instead of 3/9 |
| Regulatory and civil vocabulary | investigations, lawsuits and fines now searched |
| Alias turn in code | +34% on the test set for three matters gained |
| Blocked domains applied in code | same guarantee as the tool filter, which changed the whole result set |

Measured and not kept: dynamic search filtering (+14%, latency ×3, loses zero data retention), two queries per language (+73% for two minor matters), page reading at the model's choice (one page read in nine cases, no date corrected), the engine's search operators (5/9 pages on the person instead of 9/9). Opus 5.5 gives the same risks with better dates and aliases at +105% and stays an option. Search results injected into the context, about 9,500 tokens per search, are two thirds of the cost: a lever on the number and precision of searches weighs more than any lever on the output.

## 5. Security

Deterministic guards around a non-deterministic component.

- By design, the model has no say in the risk, cannot add a URL the search did not return, has search as its only tool and sees only the current request: an injected page can at most mislabel one article.
- A random canary in the prompt marks the result compromised if it comes back; a flood of blocked domains marks the coverage incomplete; a refusal or a timeout is reported, never handed to another model.
- Input is validated before any call and passed as data between tags declared as data.
- The API key lives on the server only and the agent module cannot be imported by a client component; the search tool is called directly, so zero data retention stays possible; the run log keeps counts and codes with an HMAC pseudonym; no search turn is retried; a spend limit sits on the key.
- Planned: an output check for instruction-like text that bypasses the canary; page classification before the model reads them, once the agent fetches pages itself; a tool firewall the day the agent gets a tool that acts; a second model checking each high finding against its source.

## 6. Known limits

- Identity rests on name and country: "David Smith, GB" returns a Jamaican money launderer and a Scottish murderer, shown as namesakes, not counted. Without a date of birth or a role, the agent can only explain why it set them aside.
- A famous name buries old matters, because the engine ranks by relevance and popularity: Steve Jobs' 2006 options-backdating investigation was missed until the query bound the name to every term, and secondary matters vary between runs.
- The server search tool returns about ten results per query, has no date filter and ignores `after:`; a daily run screens the person again and keeps the findings whose URL is new.
- Dates and statuses come from extracts: the same article on Mouly's money-laundering investigation came back dated 2023-06, 2024-06 and undated over three runs, and a conviction date moved from the plea to the sentence; reading pages in full at the model's choice did not fix it.
- Aliases depend on the model reporting them; at medium effort it does not search them on its own. Matters that only Wikipedia carries are reported unevenly; a warning lists the years the summary mentions without a finding.
- A fine against the company a person leads is found only when an article names the person, then capped at medium (Stalf, N26).
- An empty result is not a clean result: each low shows articles read, queries run and failures.

## 7. Application and data

A Next.js app on Vercel calls `screenIndividual` from an API route and shows the form, the risk with the level definitions, the findings with their links, uncounted findings apart, coverage and cost. Screenings are stored in Neon Postgres (persons, screenings, findings) and listed in a history. Persons are added to a watchlist explicitly; a daily Vercel Cron screens them again, capped per run, and stores only new findings. The prototype is synchronous and password-protected; the target is a worker behind a queue, single sign-on and a date-filtered search for the daily delta (`docs/architecture.md`).

## 8. Next steps

In the order in which each unlocks the next; days for one engineer, tests and a measurement on the seventeen cases included, about sixteen days plus a fifth for the unexpected.

1. **A secured fetcher, 3 days** (code, then model): SSRF guards, size and time limits, a deterministic check that a page names the person, quote verification, and a second code-triggered call where the model settles undated or unclear findings.
2. **Direct access to a search API, 3 days** (model): a client tool the model drives, twenty results, a news index, a date window, pagination.
3. **Analyst decisions, 3 days** (code): confirm, dismiss, comment, override with a reason, dismissed namesakes remembered, labelled data to measure against.
4. **A job queue, 3 days** (code): retries, a status per case, the Batches API at half the token price, monitoring beyond fifteen persons a day.
5. **Optional identifiers, 2 days** (model): date of birth, role, organisation, aliases, with a first pass where the model identifies role and organisations when they are missing.
6. **Sanctions and PEP lists, 2 days** (model): an API such as OpenSanctions as a tool consulted once identity is settled.

Decisions: `docs/decisions.md` (fifty-one entries). Measurements: `docs/evaluation.md`. Security: `docs/security.md`. 214 unit tests; `npm run evaluate` replays the cases.