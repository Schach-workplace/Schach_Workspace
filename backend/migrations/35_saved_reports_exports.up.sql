CREATE TABLE saved_report_definitions (
 id text PRIMARY KEY, company_id text NOT NULL, owner_id text NOT NULL, version bigint NOT NULL CHECK(version>0),
 state text NOT NULL CHECK(state IN ('active','paused','deleted')), schema_version integer NOT NULL, basis text NOT NULL,
 configuration jsonb NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX saved_report_owner ON saved_report_definitions(company_id,owner_id);
CREATE TABLE saved_report_revisions (
 company_id text NOT NULL, definition_id text NOT NULL REFERENCES saved_report_definitions(id), version bigint NOT NULL,
 state text NOT NULL, configuration jsonb NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY(company_id,definition_id,version)
);
CREATE TABLE report_schedules (
 id text PRIMARY KEY, company_id text NOT NULL, definition_id text NOT NULL UNIQUE REFERENCES saved_report_definitions(id),
 definition_revision bigint NOT NULL, version bigint NOT NULL, weekdays jsonb NOT NULL, local_minute text NOT NULL,
 schedule_zone text NOT NULL, next_occurrence_utc timestamptz NOT NULL, last_occurrence_utc timestamptz,
 skipped_from timestamptz, skipped_to timestamptz, state text NOT NULL CHECK(state IN ('active','paused','deleted'))
);
CREATE INDEX report_schedule_due ON report_schedules(state,next_occurrence_utc);
CREATE TABLE report_export_jobs (
 id text PRIMARY KEY, company_id text NOT NULL, request_actor_id text NOT NULL, recipient_id text NOT NULL,
 definition_id text NOT NULL, definition_revision bigint NOT NULL, schedule_id text NOT NULL, schedule_version bigint NOT NULL,
 occurrence_utc timestamptz, scheduled_identity text UNIQUE, payload_hash text NOT NULL, csv_schema_version integer NOT NULL,
 period jsonb NOT NULL, state text NOT NULL CHECK(state IN ('queued','running','ready','failed','cancelled','expired')),
 lease_token text NOT NULL, lease_until timestamptz, attempt_count integer NOT NULL, next_attempt_at timestamptz NOT NULL,
 failure_code text NOT NULL, snapshot_id text NOT NULL, artifact_id text NOT NULL, created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL
);
CREATE INDEX report_job_claim ON report_export_jobs(state,next_attempt_at,lease_until);
CREATE INDEX report_job_definition ON report_export_jobs(company_id,definition_id,definition_revision);
CREATE TABLE report_artifacts (
 id text PRIMARY KEY, company_id text NOT NULL, job_id text NOT NULL UNIQUE REFERENCES report_export_jobs(id),
 snapshot_id text NOT NULL REFERENCES historical_report_snapshots(id), recipient_id text NOT NULL,
 store_key text NOT NULL, schema_version integer NOT NULL, sha256 text NOT NULL, length bigint NOT NULL CHECK(length<=16777216),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, state text NOT NULL
);
CREATE INDEX report_artifact_expiry ON report_artifacts(state,expires_at);
CREATE TABLE report_delivery_intents (
 id text PRIMARY KEY, company_id text NOT NULL, job_id text NOT NULL REFERENCES report_export_jobs(id), recipient_id text NOT NULL,
 state text NOT NULL, attention_item_id text NOT NULL, created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL,
 UNIQUE(company_id,job_id,recipient_id)
);
