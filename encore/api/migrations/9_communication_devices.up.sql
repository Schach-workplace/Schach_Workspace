CREATE TABLE communication_devices (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id), session_hash text NOT NULL,
 platform text NOT NULL CHECK(platform IN ('android','ios','web')), name text NOT NULL,
 push_provider text NOT NULL DEFAULT '' CHECK(push_provider IN ('','fcm','apns')), push_token text NOT NULL DEFAULT '',
 active boolean NOT NULL DEFAULT true, created_at text NOT NULL, last_seen_at text NOT NULL
);
CREATE INDEX communication_device_session ON communication_devices(session_hash,active);
CREATE TABLE communication_preferences (
 company_id text NOT NULL REFERENCES companies(id), device_id text NOT NULL REFERENCES communication_devices(id),
 muted boolean NOT NULL DEFAULT false, mentions_only boolean NOT NULL DEFAULT false,
 timezone text NOT NULL, quiet_start text NOT NULL DEFAULT '', quiet_end text NOT NULL DEFAULT '',
 PRIMARY KEY(company_id,device_id)
);
