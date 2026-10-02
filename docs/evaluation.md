# Evaluation

How the agent was measured, what each fixed case tests, and what every optimization changed. All
figures come from runs on 2026-10-01 and 2026-10-02.

## Method

- **Fixed cases.** `fixtures/test-cases.json` holds five cases, replayed by `npm run evaluate`
  (`scripts/evaluate.ts`). The first case runs alone and the others in parallel, so that a prompt
  cache entry written by the first can be read by the next. Each case is checked against its
  expectations: the risk, the number of counted findings (exact or minimum), a minimum of namesakes
  at low identity, and a counted finding with a given language and status.
- **Cost.** Every API call reports its usage; `src/agent/cost.ts` prices it with the figures of the
  pricing page read on 2026-09-30. For Claude Sonnet 5.5, per million tokens: $2 input, $2.50
  five-minute cache write, $0.20 cache read, $10 output; plus $10 per 1,000 searches.
- **Configuration.** Model `claude-sonnet-5-5`, web search `web_search_20260318` called directly;
  each result records its prompt version, `v1` for the first measures, `v11` for the final run. The full result of each case is kept in the gitignored `logs/evaluation/`, and
  each run is logged in `logs/runs.jsonl` under a pseudonym.
- **One run per version.** To compare search plans on the same code, `QUERIES_PER_LANGUAGE=2`
  replays the v1 plan. The v1 figures of the two native cases come from such runs, since these
  cases were added after v1.
- **Noise.** The same code run twice gave $0.0890 then $0.0818 on the known-high case. On the clean
  case, one configuration gave $0.0718 then $0.1324, a factor of 1.8, because the model spent one
  free search on the surname alone in the second run. A difference under about 10% between two
  single runs is not evidence.

## Cases

| case              | input                             | what it tests                                                                                                                     | expected                                                            |
| ----------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| known-high        | Bernard Madoff, US                | A documented conviction of a public figure; the grouping of many articles into one matter                                         | risk high                                                           |
| homonym           | David Smith, GB                   | A very common name whose namesakes have convictions, in a country where court reporting names defendants                          | risk low, no counted finding, at least one namesake at low identity |
| clean             | Friederike Wenzlaff-Obermaier, DE | A fictional name with no coverage: the empty result, complete coverage, no invented finding                                       | risk low, no counted finding                                        |
| native-only       | Valérie Bozzi, FR                 | Convictions covered only by the French press: the recall of the native-language query; the partner's investigation must not count | risk high, at least one counted conviction in French                |
| native-only-noisy | Marcus Held, DE                   | A conviction covered by the German press, under a surname that is also a common German word                                       | risk high, at least one counted conviction in German                |

The homonym case first used Jean Martin, FR. Its 36 articles held no namesake with negative
coverage: French judicial reporting rarely names ordinary defendants in full. The case was replaced
because it no longer tested identity resolution.

## Final results, 2026-10-01

The configuration delivered: one query per language with the name repeated in every clause (D-39),
regulatory and civil terms (D-38), medium effort and prompt caching, the grid of D-40 and D-43, a
second search turn under an alias the sources use (D-42), and a warning when the summary cites years
no finding is dated in (D-45). The last full run used prompt `v11`; the five fixed cases and the
twelve extended ones (`npm run evaluate -- --extended`) ran once each. The pass column applies the
final expectations to the archived results, without a new run: Jobs low or medium, Mouly three
counted findings in any language.

| case                | expected       | risk   | pass  | counted / findings | model calls | cost                      |
| ------------------- | -------------- | ------ | ----- | ------------------ | ----------- | ------------------------- |
| known-high          | high           | high   | yes   | 1 / 1              | 2           | $0.0929                   |
| homonym             | low            | low    | yes   | 0 / 2              | 1           | $0.0425                   |
| clean               | low            | low    | yes   | 0 / 0              | 1           | $0.0688                   |
| native-only         | high           | high   | yes   | 2 / 2              | 1           | $0.0826                   |
| native-only-noisy   | high           | high   | yes   | 1 / 1              | 1           | $0.0767                   |
| sanctions           | high           | high   | yes   | 1 / 1              | 1           | $0.0803                   |
| regulator           | medium or high | high   | yes   | 3 / 3              | 2           | $0.0828                   |
| acquittal           | low            | low    | yes   | 1 / 1              | 1           | $0.0672                   |
| investigation       | high           | high   | yes   | 3 / 3              | 2           | $0.1967                   |
| spanish             | high           | high   | yes   | 2 / 2              | 1           | $0.0796                   |
| polish              | high           | high   | yes   | 4 / 4              | 1           | $0.0898                   |
| organization        | medium or high | medium | yes   | 1 / 1              | 1           | $0.0707                   |
| homonym-abroad      | low            | low    | yes   | 0 / 2              | 1           | $0.0771                   |
| clean-public-figure | low            | low    | yes   | 0 / 0              | 1           | $0.0682                   |
| sparse-local        | high           | high   | yes   | 3 / 3              | 2           | $0.2407                   |
| famous-noise        | low or medium  | medium | yes   | 2 / 2              | 1           | $0.0414                   |
| multiple-matters    | high           | high   | yes   | 3 / 3              | 2           | $0.1688                   |
| **total**           |                |        | 17/17 |                    | 22          | **$1.6269**, mean $0.0957 |

