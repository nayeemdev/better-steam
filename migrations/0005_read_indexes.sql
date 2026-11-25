-- Each cron run used to scan the whole games table three times. These partial indexes let the
-- price, image and details queues read only the rows they return.
CREATE INDEX games_priced ON games(rank, id) WHERE listed = 1 AND is_free = 0;
CREATE INDEX games_missing_images ON games(rank) WHERE listed = 1 AND capsule_path IS NULL;
CREATE INDEX games_missing_details ON games(rank) WHERE details_synced_at IS NULL;
CREATE INDEX games_details_age ON games(details_synced_at) WHERE details_synced_at IS NOT NULL;
DELETE FROM sync_state WHERE key = 'prices_cursor';
