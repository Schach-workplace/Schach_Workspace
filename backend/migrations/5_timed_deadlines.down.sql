ALTER TABLE tasks DROP CONSTRAINT task_original_deadline_tuple, DROP CONSTRAINT task_deadline_tuple;
DROP INDEX task_due_instant;
ALTER TABLE tasks DROP COLUMN original_due_timezone, DROP COLUMN original_due_at, DROP COLUMN original_deadline_mode, DROP COLUMN due_timezone, DROP COLUMN due_at, DROP COLUMN deadline_mode;