- **Alias turns.** Five cases ran a second turn: a nickname (Bernie Madoff), a full legal name (James
  Edward Staley), a maiden name (Daniela Garnero), a spelling variant (Mouslim Abdouramane) and an
  alias (Marco Mouly). They changed no risk, gained three matters and raised the cost of the seventeen
  cases by 34% against the previous runs; accepted (D-42). After this run, prompt `v12` narrowed the aliases to names
  used instead of the legal name, and code skips an alias holding both names entered. Rerun
  under `v12`, the seventeen cases pass with the same risks; Santanchè no longer runs a second turn,
  Staley still does, and the total falls by 7%, to $1.5117 (`logs/comparison.md`).
- **Mean cost.** $0.0957 per screening with the alias turns, $0.0704 on the twelve cases that ran a
  single turn.
- **Warnings.** Eight of seventeen summaries cite a year no finding is dated in, mostly years of
  context such as an arrest or a death; the warning stays (D-45).

## Measured on 2026-10-02

Prompt `v13`, Sonnet 5.5, one query per language, escalation off: the seventeen cases pass, for
$1.4683, a mean of $0.0864 per screening. After the quality pass on the agent code, the five fixed
cases came back with the same risks and counted findings, for $0.3623.

| dial                           | measured                                   | against                  | result                                                                                                                                                                                                                     | kept                |
| ------------------------------ | ------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| depth, `QUERIES_PER_LANGUAGE`  | 2, prompt `v12`, 17 cases                  | 1, prompt `v12`          | matters found 24 to 26, a money-laundering lead whose article names no one and a 1975 arrest over a speeding ticket; Jobs medium to high on a mislabelled finding, 16/17; searches 38 to 73; $1.5117 to $2.6097 (+73%)     | 1                   |
| model, `MODEL`                 | `claude-opus-5-5`, prompt `v13`, 7 cases   | Sonnet 5.5, prompt `v12` | same risks, 10 counted findings each; Opus searched an alias itself and dated matters more precisely; $0.5741 to $1.1767 (+105%), $0.082 to $0.168 per screening; up to 34 s (D-09)                                        | Sonnet 5.5          |
| escalation, `ESCALATION_MODEL` | `claude-opus-5-5` after a signal, 17 cases | Sonnet 5.5, prompt `v13` | 14 of 17 escalated, no risk changed, counted findings 25 to 42, most added at low or medium; $1.4683 to $3.7756; $0.1023 per screening if 80% show no signal, under $0.12 up to 29% escalated (D-49)                       | off                 |
| page reads, web fetch          | at most 3 pages, prompt `v13`, 9 cases     | prompt `v12`             | one page read in nine cases, a PDF the prompt excluded; no status or date corrected; +4.2% (D-46)                                                                                                                          | rejected            |
| search operators               | `inpage:`, `intitle:`, `after:`, `lang:`   | the D-39 query form      | `inpage:` and `intitle:` bind the name to the first clause only, 5 of 9 results about the person against 9 of 9; `after:` lets a 2022 page through and loses the 2025 press; `lang:` undetermined without a control (D-48) | the D-39 query form |

Replayed without an API call on the archives of the `v13` and escalation runs, the rule that never
counts a finding sourced from a blog or a social network changed no risk and no confidence (D-50).

Under prompt `v14`, the model's own level is recorded beside the computed one (D-51): it differs on
2 of 17 cases, both times lower, on Staley's final regulatory ban and on Jobs's undated civil
actions; the seventeen cases pass, for $1.4140, a mean of $0.0832 per screening.
The model was more lenient than the policy in both disagreements, never stricter, and the cost is unchanged.

## Results by version

| version | change                   | cost of the five cases | against previous | searches | articles read | verdict  |
| ------- | ------------------------ | ---------------------- | ---------------- | -------- | ------------- | -------- |
| v1      | two queries per language | $0.6678                |                  | 17       | 149           | baseline |
| v2.1    | dynamic filtering        | see below              | +14%             |          |               | rejected |
| v2.2    | one query per language   | $0.4220                | −37%             | 9        | 80            | kept     |
| v2.3    | prompt caching           | $0.3573                | −15%             | 9        | 79            | kept     |
| v2.4    | medium effort            | $0.2919                | −18%             | 8        | 71            | kept     |

