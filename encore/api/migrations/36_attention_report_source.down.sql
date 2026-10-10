-- Disposable rollback requires removal of report-specific attention rows first.
DELETE FROM attention_items WHERE source_kind='report_export';
ALTER TABLE attention_items DROP CONSTRAINT attention_items_source_kind_check;
ALTER TABLE attention_items ADD CONSTRAINT attention_items_source_kind_check CHECK(source_kind IN ('task','expense','record','intake','bookmark'));
ALTER TABLE attention_items DROP CONSTRAINT attention_items_kind_check;
ALTER TABLE attention_items ADD CONSTRAINT attention_items_kind_check CHECK(kind IN ('task_review','expense_review','decision','intake_triage','deadline','saved_reminder','blocker','update'));
