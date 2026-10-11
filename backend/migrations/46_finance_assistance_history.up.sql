CREATE TABLE finance_assistance_histories (
 id text PRIMARY KEY,
 company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
 actor_id text NOT NULL REFERENCES users(id),
 operation text NOT NULL CHECK (operation IN ('finance_intake_reserve','finance_intake_bind','finance_intake_finalize','finance_intake_cancel','receipt_assess','receipt_extract','receipt_extract_cancel','receipt_accept','duplicate_review','duplicate_dismiss','statement_preview','statement_import','reconciliation_match','reconciliation_unmatch','reconciliation_dismiss')),
 result_kind text NOT NULL,
 result_ids jsonb NOT NULL DEFAULT '[]',
 created_at timestamptz NOT NULL
);
CREATE INDEX finance_assistance_history_owner ON finance_assistance_histories(company_id,actor_id,created_at,id);
