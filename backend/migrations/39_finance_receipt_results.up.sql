CREATE TABLE receipt_extraction_results (
 id text PRIMARY KEY,company_id text NOT NULL,job_id text NOT NULL UNIQUE,requester_id text NOT NULL,revision bigint NOT NULL CHECK(revision=1),engine text NOT NULL,engine_version text NOT NULL,language text NOT NULL,candidates jsonb NOT NULL CHECK(octet_length(candidates::text)<=65536),acceptance_id text NOT NULL DEFAULT '',created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL
);
