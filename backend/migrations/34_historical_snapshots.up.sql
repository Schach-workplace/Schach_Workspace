CREATE TABLE historical_report_snapshots (
 id text PRIMARY KEY, company_id text NOT NULL, requester_id text NOT NULL,
 schema_version integer NOT NULL, metric_version integer NOT NULL, basis text NOT NULL,
 request_hash text NOT NULL, request jsonb NOT NULL, period jsonb NOT NULL, generated_at timestamptz NOT NULL,
 definition_id text NOT NULL, definition_revision bigint NOT NULL, content_hash text NOT NULL,
 serialized_bytes integer NOT NULL CHECK(serialized_bytes<=8388608), row_count integer NOT NULL CHECK(row_count<=10000),
 summary jsonb NOT NULL, membership jsonb NOT NULL
);
CREATE INDEX historical_report_requester ON historical_report_snapshots(company_id,requester_id,generated_at);
CREATE TABLE historical_report_rows (
 snapshot_id text NOT NULL REFERENCES historical_report_snapshots(id), row_id text NOT NULL, row_order integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('state','acceptance','time','coverage')), task_id text NOT NULL,
 fact_id text NOT NULL, task_version bigint NOT NULL, acceptance_id text NOT NULL, time_fact_id text NOT NULL,
 state jsonb NOT NULL, accepted_at_raw text NOT NULL, acceptance_kind text NOT NULL, entry_date text NOT NULL,
 hours double precision NOT NULL, provenance text NOT NULL, reason text NOT NULL, label_basis text NOT NULL,
 owner_label text NOT NULL, department_label text NOT NULL, project_label text NOT NULL,
 PRIMARY KEY(snapshot_id,row_id), UNIQUE(snapshot_id,row_order)
);
CREATE TABLE report_snapshot_sources (
 company_id text NOT NULL, snapshot_id text NOT NULL REFERENCES historical_report_snapshots(id), task_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('contributing','reference','coverage')), PRIMARY KEY(company_id,snapshot_id,task_id)
);
