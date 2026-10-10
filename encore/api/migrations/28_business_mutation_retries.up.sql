CREATE TABLE business_mutation_retries (
 company_id text NOT NULL, actor_id text NOT NULL, operation text NOT NULL,
 retry_key text NOT NULL, request_hash text NOT NULL, result_kind text NOT NULL,
 result_ids jsonb NOT NULL, result_versions jsonb NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(company_id,actor_id,operation,retry_key)
);
