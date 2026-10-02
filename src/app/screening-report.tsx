import type { ReactNode } from "react";

import type { Finding, ScreeningResult } from "@/agent/types";

const WEB_PROTOCOLS = new Set(["http:", "https:"]);

export function ScreeningReport({ result }: { result: ScreeningResult }) {
  const counted = result.findings.filter((finding) => finding.countedInScore);
  const shown = result.findings.filter((finding) => !finding.countedInScore);
  const unsourced = result.coverage.errors.find((error) => error.code === "unsourced_summary");
  const lowLabel = lowRiskLabel(result, counted.length);
  return (
    <article className="report">
      <div className="verdict">
        <span className={`badge risk-${result.risk}`}>Risk {result.risk}</span>
        <span className={`badge status-${result.status}`}>
          {result.status === "complete" ? "Coverage complete" : "Coverage incomplete"}
        </span>
        <span className="badge neutral">Confidence {result.confidence}</span>
      </div>
      {lowLabel !== null && <p className="verdict-label">{lowLabel}</p>}
      {result.modelSuggestedRisk !== null && (
        <p className="model-opinion">
          Model&apos;s own assessment: {result.modelSuggestedRisk}
          {result.riskDisagreement && (
            <span className="disagreement"> · differs from the computed level</span>
          )}
        </p>
      )}
      <LevelDefinitions />
      {result.status === "incomplete" && (
        <p className="notice notice-warning">
          Some searches failed or the answer could not be trusted: a low risk here is not a clean
          result. See the errors under Coverage.
        </p>
      )}
      <p className="summary">{result.summary ?? "The model returned no usable summary."}</p>
      {unsourced !== undefined && (
        <p className="notice notice-warning">
          {unsourced.detail.charAt(0).toUpperCase() + unsourced.detail.slice(1)}. A matter it
          describes may have no finding below.
        </p>
      )}

      <h2>Findings counted in the risk ({counted.length})</h2>
      {counted.length === 0 ? (
        <p className="muted">No finding counts in the risk.</p>
      ) : (
        counted.map((finding) => <FindingCard key={finding.url} finding={finding} />)
      )}

      {shown.length > 0 && (
        <>
          <h2>Shown, not counted ({shown.length})</h2>
          <p className="muted">
            Probable namesakes, rated low on identity, matters of associates in which the person is
            not involved, and matters reported by a blog or a social network only.
          </p>
          {shown.map((finding) => (
            <FindingCard key={finding.url} finding={finding} />
          ))}
        </>
      )}

      <Coverage result={result} />
      <Usage result={result} />
    </article>
  );
}

