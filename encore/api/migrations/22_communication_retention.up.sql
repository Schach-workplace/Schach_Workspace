ALTER TABLE communication_call_grants ADD COLUMN checked_at timestamptz NOT NULL DEFAULT '1970-01-01 00:00:00+00';
ALTER TABLE messages ADD COLUMN content_purged boolean NOT NULL DEFAULT false;
CREATE INDEX communication_message_retention ON messages(created_at) WHERE NOT content_purged;