| case                   | v1          | v2.2        | v2.3        | v2.4        |
| ---------------------- | ----------- | ----------- | ----------- | ----------- |
| known-high             | $0.0818     | $0.0533     | $0.0516     | $0.0378     |
| homonym                | $0.0830     | $0.0574     | $0.0447     | $0.0412     |
| clean                  | $0.2063     | $0.1324     | $0.0944     | $0.0608     |
| native-only            | $0.1561     | $0.0958     | $0.0897     | $0.0771     |
| native-only-noisy      | $0.1406     | $0.0830     | $0.0768     | $0.0751     |
| **mean per screening** | **$0.1336** | **$0.0844** | **$0.0715** | **$0.0584** |

v2.2 was first measured on the three cases that existed then, at $0.1841 against $0.3711 for v1
(−50%). The v2.2 column above is the later run on five cases, with British spellings added to the
English query and the `subject` field in the schema.

Results of v2.4, the configuration kept:

| case              | pass | status   | risk | confidence | counted / findings | searches | articles | duration |
| ----------------- | ---- | -------- | ---- | ---------- | ------------------ | -------- | -------- | -------- |
| known-high        | yes  | complete | high | high       | 1 / 1              | 1        | 9        | 7.8 s    |
| homonym           | yes  | complete | low  | medium     | 0 / 2              | 1        | 9        | 8.0 s    |
| clean             | yes  | complete | low  | high       | 0 / 0              | 2        | 17       | 5.0 s    |
| native-only       | yes  | complete | high | high       | 3 / 4              | 2        | 18       | 12.4 s   |
| native-only-noisy | yes  | complete | high | high       | 1 / 1              | 2        | 18       | 11.3 s   |

Cost split of v2.4 on the five cases: cache writes $0.1511 (52%), searches $0.0800 (27%), output
tokens $0.0478 (16%), cache reads $0.0098 (3%), uncached input $0.0032 (1%). Once caching is on,
the API writes each search result to the cache before rereading it, at 1.25 times the input price;
these writes are now the largest item.

### Rejected: dynamic filtering (v2.1)

Measured on the three cases that existed then, against v1.

| case       | searches | cost v1     | cost v2.1   | difference |
| ---------- | -------- | ----------- | ----------- | ---------- |
| known-high | 2        | $0.0818     | $0.1176     | +44%       |
| homonym    | 2        | $0.0830     | $0.1180     | +42%       |
| clean      | 5 → 6    | $0.2063     | $0.1888     | −8%        |
| **total**  |          | **$0.3711** | **$0.4244** | **+14%**   |

Same risks and counted findings. Durations went from 7–12 s to 19–24 s, and output tokens rose
because the model writes the filtering code. At one to six searches per screening, the overhead of
code execution outweighs the filtering, and the mode is not eligible for zero data retention
(D-17).

### Recall of one query per language

The two native cases were run under both plans, once each.

| case              | plan        | searches | articles | cost    | finds the conviction                        |
| ----------------- | ----------- | -------- | -------- | ------- | ------------------------------------------- |
| native-only       | two queries | 4        | 35       | $0.1561 | yes, both 2025 convictions                  |
| native-only       | one query   | 2        | 17       | $0.1008 | yes, both 2025 convictions and the 2021 one |
| native-only-noisy | two queries | 4        | 37       | $0.1406 | yes                                         |
| native-only-noisy | one query   | 2        | 18       | $0.0847 | yes                                         |

In both cases, the English query returned only unrelated namesakes.

## Search engine query semantics

The Steve Jobs case missed the SEC investigation of Apple's option backdating, although the agent's
query held "investigation", "lawsuit" and "settlement" (D-38). On 2026-10-01, a throwaway script
(`logs/probe-query.mts`) asked the model to run one query exactly as written, with a single search,
and to list what came back. The URLs were read from the search result blocks, the queries run from
the tool calls, and the model said for each page whether it dealt with the backdating. One run per
query.

| query                                                                           | results about Jobs                          | about the backdating |
| ------------------------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| the agent's query: `"Steve Jobs" fraud OR "money laundering" OR ... OR scandal` | 3 of 9: Wikipedia, disambiguation, FBI file | 0                    |
| the same, terms in parentheses                                                  | 3 of 9, six URLs unchanged                  | 0                    |
| `"Steve Jobs" investigation`                                                    | 10 of 10                                    | 1                    |
| `"Steve Jobs" fraud OR "Steve Jobs" investigation OR "Steve Jobs" lawsuit`      | 9 of 9                                      | 3                    |
| `Steve Jobs SEC backdating stock options`, a control that names the matter      | 9 of 9                                      | 9                    |

