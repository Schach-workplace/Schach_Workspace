CREATE TABLE finance_assistance_intakes (
 id text PRIMARY KEY, company_id text NOT NULL, owner_id text NOT NULL, purpose text NOT NULL CHECK(purpose IN ('receipt','statement')),
 session_ref text NOT NULL, store_key text NOT NULL UNIQUE CHECK(store_key ~ '^med_[0-9a-f]{32}$'), file_name text NOT NULL,
 size bigint NOT NULL CHECK(size BETWEEN 1 AND 10485760 AND (purpose<>'statement' OR size<=8388608)), mime_type text NOT NULL DEFAULT '', internal_sha256 text NOT NULL CHECK(internal_sha256 ~ '^[0-9a-f]{64}$'),
 state text NOT NULL CHECK(state IN ('reserved','uploaded','scanning','clean','rejected','cancelled','expired','purged')),
 content_generation bigint NOT NULL CHECK(content_generation>=1),clean_generation bigint NOT NULL DEFAULT 0,version bigint NOT NULL CHECK(version>=1),destination_department_id text NOT NULL DEFAULT '',created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 CHECK(purpose<>'statement' OR destination_department_id=''),CHECK(state<>'clean' OR clean_generation=content_generation)
);
CREATE INDEX finance_intake_owner ON finance_assistance_intakes(company_id,owner_id,expires_at);
CREATE TABLE receipt_evidence_fingerprints (
 id text PRIMARY KEY,company_id text NOT NULL,receipt_id text NOT NULL,expense_id text NOT NULL,requester_id text NOT NULL,session_ref text NOT NULL,sha256 text NOT NULL,scanner_version text NOT NULL,
 size bigint NOT NULL,mime_type text NOT NULL,state text NOT NULL CHECK(state IN ('clean','rejected')),generation bigint NOT NULL,assessed_at timestamptz NOT NULL,
 UNIQUE(receipt_id,sha256,scanner_version)
);
CREATE TABLE finance_assistance_jobs (
 id text PRIMARY KEY,company_id text NOT NULL,requester_id text NOT NULL,session_ref text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('scan_intake','scan_receipt','extract_receipt')),source_kind text NOT NULL CHECK(source_kind IN ('intake','expense_receipt')),source_id text NOT NULL,source_parent_id text NOT NULL DEFAULT '',source_version bigint NOT NULL,
 internal_hash text NOT NULL,content_generation bigint NOT NULL,clean_generation bigint NOT NULL DEFAULT 0,destination_department_id text NOT NULL DEFAULT '',target_expense_id text NOT NULL DEFAULT '',target_version bigint NOT NULL DEFAULT 0,company_currency text NOT NULL DEFAULT '',provider_fingerprint text NOT NULL DEFAULT '',
 status text NOT NULL CHECK(status IN ('queued','running','ready','failed','cancelled','stale','accepted')),version bigint NOT NULL,attempts integer NOT NULL CHECK(attempts BETWEEN 0 AND 3),available_at timestamptz NOT NULL,lease_token text NOT NULL DEFAULT '',lease_until timestamptz,created_at timestamptz NOT NULL,updated_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,error_code text NOT NULL DEFAULT '',result_id text NOT NULL DEFAULT ''
);
CREATE INDEX finance_job_claim ON finance_assistance_jobs(status,available_at,lease_until);
