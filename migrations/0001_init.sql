CREATE TABLE games (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL,
  developer TEXT,
  description TEXT,
  released TEXT,
  tags TEXT NOT NULL DEFAULT '[]',
  coop INTEGER NOT NULL DEFAULT 0,
  deck INTEGER NOT NULL DEFAULT 0,
  positive INTEGER NOT NULL DEFAULT 0,
  negative INTEGER NOT NULL DEFAULT 0,
  median_minutes INTEGER NOT NULL DEFAULT 0,
  is_free INTEGER NOT NULL DEFAULT 0,
  listed INTEGER NOT NULL DEFAULT 1,
  details_synced_at TEXT
);

CREATE TABLE prices (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  regular INTEGER NOT NULL,
  current INTEGER NOT NULL,
  lowest INTEGER NOT NULL,
  tracked_since TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, region)
);

-- One row per price change, not per day, to keep D1 writes low.
CREATE TABLE price_changes (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  price INTEGER NOT NULL,
  PRIMARY KEY (game_id, region, changed_at)
);

CREATE TABLE rates (
  currency TEXT PRIMARY KEY,
  per_usd REAL NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE sync_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX games_rank ON games(rank);
