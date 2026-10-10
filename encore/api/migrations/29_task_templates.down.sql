DROP TABLE task_template_applications;
DROP TABLE task_templates;
ALTER TABLE projects DROP COLUMN default_requires_approval;
ALTER TABLE projects DROP COLUMN default_reviewer_id;
ALTER TABLE projects DROP COLUMN default_task_owner_id;
ALTER TABLE projects DROP COLUMN task_owner_policy;
ALTER TABLE projects DROP COLUMN version;
