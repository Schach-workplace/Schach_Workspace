CREATE TABLE finance_reconciliation_attention_works (
 company_id text PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK(revision>=1),
 processed_revision bigint NOT NULL DEFAULT 0 CHECK(processed_revision>=0 AND processed_revision<=revision),
 cursor text NOT NULL DEFAULT '',
 updated_at timestamptz NOT NULL
);
CREATE INDEX finance_reconciliation_attention_pending ON finance_reconciliation_attention_works(updated_at,company_id) WHERE revision>processed_revision;
INSERT INTO finance_reconciliation_attention_works(company_id,revision,processed_revision,cursor,updated_at)
 SELECT DISTINCT company_id,1,0,'',now() FROM finance_statement_rows;
