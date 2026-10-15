-- FreeTV catalog schema (SQLite), single file /data/catalog.db.
-- Ingest refills the catalog tables (everything except meta/programmes) inside ONE transaction
-- (DELETE then INSERT), so readers never see a half-built catalog and the EPG table is untouched.
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  description   TEXT,
  channel_count INTEGER NOT NULL DEFAULT 0,  -- channels (non-blocked) in this category
  stream_count  INTEGER NOT NULL DEFAULT 0   -- of those, with >=1 stream
);

CREATE TABLE IF NOT EXISTS countries (
  code          TEXT PRIMARY KEY,            -- ISO 3166-1 alpha-2
  name          TEXT NOT NULL,
  flag          TEXT,
  languages     TEXT NOT NULL DEFAULT '[]',  -- JSON array of ISO-639-3
  channel_count INTEGER NOT NULL DEFAULT 0,
  stream_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS languages (
  code          TEXT PRIMARY KEY,            -- ISO 639-3
  name          TEXT NOT NULL,
  channel_count INTEGER NOT NULL DEFAULT 0,
  stream_count  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS channels (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  alt_names      TEXT NOT NULL DEFAULT '[]', -- JSON array
  network        TEXT,
  owners         TEXT NOT NULL DEFAULT '[]', -- JSON array
  country        TEXT,                       -- alpha-2
  categories     TEXT NOT NULL DEFAULT '[]', -- JSON array of category ids
  languages      TEXT NOT NULL DEFAULT '[]', -- JSON array of ISO-639-3 (union of feeds)
  broadcast_area TEXT NOT NULL DEFAULT '[]', -- JSON array (union of feeds)
  is_nsfw        INTEGER NOT NULL DEFAULT 0,
  blocked        INTEGER NOT NULL DEFAULT 0, -- in blocklist
  launched       TEXT,
  closed         TEXT,
  replaced_by    TEXT,
  website        TEXT,
  logo_url       TEXT,
  stream_count   INTEGER NOT NULL DEFAULT 0,
  has_stream     INTEGER NOT NULL DEFAULT 0,
  best_quality   TEXT,                       -- e.g. '1080p'
  quality_rank   INTEGER NOT NULL DEFAULT 0, -- 0 unknown, 1 sd(<720), 2 720p, 3 1080p, 4 2160p+
  online_count   INTEGER NOT NULL DEFAULT 0, -- streams whose last probe was online
  guide_count    INTEGER NOT NULL DEFAULT 0,
  name_sort      TEXT NOT NULL               -- lowercase, diacritics stripped
);
CREATE INDEX IF NOT EXISTS idx_channels_country  ON channels(country);
CREATE INDEX IF NOT EXISTS idx_channels_sort     ON channels(name_sort);
CREATE INDEX IF NOT EXISTS idx_channels_stream   ON channels(has_stream, blocked, is_nsfw);

-- many-to-many helpers for fast filtering (channels.categories/languages JSON kept for display)
CREATE TABLE IF NOT EXISTS channel_categories (channel TEXT NOT NULL, category TEXT NOT NULL, PRIMARY KEY (category, channel));
CREATE TABLE IF NOT EXISTS channel_languages  (channel TEXT NOT NULL, language TEXT NOT NULL, PRIMARY KEY (language, channel));

CREATE TABLE IF NOT EXISTS feeds (
  channel        TEXT NOT NULL,
  id             TEXT NOT NULL,
  name           TEXT NOT NULL,
  is_main        INTEGER NOT NULL DEFAULT 0,
  broadcast_area TEXT NOT NULL DEFAULT '[]',
  timezones      TEXT NOT NULL DEFAULT '[]',
  languages      TEXT NOT NULL DEFAULT '[]',
  format         TEXT,
  PRIMARY KEY (channel, id)
);

CREATE TABLE IF NOT EXISTS streams (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  channel      TEXT NOT NULL,
  feed         TEXT,
  idx          INTEGER NOT NULL,              -- 0-based order within channel after sorting (https first, quality desc)
  url          TEXT NOT NULL,
  title        TEXT,
  quality      TEXT,
  quality_rank INTEGER NOT NULL DEFAULT 0,
  labels       TEXT NOT NULL DEFAULT '[]',
  user_agent   TEXT,
  referrer     TEXT,
  status       TEXT,                          -- NULL | 'online' | 'offline' (from optional health probe)
  last_checked INTEGER                        -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_streams_channel ON streams(channel, idx);

CREATE TABLE IF NOT EXISTS guides (
  channel TEXT NOT NULL,
  feed    TEXT,
  site    TEXT NOT NULL,
  site_id TEXT NOT NULL,
  lang    TEXT
);
CREATE INDEX IF NOT EXISTS idx_guides_channel ON guides(channel);

CREATE VIRTUAL TABLE IF NOT EXISTS channels_fts USING fts5(
  id UNINDEXED,
  name, alt_names, network, owners, country_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- EPG (owned by the XMLTV importer; ingest never touches this table)
CREATE TABLE IF NOT EXISTS programmes (
  channel     TEXT NOT NULL,
  start_ts    INTEGER NOT NULL,
  stop_ts     INTEGER NOT NULL,
  title       TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  icon        TEXT
);
CREATE INDEX IF NOT EXISTS idx_programmes_channel_start ON programmes(channel, start_ts);
CREATE INDEX IF NOT EXISTS idx_programmes_stop ON programmes(stop_ts);