The engine binds a quoted name to the term right after it and not beyond: `"Name" a OR b OR c` reads
as `("Name" a) OR b OR c`. The agent's queries were therefore unions of clauses without the name, and
on a famous name these clauses brought back pages about the terms: the Wikipedia article on money
laundering, Justice Department releases on other defendants, Steve Madden. Rare names were still
found because the engine ranks first the pages that contain the quoted phrase, without requiring it;
this also explains the earlier search for "Jean Martin" that returned Henri Martin. With the name
repeated in each clause, every result concerned the person, and a civil matter no run had found came
back as well: the Silicon Valley no-poach case.

The query now repeats the name in every clause (D-39). Under that form, the Jobs case finds the
backdating matter through the planned query alone, as a shareholder class action.

The labels in these probes are the model's, read from the extracts, and they vary: on 2026-10-02,
the same Fortune article of March 2008 was tagged as dealing with the backdating in one probe and
not in the next (D-48). A difference of one or two pages in such a column is within that variation.

## Identity evidence, as returned by the model

Homonym case, v2.4. Both namesakes come back at low identity and are not counted:

- FBI release on a Ponzi scheme: "Namesake: David A. Smith is a Jamaican citizen who lived in Turks
  and Caicos, with no link to GB"; "Very common name; the articles give no detail connecting him to
  a GB-based person".
- Wikipedia article on a murderer: "Namesake: Wikipedia article on a convicted murderer named David
  Smith, apparently Scottish"; "No detail ties him to the screened person and the name is very
  common".

Native-only case, the article on the investigation of Valérie Bozzi's partner:

- Before the `subject` field, in the two-query run: identity medium, counted. Evidence:
  "association only: partner Sylvestre Ceccaldi, co-convicted with Valérie Bozzi in 2025"; "The
  article does not say she is personally involved in the new inquiry". The prompt asked for a low
  rating; the model followed it in one run out of two.
- v2.4: `subject: associate`, identity high, not counted. Evidence: "Article names Bozzi as former
  mayor of Grosseto-Prugna and Ceccaldi as her partner"; "Bozzi is not stated to be personally
  involved". The exclusion now holds in code whatever the identity rating (D-28).

## Remaining reservations

- **Small sample.** Seventeen cases, one run per configuration, with the noise described above.
- **Sparse coverage.** One case, a former mayor in Mayotte covered by local outlets, is found in
  every run; one case is not a measure of recall on local coverage.
- **Identity rests on the name and the country.** A date of birth or a role, if the input carried
  them, would be the main improvement.
- **Medium effort cuts free searches.** On an ambiguous identity, the model may skip the search
  that would settle it. The completeness check covers the planned queries, not the free ones.
- **Free searches on the surname alone.** They added cost and noise on the clean case. A prompt rule
  keeping the full name in free searches would bound them.
- **Quoted names bind one term.** The engine binds a quoted name to the term after it only (see
  "Search engine query semantics"); the query repeats the name in every clause since D-39, and the
  identity judgment still filters namesakes.
- **Language tags.** The model sets the language of a finding, and does not always read it from the
  article: Mouly's money-laundering finding, from a French site, came back tagged `en`. Expectations
  on the language of findings are therefore loose: the Mouly case counts findings in any language.
- **Undated civil claims.** A civil claim without a date stays at medium, since the rule that lets an
  old undecided claim fall to low needs a date (D-40); the Jobs class action came back undated in
  most runs, hence the Jobs expectation of low or medium.
- **Alias turns.** A second search turn under an alias adds about a third to the cost on these cases
  (D-42), and runs on names that are not aliases in practice, such as a longer legal form.
- **Cache sharing.** The cached prefix differs by country, because the tool carries `user_location`.
  No case read another case's cache in these runs.
- **Undated findings.** Some findings come without a date, such as the Marcus Held conviction, so the
  recency modulator cannot apply to them.

## Levers not tested

- **Two calls, native localized and English not localized (D-07).** The agent makes one call
  localized to the country. Splitting it is a question of quality more than cost, and adds a call
  per screening.
- **Two-step, search then extraction on a cheaper model (D-08).** Output is 16% of the v2.4 cost, so
  the saving is bounded by that share, minus the input tokens of the second call.
- **`allowed_domains`.** An allow list would put recall at risk on regional outlets, which carried
  the coverage of the native cases. A block list was tried on the search tool and moved to code: the
  tool filter changed the whole result set (D-37).
- **Time window for daily monitoring.** The web search tool has no date parameter, and the
  `after:` operator in the query does not filter by publication date (D-48). A window needs direct
  access to the engine; the daily run keeps the delta on URL hashes.
- **Batch API for daily monitoring.** It halves the price of tokens, not of searches. Tokens are
  73% of the v2.4 cost, so the saving would be about 36% per screening at equal cache behaviour, but
  cache hits in a batch are best effort.
