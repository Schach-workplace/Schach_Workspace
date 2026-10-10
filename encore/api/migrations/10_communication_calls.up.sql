CREATE TABLE communication_calls (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, created_by text NOT NULL,
 retry_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('audio','video')), room text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('active','ended')), version bigint NOT NULL DEFAULT 1,
 created_at text NOT NULL, ended_at text NOT NULL DEFAULT '',
 UNIQUE(company_id,created_by,retry_key), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_call_grants (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, call_id text NOT NULL,
 user_id text NOT NULL, device_id text NOT NULL REFERENCES communication_devices(id), session_hash text NOT NULL,
 identity text NOT NULL, member_epoch bigint NOT NULL, active boolean NOT NULL DEFAULT true, expires_at timestamptz NOT NULL,
 FOREIGN KEY(company_id,call_id) REFERENCES communication_calls(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX communication_call_grant_lookup ON communication_call_grants(call_id,active);
