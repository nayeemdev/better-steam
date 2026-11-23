-- Free games used to be hidden. Recheck every unlisted game and start a fresh catalogue round
-- so free games from SteamSpy's list are added straight away.
UPDATE games SET details_synced_at = NULL WHERE listed = 0;
DELETE FROM sync_state WHERE key = 'catalogue_round_at';
