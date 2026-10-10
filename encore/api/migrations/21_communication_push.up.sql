CREATE TABLE communication_pushes (
 event_id text NOT NULL REFERENCES communication_events(id), device_id text NOT NULL REFERENCES communication_devices(id), company_id text NOT NULL,
 user_id text NOT NULL, attempts integer NOT NULL DEFAULT 0, done boolean NOT NULL DEFAULT false, lease_until timestamptz,lease_token text NOT NULL DEFAULT '',
 PRIMARY KEY(event_id,device_id), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX communication_push_pending ON communication_pushes(lease_until) WHERE NOT done;
