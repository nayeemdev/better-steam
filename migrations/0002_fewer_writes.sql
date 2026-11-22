-- WITHOUT ROWID tables store rows in their primary key, so each write is one row instead of
-- a row plus a primary key index entry. The first price seen moves onto the prices row so the
-- initial fill does not also write a price_changes row. Both tables only held a few hours of
-- data, so they are rebuilt empty rather than copied, which would cost more writes.
DROP TABLE price_changes;
DROP TABLE prices;
DROP INDEX games_rank;

CREATE TABLE prices (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  currency TEXT NOT NULL,
  regular INTEGER NOT NULL,
  current INTEGER NOT NULL,
  lowest INTEGER NOT NULL,
  first_price INTEGER NOT NULL,
  tracked_since TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (game_id, region)
) WITHOUT ROWID;

CREATE TABLE price_changes (
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  region TEXT NOT NULL,
  changed_at TEXT NOT NULL,
  price INTEGER NOT NULL,
  PRIMARY KEY (game_id, region, changed_at)
) WITHOUT ROWID;

CREATE TABLE sync_state_new (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
INSERT INTO sync_state_new SELECT key, value FROM sync_state WHERE key NOT IN ('prices_cursor', 'prices_region');
DROP TABLE sync_state;
ALTER TABLE sync_state_new RENAME TO sync_state;

CREATE TABLE rates_new (currency TEXT PRIMARY KEY, per_usd REAL NOT NULL, updated_at TEXT NOT NULL) WITHOUT ROWID;
INSERT INTO rates_new SELECT currency, per_usd, updated_at FROM rates;
DROP TABLE rates;
ALTER TABLE rates_new RENAME TO rates;
