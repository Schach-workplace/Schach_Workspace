CREATE TABLE finance_statement_previews (
 id text PRIMARY KEY,company_id text NOT NULL,actor_id text NOT NULL,intake_id text NOT NULL,intake_version bigint NOT NULL,internal_hash text NOT NULL,mapping_hash text NOT NULL,mapping jsonb NOT NULL,parser_version integer NOT NULL CHECK(parser_version=1),revision bigint NOT NULL CHECK(revision=1),rows jsonb NOT NULL,totals jsonb NOT NULL,errors jsonb NOT NULL,import_id text NOT NULL DEFAULT '',created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL
);
CREATE TABLE finance_statement_imports (
 id text PRIMARY KEY,company_id text NOT NULL,creator_id text NOT NULL,internal_hash text NOT NULL,mapping_hash text NOT NULL,mapping jsonb NOT NULL,preview_id text NOT NULL UNIQUE,version bigint NOT NULL CHECK(version=1),row_count integer NOT NULL CHECK(row_count BETWEEN 1 AND 10000),totals jsonb NOT NULL,duplicate_reason text NOT NULL DEFAULT '',created_at timestamptz NOT NULL
);
CREATE TABLE finance_statement_rows (
 id text PRIMARY KEY,company_id text NOT NULL,import_id text NOT NULL,record_ordinal integer NOT NULL CHECK(record_ordinal BETWEEN 1 AND 10001),booked_date text NOT NULL,company_currency text NOT NULL CHECK(company_currency IN ('INR','USD','EUR','GBP','AED','SGD','AUD','CAD')),signed_amount_minor bigint NOT NULL CHECK(signed_amount_minor<>0 AND signed_amount_minor BETWEEN -1000000000000 AND 1000000000000),reference text NOT NULL,description text NOT NULL,reviewed_cells jsonb NOT NULL,version bigint NOT NULL CHECK(version=1),UNIQUE(import_id,record_ordinal)
);
CREATE TABLE finance_statement_audits(id text PRIMARY KEY,company_id text NOT NULL,import_id text NOT NULL,actor_id text NOT NULL,action text NOT NULL CHECK(action='statement_imported'),created_at timestamptz NOT NULL);
CREATE INDEX finance_statement_company ON finance_statement_imports(company_id,created_at,id);
CREATE INDEX finance_statement_import_rows ON finance_statement_rows(company_id,import_id,record_ordinal);
