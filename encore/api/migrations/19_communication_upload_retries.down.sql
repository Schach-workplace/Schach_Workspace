DROP INDEX media_upload_retry;
ALTER TABLE communication_media DROP COLUMN client_upload_id,DROP COLUMN request_hash;
