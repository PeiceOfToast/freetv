# Track S (search quality): notes

Scope: `GET /api/channels?q=` ranking and query understanding. Route files and `docs/API.md` are untouched.

## What changed

| file | change |
|------|--------|
| `apps/api/src/lib/channel-query.ts` | `planChannels` uses the new parser. bm25 weights, name-tier boost, stream and guide tie-breakers. Category and quality words become filters. `sanitizeFts` is re-exported from the parser. The `opts.db` option is optional; without it the open catalog is used. |
| `apps/api/src/lib/search-parse.ts` (new) | `parseQuery(raw, aliases)`: tokenises, expands aliases, builds the FTS5 MATCH string. Only letters, digits, spaces and FTS keywords this file writes ever reach the MATCH string. |
| `apps/api/src/lib/search-aliases.ts` (new) | Alias index built from `countries`, `languages` and `categories` on first use per DB handle (rebuilt when `meta.last_ingest` changes). Hand-written table: about 140 demonyms, native names and ISO 639-1 codes. Quality words. Category synonyms. |
| `apps/api/src/lib/search-suggest.ts` (new) | `suggest(db, q, limit)` returns `[{id, name, countryName, logo}]`, ranked by the same planner. Not wired to a route. |
| `apps/api/test/search.test.ts` (new) | 30 tests: parser units, fixture ranking, aliases, filters, hostile input, suggest. |

`npm run typecheck` passes. `npm test` passes: 182 of 182, including the existing `routes-catalog` tests.

## Ranking

Order for `sort=relevance` (default when `q` has searchable text):

1. Name tier: the query text equals `name_sort` (1), or starts it (2), or neither (3). This is a strong boost, so "bbc" puts BBC names ahead of "Global BBC ..." style alt-name matches.
2. Channels with streams (`has_stream`) first.
3. bm25 with weights: id 4, name 10, alt_names 6, network 3, owners 2, country_name 1, language_names 1.
4. Light tie-breakers: has a guide, then more streams, then name, then id.

With no text (category or quality words only) the order is: name tier, streams, guide, stream count. `sort=name` and the other sorts still work with `q`. `order=desc` reverses the bm25 term.

## Query understanding

- **Tokens.** Split on anything that is not a letter or digit. Stopwords (`the`, `a`, `an`, `of`, `and`, `channel`, `channels`, `watch`) are dropped when other words remain. The last word gets a prefix match.
- **Accents.** Matched after folding, so `télé` and `tele` return the same list.
- **Letter/digit splits.** `BBC1` also matches the phrase `BBC 1`, and `4fun` matches `4 fun`.
- **Country.** Names from the `countries` table ("Dominican Republic", "South Africa", multi-word spans up to 5 words). Demonyms and codes map to the country: "german", "deutsch", "germany" and "DE" all match `country_name`.
- **Language.** Names from the `languages` table, plus demonyms and native names ("espanol" to Spanish, "deutsch" to German). Matched against `language_names`.
- **Codes.** Uppercase two-letter tokens that are country codes match exactly (`DE`, `US`, `UK`). A lowercase two-letter token is a language code only when it is the whole query (`es` alone). In a longer query, lowercase codes stay plain words, so "cnn en espanol" is still a name.
- **Category words** ("news", "sports", "kids", "music", ...) and synonyms ("sport", "film", "cartoon", "church") become a filter: channels must be in at least one. The word is still used for the whole-name tier, so "news 24" ranks "News 24" first.
- **Quality words.** "4k" and "uhd" mean 2160p and up. "fhd" and "1080p" mean 1080p and up. "hd" and "720p" mean 720p and up. The `quality` param and a word in `q` combine; the stricter one wins.

## Safety

