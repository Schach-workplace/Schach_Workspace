DELETE FROM attention_deliveries WHERE item_id IN (SELECT id FROM attention_items WHERE source_kind='goal');
DELETE FROM attention_reminders WHERE item_id IN (SELECT id FROM attention_items WHERE source_kind='goal');
DELETE FROM attention_items WHERE source_kind='goal';
ALTER TABLE attention_items DROP CONSTRAINT attention_goal_source_pair;
ALTER TABLE attention_items DROP CONSTRAINT attention_items_source_kind_check;
ALTER TABLE attention_items ADD CONSTRAINT attention_items_source_kind_check CHECK(source_kind IN ('task','expense','record','intake','bookmark','report_export','finance_extraction','finance_duplicate','finance_reconciliation'));
ALTER TABLE attention_items DROP COLUMN goal_preference_version,DROP COLUMN goal_period_start,DROP COLUMN goal_period_end,DROP COLUMN goal_timezone;
DROP TABLE goal_reminder_preferences;
