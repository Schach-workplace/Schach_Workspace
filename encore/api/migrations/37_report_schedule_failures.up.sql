ALTER TABLE report_schedules ADD COLUMN failure_code text NOT NULL DEFAULT '';
ALTER TABLE report_schedules ADD COLUMN failure_count integer NOT NULL DEFAULT 0;
ALTER TABLE report_schedules ADD COLUMN attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE report_schedules ADD COLUMN next_attempt_at timestamptz;
CREATE TABLE report_schedule_failures (
 id text PRIMARY KEY, company_id text NOT NULL, definition_id text NOT NULL, definition_revision bigint NOT NULL,
 schedule_id text NOT NULL, schedule_version bigint NOT NULL, recipient_id text NOT NULL,
 occurrence_utc timestamptz NOT NULL, scheduled_identity text NOT NULL UNIQUE,
 state text NOT NULL CHECK(state IN ('retry','failed')), failure_code text NOT NULL,
 attempt_count integer NOT NULL, updated_at timestamptz NOT NULL
);
CREATE INDEX report_schedule_failures_definition ON report_schedule_failures(company_id,definition_id,schedule_version);
