-- Newer Steam apps keep their images under hashed folders, so the default file names 404.
-- NULL means not looked up yet, and an empty string means Steam has no such image.
ALTER TABLE games ADD COLUMN capsule_path TEXT;
ALTER TABLE games ADD COLUMN header_path TEXT;
