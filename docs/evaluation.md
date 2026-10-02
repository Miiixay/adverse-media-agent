# Evaluation

How the agent was measured, what each fixed case tests, and what every optimization changed. All
figures come from runs on 2026-10-01.

## Method

- **Fixed cases.** `fixtures/test-cases.json` holds five cases, replayed by `npm run evaluate`
  (`scripts/evaluate.ts`). The first case runs alone and the others in parallel, so that a prompt
  cache entry written by the first can be read by the next. Each case is checked against its
  expectations: the risk, the number of counted findings (exact or minimum), a minimum of namesakes
  at low identity, and a counted finding with a given language and status.
- **Cost.** Every API call reports its usage; `src/agent/cost.ts` prices it with the figures of the
  pricing page read on 2026-09-30. For Claude Sonnet 5.5, per million tokens: $2 input, $2.50
  five-minute cache write, $0.20 cache read, $10 output; plus $10 per 1,000 searches.
- **Configuration.** Model `claude-sonnet-5-5`, prompt `v1`, web search `web_search_20260318`
  called directly. The full result of each case is kept in the gitignored `logs/evaluation/`, and
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

- **Small sample.** Five cases, one run per version, with the noise described above.
- **Sparse coverage is not tested.** Both native cases have rare names and well-indexed coverage:
  regional public radio, an anti-corruption association, the legal press. The recall of one query
  per language on a person covered by a single local outlet is not measured.
- **Identity rests on the name and the country.** A date of birth or a role, if the input carried
  them, would be the main improvement.
- **Medium effort cuts free searches.** On an ambiguous identity, the model may skip the search
  that would settle it. The completeness check covers the planned queries, not the free ones.
- **Free searches on the surname alone.** They added cost and noise on the clean case. A prompt rule
  keeping the full name in free searches would bound them.
- **Quoted names are not enforced.** The search for "Jean Martin" returned Henri Martin and a street
  called rue Jean-Martin. The identity judgment is what filters them out.
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
- **`allowed_domains` or `blocked_domains`.** A block list of low-value sites could cut tokens. An
  allow list would put recall at risk on regional outlets, which carried the coverage of both native
  cases.
- **Time window for daily monitoring.** The web search tool parameters checked have no date filter.
  A 24–48 hour window would rely on the prompt and on filtering finding dates in code, together
  with the delta on URL hashes.
- **Batch API for daily monitoring.** It halves the price of tokens, not of searches. Tokens are
  73% of the v2.4 cost, so the saving would be about 36% per screening at equal cache behaviour, but
  cache hits in a batch are best effort.
