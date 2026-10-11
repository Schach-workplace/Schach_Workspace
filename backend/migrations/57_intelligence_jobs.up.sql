CREATE TABLE intelligence_jobs (
 id text PRIMARY KEY,
 company_id text NOT NULL REFERENCES companies(id), actor_id text NOT NULL REFERENCES users(id),
 operation text NOT NULL CHECK(operation IN ('transcript','summary','action_draft','report_explanation')),
 retry_key text NOT NULL, originating_session_ref text NOT NULL,
 captured_user_epoch bigint NOT NULL CHECK(captured_user_epoch>0), captured_company_authority_epoch bigint NOT NULL CHECK(captured_company_authority_epoch>0),
 client_intent_hash text NOT NULL, effective_request_hash text NOT NULL, source_set_hash text NOT NULL, opt_in_version text NOT NULL,
 provider jsonb NOT NULL, selection jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','retry_wait','ready','failed','cancelled','invalidated','expired')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), next_attempt_at timestamptz NOT NULL,
 lease_token text NOT NULL DEFAULT '', lease_until timestamptz NOT NULL,
 cancellation_version bigint NOT NULL DEFAULT 0, reason_code text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 result_hash text NOT NULL DEFAULT '', result_json text NOT NULL DEFAULT '' CHECK(octet_length(result_json)<=65536),
 UNIQUE(company_id,actor_id,operation,retry_key)
);
CREATE INDEX intelligence_jobs_pending ON intelligence_jobs(state,next_attempt_at,created_at);
CREATE INDEX intelligence_jobs_owner ON intelligence_jobs(company_id,actor_id,id);
CREATE INDEX intelligence_jobs_expiry ON intelligence_jobs(expires_at);
CREATE TABLE intelligence_sources (
 job_id text NOT NULL REFERENCES intelligence_jobs(id) ON DELETE CASCADE, source_key text NOT NULL,
 company_id text NOT NULL REFERENCES companies(id), kind text NOT NULL, source_id text NOT NULL, binding jsonb NOT NULL,
 PRIMARY KEY(job_id,source_key)
);
CREATE INDEX intelligence_source_reverse ON intelligence_sources(company_id,kind,source_id);
CREATE TABLE intelligence_publications (
 id text PRIMARY KEY, job_id text NOT NULL REFERENCES intelligence_jobs(id), company_id text NOT NULL REFERENCES companies(id), actor_id text NOT NULL,
 result_hash text NOT NULL, destination_kind text NOT NULL, canonical_result_id text NOT NULL,
 canonical_operation text NOT NULL, retry_key text NOT NULL, reviewed_payload_hash text NOT NULL, manifest jsonb NOT NULL
);
CREATE INDEX intelligence_publications_job ON intelligence_publications(job_id);
