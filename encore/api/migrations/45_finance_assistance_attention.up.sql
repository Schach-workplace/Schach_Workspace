ALTER TABLE attention_items DROP CONSTRAINT attention_items_source_kind_check;
ALTER TABLE attention_items ADD CONSTRAINT attention_items_source_kind_check CHECK(source_kind IN ('task','expense','record','intake','bookmark','report_export','finance_extraction','finance_duplicate','finance_reconciliation'));
ALTER TABLE attention_items DROP CONSTRAINT attention_items_kind_check;
ALTER TABLE attention_items ADD CONSTRAINT attention_items_kind_check CHECK(kind IN ('task_review','expense_review','decision','intake_triage','deadline','saved_reminder','blocker','update','report_ready','receipt_review','duplicate_review','reconciliation_review'));
ALTER TABLE attention_items ADD CONSTRAINT attention_finance_source_pair CHECK(
 (source_kind='finance_extraction' AND kind='receipt_review') OR (source_kind='finance_duplicate' AND kind='duplicate_review') OR (source_kind='finance_reconciliation' AND kind='reconciliation_review') OR
 (source_kind NOT IN ('finance_extraction','finance_duplicate','finance_reconciliation') AND kind NOT IN ('receipt_review','duplicate_review','reconciliation_review'))
);
