import Link from "next/link";

import { COUNTRIES } from "./countries";
import { ScreeningForm } from "./screening-form";

export default function Home() {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Adverse media screening</h1>
        <p>
          Searches the national and international press for adverse coverage of an individual, and
          rates the risk from what it finds. A screening is one-shot: tick Add to daily monitoring
          to have the person screened again each day, or manage monitoring from the{" "}
          <Link href="/watchlist">watchlist</Link>.
        </p>
      </header>
      <ScreeningForm countries={COUNTRIES} />
    </main>
  );
}
