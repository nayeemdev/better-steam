-- Games whose details failed once were hidden and queued behind every new game, and games first
-- added from the top sellers list could stay marked as paid when they are free. Queue the failed
-- ones again so the next runs fetch their details and correct is_free.
UPDATE games SET details_synced_at = NULL WHERE listed = 0 AND details_synced_at < '2026-11-20';
