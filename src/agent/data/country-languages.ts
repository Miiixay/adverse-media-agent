import type { Language } from "../types";

// Languages in which each country's national press publishes at scale, not every official
// language: German in Belgium, Romansh in Switzerland, Luxembourgish and Irish are left out so the
// search budget goes to the languages that carry adverse media (D-19). prepare() adds English.
export const COUNTRY_LANGUAGES: ReadonlyMap<string, readonly Language[]> = new Map([
  ["AT", ["de"]],
  ["BE", ["nl", "fr"]],
  ["CH", ["de", "fr", "it"]],
  ["CZ", ["cs"]],
  ["DE", ["de"]],
  ["DK", ["da"]],
  ["ES", ["es"]],
  ["FI", ["fi", "sv"]],
  ["FR", ["fr"]],
  ["GB", ["en"]],
  ["GR", ["el"]],
  ["IE", ["en"]],
  ["IT", ["it"]],
  ["LU", ["fr", "de"]],
  ["NL", ["nl"]],
  ["NO", ["no"]],
  ["PL", ["pl"]],
  ["PT", ["pt"]],
  ["RO", ["ro"]],
  ["SE", ["sv"]],
  ["SK", ["sk"]],
  ["TR", ["tr"]],
  ["US", ["en"]],
]);
