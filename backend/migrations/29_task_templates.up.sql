ALTER TABLE projects ADD COLUMN version bigint NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN task_owner_policy text NOT NULL DEFAULT 'actor';
ALTER TABLE projects ADD COLUMN default_task_owner_id text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN default_reviewer_id text NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN default_requires_approval boolean NOT NULL DEFAULT false;
CREATE TABLE task_templates (id text PRIMARY KEY,company_id text NOT NULL,version bigint NOT NULL,kind text NOT NULL,name text NOT NULL,description text NOT NULL DEFAULT '',scope_owner_id text NOT NULL,scope_department_id text NOT NULL DEFAULT '',archived boolean NOT NULL DEFAULT false,defaults jsonb NOT NULL,created_at text NOT NULL);
CREATE INDEX task_template_scope ON task_templates(company_id,scope_owner_id,scope_department_id,id);
CREATE TABLE task_template_applications(id text PRIMARY KEY,company_id text NOT NULL,template_id text NOT NULL,template_version bigint NOT NULL,task_id text NOT NULL,actor_id text NOT NULL,retry_key text NOT NULL,created_at text NOT NULL);