function FindingCard({ finding }: { finding: Finding }) {
  return (
    <section className={finding.countedInScore ? "finding" : "finding finding-uncounted"}>
      <header className="finding-header">
        <h3>
          <ExternalLink url={finding.url}>{finding.title}</ExternalLink>
        </h3>
        {finding.riskLevel === null ? (
          <span className="badge neutral">{uncountedReason(finding)}</span>
        ) : (
          <span className={`badge risk-${finding.riskLevel}`}>Level {finding.riskLevel}</span>
        )}
      </header>
      <p className="finding-source">
        {domainOf(finding.url)} · {label(finding.sourceReliability)} · {finding.language} ·{" "}
        {finding.date ?? "undated"}
      </p>
      <dl className="facts">
        <Fact name="Category">{label(finding.category)}</Fact>
        <Fact name="Severity">{finding.severity}</Fact>
        <Fact name="Status">{finding.status}</Fact>
        <Fact name="Subject">{finding.subject}</Fact>
        <Fact name="Identity">{finding.identityConfidence}</Fact>
      </dl>
      <p>{finding.summary}</p>
      {finding.identityEvidence.length > 0 && (
        <ul className="evidence">
          {finding.identityEvidence.map((evidence) => (
            <li key={evidence}>{evidence}</li>
          ))}
        </ul>
      )}
      {finding.corroboratingUrls.length > 0 && (
        <p className="corroboration">
          Also reported by:{" "}
          {finding.corroboratingUrls.map((url, index) => (
            <span key={url}>
              {index > 0 && ", "}
              <ExternalLink url={url}>{domainOf(url)}</ExternalLink>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function Coverage({ result }: { result: ScreeningResult }) {
  const { coverage } = result;
  return (
    <section className="panel">
      <h2>Coverage</h2>
      <dl className="facts">
        <Fact name="Languages">{coverage.languages.join(", ")}</Fact>
        <Fact name="Country localized">{coverage.countrySupported ? "yes" : "no"}</Fact>
        <Fact name="Searches">{coverage.searchesUsed}</Fact>
        <Fact name="Articles read">{coverage.articlesReviewed}</Fact>
        {coverage.aliases.length > 0 && (
          <Fact name="Other names in the sources">{coverage.aliases.join(", ")}</Fact>
        )}
      </dl>
      <h3>Planned queries</h3>
      <ul className="queries">
        {coverage.plannedQueries.map((query) => (
          <li key={query}>{query}</li>
        ))}
      </ul>
      {coverage.executedQueries.some((query) => !coverage.plannedQueries.includes(query)) && (
        <>
          <h3>Queries run by the model</h3>
          <ul className="queries">
            {coverage.executedQueries.map((query) => (
              <li key={query}>{query}</li>
            ))}
          </ul>
        </>
      )}
      <h3>Errors</h3>
      {coverage.errors.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        <ul>
          {coverage.errors.map((error) => (
            <li key={`${error.code}:${error.detail}`}>
              <code>{error.code}</code> {error.detail}
            </li>
          ))}
        </ul>
      )}
      <h3>Rejected URLs ({coverage.rejectedUrls.length})</h3>
      {coverage.rejectedUrls.length === 0 ? (
        <p className="muted">None.</p>
      ) : (
        // Shown as text, never as links: these URLs failed the checks.
        <ul className="urls">
          {coverage.rejectedUrls.map((url) => (
            <li key={url}>{url}</li>
          ))}
        </ul>
      )}
      <details>
        <summary>URLs read ({coverage.urlsReviewed.length})</summary>
        <ul className="urls">
          {coverage.urlsReviewed.map((url) => (
            <li key={url}>
              <ExternalLink url={url}>{url}</ExternalLink>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Usage({ result }: { result: ScreeningResult }) {
  const { usage } = result;
  return (
    <footer className="usage">
      <span>Cost ${usage.estimatedCostUsd.toFixed(4)}</span>
      <span>
        {usage.webSearches} {usage.webSearches === 1 ? "search" : "searches"}
      </span>
      <span>
        Tokens: {usage.inputTokens.toLocaleString("en-US")} input,{" "}
        {usage.cacheReadTokens.toLocaleString("en-US")} cache read,{" "}
        {(usage.cacheWrite5mTokens + usage.cacheWrite1hTokens).toLocaleString("en-US")} cache write,{" "}
        {usage.outputTokens.toLocaleString("en-US")} output
      </span>
      {usage.apiCalls > 1 && <span>{usage.apiCalls} model calls</span>}
      {result.coverage.escalatedTo !== null && (
        <span>
          Screened again on {result.coverage.escalatedTo} after a first pass that showed:{" "}
          {result.coverage.escalationSignals.map(label).join(", ")}
        </span>
      )}
      <span>Model {result.model}</span>
      <span>Prompt {result.promptVersion}</span>
      <span>{(result.durationMs / 1000).toFixed(1)} s</span>
    </footer>
  );
}

function Fact({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

// The agent already keeps http and https URLs only; a link is checked again where it is rendered.
function ExternalLink({ url, children }: { url: string; children: ReactNode }) {
  if (!isWebUrl(url)) return <span>{children}</span>;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

function isWebUrl(url: string): boolean {
  return URL.canParse(url) && WEB_PROTOCOLS.has(new URL(url).protocol);
}

function domainOf(url: string): string {
  return URL.canParse(url) ? new URL(url).hostname.replace(/^www[.]/, "") : url;
}

// A low risk says one of two things: nothing adverse came back, or what came back weighs little.
// The first is only said of a complete coverage, where an empty result means something.
function lowRiskLabel(result: ScreeningResult, counted: number): string | null {
  if (result.risk !== "low") return null;
  if (counted > 0) return "Minor or old matters only";
  if (result.status !== "complete") return null;
  const reviewed = result.coverage.articlesReviewed;
  return `No adverse media found in ${reviewed} ${reviewed === 1 ? "article" : "articles"} reviewed`;
}

function LevelDefinitions() {
  return (
    <dl className="levels">
      <dt>
        <span className="badge risk-high">High</span>
      </dt>
      <dd>
        A counted finding about the person, at high identity: fraud, money laundering, corruption,
        sanctions, terrorism or organized crime beyond a mere allegation, or a final conviction or
        sanction in another category. An allegation alone never reaches high.
      </dd>
      <dt>
        <span className="badge risk-medium">Medium</span>
      </dt>
      <dd>
        A counted finding to review that does not reach high: an allegation of a financial crime, a
        civil, regulatory or reputational matter, a matter of an organization the person leads, or a
        serious matter at medium identity.
      </dd>
      <dt>
        <span className="badge risk-low">Low</span>
      </dt>
      <dd>
        No counted finding, or only matters that weigh little: acquittals, minor matters over ten
        years old, civil, regulatory or reputational claims undecided for two years. Namesakes,
        associates and blog or social sources are shown, never counted.
      </dd>
      <dt>
        <span className="badge status-incomplete">Coverage incomplete</span>
      </dt>
      <dd>
        A planned search did not run or failed, or the answer could not be trusted: a low risk then
        does not show that nothing exists.
      </dd>
    </dl>
  );
}

function label(value: string): string {
  return value.replaceAll("_", " ");
}

function uncountedReason(finding: Finding): string {
  if (finding.subject === "associate") return "Associate";
  if (finding.identityConfidence === "low") return "Probable namesake";
  if (finding.sourceReliability === "blog" || finding.sourceReliability === "social") {
    return "Blog or social source";
  }
  return "Not counted";
}
