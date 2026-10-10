ALTER TABLE tasks ADD COLUMN deadline_mode text NOT NULL DEFAULT 'all_day' CHECK(deadline_mode IN ('all_day','timed'));
ALTER TABLE tasks ADD COLUMN due_at timestamptz;
ALTER TABLE tasks ADD COLUMN due_timezone text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN original_deadline_mode text NOT NULL DEFAULT 'all_day' CHECK(original_deadline_mode IN ('all_day','timed'));
ALTER TABLE tasks ADD COLUMN original_due_at timestamptz;
ALTER TABLE tasks ADD COLUMN original_due_timezone text NOT NULL DEFAULT '';
ALTER TABLE tasks ADD CONSTRAINT task_deadline_tuple CHECK (
 (deadline_mode='all_day' AND due_at IS NULL AND due_timezone='') OR
 (deadline_mode='timed' AND due_at IS NOT NULL AND due_timezone<>'' AND due_date<>'' AND recurrence='none'));
ALTER TABLE tasks ADD CONSTRAINT task_original_deadline_tuple CHECK (
 (original_deadline_mode='all_day' AND original_due_at IS NULL AND original_due_timezone='') OR
 (original_deadline_mode='timed' AND original_due_at IS NOT NULL AND original_due_timezone<>''));
CREATE INDEX task_due_instant ON tasks(company_id,due_at) WHERE deadline_mode='timed';