- The MATCH string is built only from quoted letter-and-digit phrases, the `AND`/`OR` keywords and column filters on two fixed column names. Quotes, `*`, `(`, `NEAR`, `-`, `^`, `:` in user input become ordinary text or are dropped.
- FTS5 rejects implicit AND after a parenthesised group. The parser joins units with an explicit `AND`. A regression test covers this case (`1Plus1Marafon.ua`).
- ORDER BY never gets a bare integer. SQLite reads `ORDER BY 3` as column position 3, which made quality-only queries fail; the tier helper returns the expression `(0 + 3)` instead. A test covers `4k`, `hd`, `1080p`.
- Fuzz: 52 hand-written hostile queries (test), 16,000 random queries built from real channel names, ids and alias words, and 3,600 filter-only combinations with every sort and order, all against the real catalog. Zero SQL errors.

## Before and after examples

Top five by relevance on the real catalog (31,587 channels, `hasStream=true`, NSFW hidden). "Before" is the previous planner. Totals are in brackets.

| query | before | after |
|-------|--------|-------|
| `bbc` (54 to 54) | BBC One ; BBC Four ; BBC NL ; BBC Parliament ; BBC Three | BBC One ; BBC Two ; BBC Four ; BBC Three ; BBC Parliament |
| `news` (324 to 973) | 22Scope News ; 365 News ; 7 News ; Aik News ; ANB News | Newsmax 2 ; News 24 ; News 7 Tamil ; News9Live ; Newsmax TV (category news) |
| `cnn international` (2 to 2) | CNN International ; CNN Indonesia | same |
| `german` (469 to 469) | Euronews German ; Germany Shore ; Hope Channel German ; Nickelodeon ; MTV | Germany Shore ; ZDF ; Handystar ; NRWision ; OK54 (see limits) |
| `spanish news` (7 to 136) | Newsmax Spanish ; Estrella News ; News of the World ; BBC News ; CNN International | Newsmax Spanish ; Euronews Spanish ; CGTN Spanish ; HCH ; TN (news category, Spanish language) |
| `4k sports` (0 to 0) | none | none (no 2160p sports channel in the catalog; 16 channels are 2160p in total) |
| `télé` (1043 to 1043) | Telered Television ; TeleDanli ; TeleFormula ; Teleganes ; TeleGohelle | Telered Television ; TeleFormula ; Telemedellin ; Telesambre ; TeleZuri |
| `al jazeera` (6 to 6) | Al Jazeera ; Al Jazeera Documentary ; ... | same |
| `hbo` (23 to 23) | HBO Hits ; HBO ; HBO 2 ; HBO 3 ; HBO Hits Asia | HBO ; HBO ; HBO ; HBO Hits ; HBO 3 (exact name first) |
| `kids` (60 to 363) | Biznet Kids ; STS kids ; 4 Fun Kids ; Box Kids TV ; Bravo! Kids TV | Kids TV ; KidsFlix ; Kids Movie Club ; Kids Zone ; Disney Channel Latin America (kids category) |
| `BBC1` (1 to 1) | BBC One | BBC One |
| `germany` (385 to 385) | Germany Shore ; MTV ; Nickelodeon ; DW ; Filstalwelle | Germany Shore ; Nickelodeon ; MTV ; ZDF ; Handystar (all DE channels match) |
| `news 24` (15 to 60) | LaC News 24 ; News Daily 24 ; News India 24x7 ; News Marathi 24x7 ; Silverbird News 24 | News 24 ; News 24 ; News 24 MP & Chhattisgarh ; 24 Kanal ; 24 Horas |
| `uk` (404 to 210) | History Ukraine ; History2 Ukraine ; Konkurent Ukraine ; ... | TBN UK ; Faith UK ; ATN Bangla UK ; Alb UK TV ; Dunya News UK (UK country) |
| `sport` (203 to 414) | Sport ; Multivision Sports ; Realitatea Sportiva ; Sport ; Alfa Sport | Sport ; Sport ; Sport ; SportsGrid ; Sportitalia (sports category) |
| `music box` (8 to 9) | Music Box Brazil ; Music Box 80s ; ... | Music Box Brazil ; Music Box 80s ; ... (music category, Music Box names first) |

## Timings

