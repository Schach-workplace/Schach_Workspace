CREATE TABLE finance_extraction_acceptances (
 id text PRIMARY KEY,company_id text NOT NULL,result_id text NOT NULL,actor_id text NOT NULL,reviewed_hash text NOT NULL,expense_id text NOT NULL,receipt_id text NOT NULL DEFAULT '',result_revision bigint NOT NULL,internal_source_hash text NOT NULL,clean_generation bigint NOT NULL,original_source_version bigint NOT NULL,original_target_version bigint NOT NULL,resulting_version bigint NOT NULL,created_at timestamptz NOT NULL,UNIQUE(company_id,result_id)
);
