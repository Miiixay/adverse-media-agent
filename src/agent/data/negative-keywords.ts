import type { Language } from "../types";

export type KeywordCategory =
  | "fraud"
  | "money_laundering"
  | "corruption"
  | "sanctions"
  | "terrorism"
  | "organized_crime"
  | "violence"
  | "legal_proceedings"
  // Regulatory and civil matters: an inquiry, a lawsuit, a fine, a supervisor, a scandal (D-38).
  | "regulatory_civil";

// Nouns are preferred over participles in languages that inflect them by gender ("condamnation"
// rather than "condamné" / "condamnée"), so that one term matches articles about anyone. Within an
// offence category the most common press term comes first: it is the one the query keeps.
// Positions carry a role the query relies on (D-39): legal_proceedings starts with the conviction
// term, then the charge term; regulatory_civil starts with the investigation, lawsuit and scandal
// terms, in that order.
// Other spellings of a term, searched with it wherever the term is: British and American English
// for the international press.
export const SPELLING_VARIANTS: Readonly<Partial<Record<string, readonly string[]>>> = {
  "organized crime": ["organised crime"],
};

export const NEGATIVE_KEYWORDS: Record<Language, Record<KeywordCategory, readonly string[]>> = {
  cs: {
    fraud: ["podvod", "zpronevěra"],
    money_laundering: ["praní špinavých peněz"],
    corruption: ["korupce", "úplatek"],
    sanctions: ["sankce"],
    terrorism: ["terorismus"],
    organized_crime: ["organizovaný zločin", "mafie"],
    violence: ["napadení", "vražda"],
    legal_proceedings: ["odsouzení", "obvinění", "obžaloba"],
    regulatory_civil: ["vyšetřování", "žaloba", "skandál", "pokuta", "dozor"],
  },
  da: {
    fraud: ["bedrageri", "underslæb"],
    money_laundering: ["hvidvask"],
    corruption: ["korruption", "bestikkelse"],
    sanctions: ["sanktioner"],
    terrorism: ["terrorisme"],
    organized_crime: ["organiseret kriminalitet", "bandekriminalitet"],
    violence: ["vold", "drab"],
    legal_proceedings: ["dømt", "tiltalt", "anholdt"],
    regulatory_civil: ["efterforskning", "retssag", "skandale", "bøde", "tilsyn"],
  },
  de: {
    fraud: ["Betrug", "Veruntreuung"],
    money_laundering: ["Geldwäsche"],
    corruption: ["Korruption", "Bestechung"],
    sanctions: ["Sanktionen"],
    terrorism: ["Terrorismus"],
    organized_crime: ["organisierte Kriminalität", "Mafia"],
    violence: ["Körperverletzung", "Mord"],
    legal_proceedings: ["Verurteilung", "Anklage", "Ermittlungen"],
    regulatory_civil: ["Ermittlungen", "Klage", "Skandal", "Bußgeld", "Aufsicht"],
  },
  el: {
    fraud: ["απάτη", "υπεξαίρεση"],
    money_laundering: ["ξέπλυμα χρήματος"],
    corruption: ["διαφθορά", "δωροδοκία"],
    sanctions: ["κυρώσεις"],
    terrorism: ["τρομοκρατία"],
    organized_crime: ["οργανωμένο έγκλημα", "μαφία"],
    violence: ["επίθεση", "δολοφονία"],
    legal_proceedings: ["καταδίκη", "δίωξη", "σύλληψη"],
    regulatory_civil: ["έρευνα", "αγωγή", "σκάνδαλο", "πρόστιμο", "εποπτεία"],
  },
  en: {
    fraud: ["fraud", "embezzlement"],
    money_laundering: ["money laundering"],
    corruption: ["corruption", "bribery"],
    sanctions: ["sanctions"],
    terrorism: ["terrorism"],
    organized_crime: ["organized crime"],
    violence: ["assault", "murder"],
    legal_proceedings: ["convicted", "indicted", "arrested"],
    regulatory_civil: ["investigation", "lawsuit", "scandal", "fine", "regulator", "settlement"],
  },
  es: {
    fraud: ["fraude", "estafa"],
    money_laundering: ["blanqueo"],
    corruption: ["corrupción", "soborno"],
    sanctions: ["sanciones"],
    terrorism: ["terrorismo"],
    organized_crime: ["crimen organizado", "mafia"],
    violence: ["agresión", "asesinato"],
    legal_proceedings: ["condena", "imputación", "juicio"],
    regulatory_civil: ["investigación", "demanda", "escándalo", "multa", "regulador"],
  },
  fi: {
    fraud: ["petos", "kavallus"],
    money_laundering: ["rahanpesu"],
    corruption: ["korruptio", "lahjonta"],
    sanctions: ["pakotteet"],
    terrorism: ["terrorismi"],
    organized_crime: ["järjestäytynyt rikollisuus", "mafia"],
    violence: ["pahoinpitely", "murha"],
    legal_proceedings: ["tuomittu", "syyte", "pidätetty"],
    regulatory_civil: ["tutkinta", "kanne", "kohu", "sakko", "valvonta"],
  },
  fr: {
    fraud: ["fraude", "escroquerie"],
    money_laundering: ["blanchiment"],
    corruption: ["corruption", "pots-de-vin"],
    sanctions: ["sanctions"],
    terrorism: ["terrorisme"],
    organized_crime: ["crime organisé", "mafia"],
    violence: ["agression", "meurtre"],
    legal_proceedings: ["condamnation", "mise en examen", "procès"],
    regulatory_civil: ["enquête", "plainte", "scandale", "amende", "régulateur"],
  },
  it: {
    fraud: ["frode", "truffa"],
    money_laundering: ["riciclaggio"],
    corruption: ["corruzione", "tangenti"],
    sanctions: ["sanzioni"],
    terrorism: ["terrorismo"],
    organized_crime: ["criminalità organizzata", "mafia"],
    violence: ["aggressione", "omicidio"],
    legal_proceedings: ["condanna", "rinvio a giudizio", "arresto", "processo"],
    regulatory_civil: ["indagine", "causa", "scandalo", "multa", "vigilanza"],
  },
  nl: {
    fraud: ["fraude", "oplichting"],
    money_laundering: ["witwassen"],
    corruption: ["corruptie", "omkoping"],
    sanctions: ["sancties"],
    terrorism: ["terrorisme"],
    organized_crime: ["georganiseerde misdaad", "maffia"],
    violence: ["mishandeling", "moord"],
    legal_proceedings: ["veroordeeld", "aangeklaagd", "aangehouden", "rechtszaak"],
    regulatory_civil: [
      "onderzoek",
      "rechtszaak",
      "schandaal",
      "boete",
      "toezichthouder",
      "schikking",
    ],
  },
  no: {
    fraud: ["bedrageri", "underslag"],
    money_laundering: ["hvitvasking"],
    corruption: ["korrupsjon", "bestikkelser"],
    sanctions: ["sanksjoner"],
    terrorism: ["terrorisme"],
    organized_crime: ["organisert kriminalitet", "mafia"],
    violence: ["vold", "drap"],
    legal_proceedings: ["dømt", "tiltalt", "pågrepet"],
    regulatory_civil: ["etterforskning", "søksmål", "skandale", "bøtelagt", "tilsyn"],
  },
  pl: {
    fraud: ["oszustwo", "defraudacja"],
    money_laundering: ["pranie pieniędzy"],
    corruption: ["korupcja", "łapówka"],
    sanctions: ["sankcje"],
    terrorism: ["terroryzm"],
    organized_crime: ["przestępczość zorganizowana", "mafia"],
    violence: ["pobicie", "zabójstwo"],
    legal_proceedings: ["wyrok", "zarzuty", "zatrzymanie"],
    regulatory_civil: ["śledztwo", "pozew", "afera", "grzywna", "nadzór", "ugoda"],
  },
  pt: {
    fraud: ["fraude", "burla"],
    money_laundering: ["branqueamento"],
    corruption: ["corrupção", "suborno"],
    sanctions: ["sanções"],
    terrorism: ["terrorismo"],
    organized_crime: ["crime organizado", "máfia"],
    violence: ["agressão", "homicídio"],
    legal_proceedings: ["condenação", "acusação", "julgamento"],
    regulatory_civil: ["investigação", "processo", "escândalo", "multa", "regulador"],
  },
  ro: {
    fraud: ["fraudă", "înșelăciune"],
    money_laundering: ["spălare de bani"],
    corruption: ["corupție", "mită"],
    sanctions: ["sancțiuni"],
    terrorism: ["terorism"],
    organized_crime: ["crimă organizată", "mafie"],
    violence: ["agresiune", "omor"],
    legal_proceedings: ["condamnare", "trimitere în judecată", "arestare"],
    regulatory_civil: ["anchetă", "proces", "scandal", "amendă", "supraveghere"],
  },
  sk: {
    fraud: ["podvod", "sprenevera"],
    money_laundering: ["pranie špinavých peňazí"],
    corruption: ["korupcia", "úplatok"],
    sanctions: ["sankcie"],
    terrorism: ["terorizmus"],
    organized_crime: ["organizovaný zločin", "mafia"],
    violence: ["napadnutie", "vražda"],
    legal_proceedings: ["odsúdenie", "obvinenie", "obžaloba"],
    regulatory_civil: ["vyšetrovanie", "žaloba", "škandál", "pokuta", "dohľad"],
  },
  sv: {
    fraud: ["bedrägeri", "förskingring"],
    money_laundering: ["penningtvätt"],
    corruption: ["korruption", "mutor"],
    sanctions: ["sanktioner"],
    terrorism: ["terrorism"],
    organized_crime: ["organiserad brottslighet", "gängkriminalitet"],
    violence: ["misshandel", "mord"],
    legal_proceedings: ["dömd", "åtalad", "gripen"],
    regulatory_civil: ["utredning", "stämning", "skandal", "böter", "tillsyn"],
  },
  tr: {
    fraud: ["dolandırıcılık", "zimmet"],
    money_laundering: ["kara para aklama"],
    corruption: ["yolsuzluk", "rüşvet"],
    sanctions: ["yaptırım"],
    terrorism: ["terör"],
    organized_crime: ["organize suç", "mafya"],
    violence: ["saldırı", "cinayet"],
    legal_proceedings: ["hapis cezası", "iddianame", "gözaltı"],
    regulatory_civil: ["soruşturma", "dava", "skandal", "para cezası", "denetim"],
  },
};
