DROP INDEX communication_message_retention;
ALTER TABLE messages DROP COLUMN content_purged;
ALTER TABLE communication_call_grants DROP COLUMN checked_at;