In-process measurement: the planner's COUNT and list SQL, 30 runs per query, p50 and p95, on a copy of `apps/api/.data/catalog.db`. Not HTTP. The list uses `LIMIT 60`, as the route does with the default limit.

| query | before p50 / p95 (ms) | after p50 / p95 (ms) |
|-------|-----------------------|----------------------|
| bbc | 0.8 / 1.4 | 0.5 / 1.0 |
| news | 5.1 / 9.2 | 12.4 / 16.4 |
| cnn international | 0.2 / 0.8 | 0.2 / 0.3 |
| german | 4.2 / 7.2 | 5.5 / 9.4 |
| spanish news | 0.8 / 1.6 | 20.0 / 26.0 |
| 4k sports | 0.2 / 0.4 | 12.8 / 15.9 |
| télé | 13.0 / 17.6 | 12.4 / 13.7 |
| al jazeera | 0.1 / 0.3 | 0.2 / 0.2 |
| hbo | 0.3 / 0.5 | 0.3 / 0.4 |
| kids | 0.8 / 1.3 | 10.9 / 13.0 |

All p95 values are under 30 ms, under the 50 ms target. The slower cases now match many more rows (category filters on 973 or 363 channels, or a Spanish language OR group), so they cost more. `4k sports` pays the COUNT and list cost even with zero results.

## Limits and decisions to review

1. **Category words are hard filters.** "music box" returns music-category channels only, so a "Sport Klub" outside the sports category is excluded from "sport". The spec asked for this; it is the main behaviour change for existing queries.
2. **"bbc" does not put BBC News in the top five.** It is a name-prefix match, and bm25 favours shorter names among equal tiers. Fine for the spec ("BBC News/BBC One before alt-name matches"), but a `news` tie-breaker would be the next step.
3. **"german" puts name-prefix matches first.** "Germany Shore" is a prefix of "german", so it beats "Euronews German", a German-language channel. Language matches still come back, just lower.
4. **"DE" is led by names that start with "de".** The code matches exactly, but the whole-name tier then ranks "Deluxe ..." (German channels) first. Suppressing the name tier for code queries would fix it; not done.
5. **"hd" means 720p and up**, so channels with no quality data are excluded. Documented, but a judgment call.
6. **Ukrainian is not reachable as "uk".** "uk" means the United Kingdom, as people usually type it. "ua" and "ukrainian" still work.
7. **Spanish is a language, not a country.** "spanish" maps to `language_names` only, as the spec asked. "spain" and "espana" map to Spain.
8. **A query of punctuation only** (for example `-` or `"`) still returns the unfiltered list, as before.
9. **Raw non-ASCII in a URL** returns 400 from Fastify before the planner runs. Percent-encode `é` as `%C3%A9`. This is not new and not in the search code.
10. **The alias index is cached per DB handle**, keyed by `meta.last_ingest`, so a re-ingest refreshes it on the next request.

## Suggestions for the integrator (not applied: frozen contracts or other tracks)

- `docs/API.md` `q` row: the search now understands country, language, category and quality words. Suggested text: "Full-text search over name, alt names, network, owners, country and language names, id. Prefix match on the last word. Words that name a category, a quality (`4k`, `hd`, `1080p`) or a country/language filter the results; the rest is matched as text. Punctuation is ignored."
- `suggest()` is ready for a `GET /api/suggest?q=&limit=` route: `suggest(getDb(), q, limit)`.
- If the spec wants "BBC News" first for "bbc", add a tier for names whose first word equals the query.

## How to check by hand

The port used by the default server (3000) was already taken on this sandbox, so the manual check ran on a different port:

```
cd apps/api && PORT=3917 DATA_DIR=$PWD/.data PROXY_SECRET=x LOG_LEVEL=warn npx tsx src/server.ts
curl -s "localhost:3917/api/channels?q=spanish%20news&limit=5"
```

Startup tries to fetch iptv-org and logs a failure when offline. The catalog is not changed by that.
