CREATE TABLE communication_media (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, user_id text NOT NULL,
 message_id text NOT NULL DEFAULT '', history_sequence bigint NOT NULL CHECK(history_sequence > 0),
 file_name text NOT NULL, size bigint NOT NULL CHECK(size BETWEEN 1 AND 26214400), sha256 text NOT NULL,
 mime_type text NOT NULL DEFAULT '', state text NOT NULL CHECK(state IN ('reserved','uploaded','clean','rejected','purged')),
 created_at text NOT NULL, expires_at text NOT NULL,
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX communication_media_quota ON communication_media(company_id,user_id,state);
ALTER TABLE messages ADD COLUMN media_ids jsonb NOT NULL DEFAULT '[]';
