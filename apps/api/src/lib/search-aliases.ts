import type { Db } from "../db/index.js";

/** Lowercase with accents removed. Every alias key and name comparison uses this form. */
export function fold(s: string): string {
  return s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** What a phrase means: a country and/or language, as named in the catalog (not as typed). */
export interface AliasHit {
  country?: string;
  language?: string;
}

export interface AliasIndex {
  /** folded phrase (country or language name, demonym) -> canonical catalog names */
  spans: Map<string, AliasHit>;
  /** longest phrase in `spans`, in words */
  maxSpan: number;
  /** "DE" -> "Germany", only for codes present in the catalog */
  countryByCode: Map<string, string>;
  /** ISO 639-1 "es" -> "Spanish", only for languages present in the catalog */
  languageByCode1: Map<string, string>;
  /** folded word -> category id */
  categories: Map<string, string>;
}

/** Quality words -> minimum quality key (see QUALITY_MIN_RANK in quality.ts). */
export const QUALITY_WORDS: Record<string, string> = {
  "4k": "2160p",
  uhd: "2160p",
  "2160p": "2160p",
  fhd: "1080p",
  "1080p": "1080p",
  hd: "720p",
  "720p": "720p",
};

/** Plain words people use for a category id. Targets are checked against the catalog at build time. */
export const CATEGORY_SYNONYMS: Record<string, string> = {
  sport: "sports",
  sports: "sports",
  film: "movies",
  films: "movies",
  movie: "movies",
  cinema: "movies",
  cartoon: "kids",
  cartoons: "kids",
  children: "kids",
  child: "kids",
  kid: "kids",
  religion: "religious",
  church: "religious",
  documentaries: "documentary",
  educational: "education",
  food: "cooking",
  classics: "classic",
  car: "auto",
  cars: "auto",
  shopping: "shop",
};

/**
 * ISO 639-1 codes typed as a single lowercase word ("es", "fr"). Only used for one-word queries. "uk" is left out:
 * people type it for the United Kingdom far more often than for Ukrainian.
 */
const ISO639_1: Record<string, string> = {
  en: "eng", es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por", ru: "rus", ar: "ara", zh: "zho",
  hi: "hin", ja: "jpn", ko: "kor", tr: "tur", pl: "pol", nl: "nld", el: "ell", he: "heb", hu: "hun",
  sv: "swe", da: "dan", fi: "fin", cs: "ces", sk: "slk", ro: "ron", sr: "srp", hr: "hrv", bg: "bul",
  th: "tha", vi: "vie", id: "ind", ms: "msa", ta: "tam", te: "tel", bn: "ben", ur: "urd",
  fa: "fas", sq: "sqi", ca: "cat",
};

/**
 * Demonyms, native names and common alternative spellings. `c` is ISO 3166 alpha-2 (the first one the
 * catalog has wins), `l` is ISO 639-3. Country and language names in the catalog are added from its
 * own tables, so this list only needs the words the tables do not contain.
 */
const DEMONYMS: Record<string, { c?: string[]; l?: string[] }> = {
  germany: { c: ["DE"] }, german: { c: ["DE"], l: ["deu"] }, deutschland: { c: ["DE"] },
  deutsch: { c: ["DE"], l: ["deu"] }, austria: { c: ["AT"] }, austrian: { c: ["AT"] },
  osterreich: { c: ["AT"] }, switzerland: { c: ["CH"] }, swiss: { c: ["CH"] },
  france: { c: ["FR"] }, french: { c: ["FR"], l: ["fra"] }, francais: { c: ["FR"], l: ["fra"] },
  spain: { c: ["ES"] }, spanish: { l: ["spa"] }, espana: { c: ["ES"] }, espanol: { l: ["spa"] },
  italy: { c: ["IT"] }, italian: { c: ["IT"], l: ["ita"] },
  italia: { c: ["IT"], l: ["ita"] }, portugal: { c: ["PT"] }, portuguese: { c: ["PT"], l: ["por"] },
  portugues: { c: ["PT"], l: ["por"] }, brazil: { c: ["BR"] }, brazilian: { c: ["BR"], l: ["por"] },
  brasil: { c: ["BR"], l: ["por"] }, russia: { c: ["RU"] }, russian: { c: ["RU"], l: ["rus"] },
  "русский": { c: ["RU"], l: ["rus"] }, china: { c: ["CN"] }, chinese: { c: ["CN"], l: ["zho"] },
  mandarin: { l: ["zho"] }, cantonese: { l: ["yue"] }, india: { c: ["IN"] }, indian: { c: ["IN"] },
  hindi: { l: ["hin"] }, tamil: { l: ["tam"] }, telugu: { l: ["tel"] }, bengali: { l: ["ben"] },
  bangla: { l: ["ben"] }, urdu: { l: ["urd"] }, punjabi: { l: ["pan"] }, marathi: { l: ["mar"] },
  japan: { c: ["JP"] }, japanese: { c: ["JP"], l: ["jpn"] }, korea: { c: ["KR"] },
  korean: { c: ["KR"], l: ["kor"] }, turkey: { c: ["TR"] }, turkiye: { c: ["TR"] },
  turkish: { c: ["TR"], l: ["tur"] }, netherlands: { c: ["NL"] }, holland: { c: ["NL"] },
  dutch: { c: ["NL"], l: ["nld"] }, poland: { c: ["PL"] }, polska: { c: ["PL"] },
  polish: { c: ["PL"], l: ["pol"] }, sweden: { c: ["SE"] }, swedish: { c: ["SE"], l: ["swe"] },
  svenska: { c: ["SE"], l: ["swe"] }, norway: { c: ["NO"] }, norwegian: { c: ["NO"], l: ["nor"] },
  denmark: { c: ["DK"] }, danish: { c: ["DK"], l: ["dan"] }, finland: { c: ["FI"] },
  finnish: { c: ["FI"], l: ["fin"] }, czech: { c: ["CZ"], l: ["ces"] }, slovak: { c: ["SK"], l: ["slk"] },
  croatian: { c: ["HR"], l: ["hrv"] }, bulgarian: { c: ["BG"], l: ["bul"] }, albanian: { c: ["AL"], l: ["sqi"] },
  ukraine: { c: ["UA"] }, ukrainian: { c: ["UA"], l: ["ukr"] }, serbia: { c: ["RS"] },
  serbian: { c: ["RS"], l: ["srp"] }, srbija: { c: ["RS"] }, greece: { c: ["GR"] },
  greek: { c: ["GR"], l: ["ell"] }, hellas: { c: ["GR"] }, ellada: { c: ["GR"] }, romania: { c: ["RO"] },
  romanian: { c: ["RO"], l: ["ron"] }, hungary: { c: ["HU"] }, hungarian: { c: ["HU"], l: ["hun"] },
  magyar: { c: ["HU"], l: ["hun"] }, israel: { c: ["IL"] }, israeli: { c: ["IL"] }, hebrew: { l: ["heb"] },
  iran: { c: ["IR"] }, persian: { l: ["fas"] }, farsi: { l: ["fas"] }, arabic: { l: ["ara"] },
  pakistan: { c: ["PK"] }, bangladesh: { c: ["BD"] }, vietnam: { c: ["VN"] },
  vietnamese: { c: ["VN"], l: ["vie"] }, thailand: { c: ["TH"] }, thai: { c: ["TH"], l: ["tha"] },
  indonesia: { c: ["ID"] }, indonesian: { c: ["ID"], l: ["ind"] }, bahasa: { l: ["ind"] },
  malay: { l: ["msa"] }, philippines: { c: ["PH"] }, filipino: { c: ["PH"], l: ["fil"] },
  tagalog: { l: ["tgl"] }, nigeria: { c: ["NG"] }, nigerian: { c: ["NG"] }, kenya: { c: ["KE"] },
  kenyan: { c: ["KE"] }, swahili: { l: ["swa"] }, mexico: { c: ["MX"] }, mexican: { c: ["MX"] },
  argentina: { c: ["AR"] }, argentinian: { c: ["AR"] }, argentine: { c: ["AR"] }, chile: { c: ["CL"] },
  chilean: { c: ["CL"] }, colombia: { c: ["CO"] }, colombian: { c: ["CO"] }, peru: { c: ["PE"] },
  peruvian: { c: ["PE"] }, venezuela: { c: ["VE"] }, venezuelan: { c: ["VE"] }, ecuador: { c: ["EC"] },
  ecuadorian: { c: ["EC"] }, bolivia: { c: ["BO"] }, bolivian: { c: ["BO"] }, guatemala: { c: ["GT"] },
  guatemalan: { c: ["GT"] }, dominican: { c: ["DO"] }, canada: { c: ["CA"] }, canadian: { c: ["CA"] },
  usa: { c: ["US"] }, america: { c: ["US"] }, american: { c: ["US"] }, britain: { c: ["GB", "UK"] },
  british: { c: ["GB", "UK"] }, england: { c: ["GB", "UK"] }, english: { l: ["eng"] },
  uae: { c: ["AE"] }, emirates: { c: ["AE"] }, egypt: { c: ["EG"] }, egyptian: { c: ["EG"] },
  morocco: { c: ["MA"] }, moroccan: { c: ["MA"] },
};

export const EMPTY_ALIASES: AliasIndex = {
  spans: new Map(),
  maxSpan: 1,
  countryByCode: new Map(),
  languageByCode1: new Map(),
  categories: new Map(),
};

function buildAliasIndex(db: Db): AliasIndex {
  const countries = db
    .prepare("SELECT code, name FROM countries WHERE channel_count > 0")
    .all() as Array<{ code: string; name: string }>;
  const languages = db
    .prepare("SELECT code, name FROM languages WHERE channel_count > 0")
    .all() as Array<{ code: string; name: string }>;
  const cats = db.prepare("SELECT id FROM categories WHERE channel_count > 0").all() as Array<{ id: string }>;

  const countryName = new Map(countries.map((c) => [c.code.toUpperCase(), c.name]));
  const languageName = new Map(languages.map((l) => [l.code, l.name]));

  const spans = new Map<string, AliasHit>();
  let maxSpan = 1;
  const add = (key: string, hit: AliasHit) => {
    const k = fold(key);
    if (!k) return;
    const prev = spans.get(k) ?? {};
    spans.set(k, { country: prev.country ?? hit.country, language: prev.language ?? hit.language });
    maxSpan = Math.max(maxSpan, k.split(" ").length);
  };

  for (const c of countries) add(c.name, { country: c.name });
  for (const l of languages) add(l.name, { language: l.name });
  for (const [key, codes] of Object.entries(DEMONYMS)) {
    const country = codes.c?.map((c) => c.toUpperCase()).find((c) => countryName.has(c));
    const language = codes.l?.find((l) => languageName.has(l));
    if (!country && !language) continue;
    add(key, {
      country: country ? countryName.get(country) : undefined,
      language: language ? languageName.get(language) : undefined,
    });
  }

  const languageByCode1 = new Map<string, string>();
  for (const [iso1, iso3] of Object.entries(ISO639_1)) {
    const name = languageName.get(iso3);
    if (name) languageByCode1.set(iso1, name);
  }

  const categories = new Map<string, string>();
  const catIds = new Set(cats.map((c) => c.id));
  for (const id of catIds) categories.set(fold(id), id);
  for (const [word, id] of Object.entries(CATEGORY_SYNONYMS)) if (catIds.has(id)) categories.set(fold(word), id);

  return {
    spans,
    maxSpan: Math.min(maxSpan, 5),
    countryByCode: countryName,
    languageByCode1,
    categories,
  };
}

// Built per DB handle and rebuilt when the catalog is re-ingested (meta.last_ingest changes).
const cache = new WeakMap<Db, { version: string; index: AliasIndex }>();

/** Alias tables for a DB handle. Falls back to no aliases when the DB or its tables are missing. */
export function aliasIndexFor(db: Db | null | undefined): AliasIndex {
  if (!db) return EMPTY_ALIASES;
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'last_ingest'").get() as { value: string } | undefined;
    const version = row?.value ?? "";
    const hit = cache.get(db);
    if (hit && hit.version === version) return hit.index;
    const index = buildAliasIndex(db);
    cache.set(db, { version, index });
    return index;
  } catch {
    return EMPTY_ALIASES;
  }
}
