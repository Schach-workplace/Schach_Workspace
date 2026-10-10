-- Schach Workspace PostgreSQL schema, version 1.
-- Apply with psql -v ON_ERROR_STOP=1 --single-transaction -f 1_initial.up.sql.
CREATE TABLE companies (
 id varchar(80) PRIMARY KEY, name text NOT NULL, slug text NOT NULL UNIQUE,
 industry text NOT NULL DEFAULT '', timezone text NOT NULL DEFAULT 'UTC', color text NOT NULL DEFAULT '#F97316',
 created_at text NOT NULL, next_task_number bigint NOT NULL DEFAULT 0
);
CREATE TABLE users (
 id varchar(80) PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE,
 is_platform_admin boolean NOT NULL DEFAULT false, password_hash text NOT NULL
);
CREATE TABLE memberships (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id),
 user_id varchar(80) NOT NULL REFERENCES users(id), role text NOT NULL CHECK (role IN ('founder','ceo','admin','head','manager','member','viewer')),
 department_id text NOT NULL DEFAULT '', manager_id text NOT NULL DEFAULT '', title text NOT NULL DEFAULT '',
 capacity_hours double precision NOT NULL DEFAULT 40 CHECK (capacity_hours >= 0 AND capacity_hours <= 168),
 avatar text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true,
 CONSTRAINT membership_company_user UNIQUE (company_id,user_id)
);
CREATE INDEX idx_memberships_user_id ON memberships(user_id);
CREATE TABLE departments (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), name text NOT NULL,
 head_id text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '#F97316', description text NOT NULL DEFAULT '', UNIQUE (company_id,id)
);
CREATE INDEX idx_departments_company_id ON departments(company_id);
CREATE TABLE projects (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', department_id text NOT NULL DEFAULT '', owner_id varchar(80) NOT NULL,
 due_date text NOT NULL DEFAULT '', color text NOT NULL DEFAULT '#F97316', status text NOT NULL CHECK (status IN ('active','on_hold','completed','archived')),
 UNIQUE (company_id,id), FOREIGN KEY (company_id,owner_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX idx_projects_company_id ON projects(company_id);
CREATE TABLE tasks (
 id varchar(80) PRIMARY KEY, code text NOT NULL, company_id varchar(80) NOT NULL REFERENCES companies(id),
 project_id text NOT NULL DEFAULT '', department_id text NOT NULL DEFAULT '', parent_id text NOT NULL DEFAULT '',
 title text NOT NULL, description text NOT NULL DEFAULT '', owner_id varchar(80) NOT NULL, created_by varchar(80) NOT NULL,
 reviewer_id text NOT NULL DEFAULT '', status text NOT NULL CHECK (status IN ('backlog','todo','in_progress','blocked','in_review','done','cancelled')),
 priority text NOT NULL CHECK (priority IN ('critical','high','medium','low')), start_date text NOT NULL DEFAULT '', due_date text NOT NULL DEFAULT '',
 original_due_date text NOT NULL DEFAULT '', progress double precision NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
 estimated_hours double precision NOT NULL DEFAULT 0 CHECK (estimated_hours >= 0), actual_hours double precision NOT NULL DEFAULT 0 CHECK (actual_hours >= 0),
 tags jsonb NOT NULL DEFAULT '[]', checklist jsonb NOT NULL DEFAULT '[]', dependencies jsonb NOT NULL DEFAULT '[]', collaborators jsonb NOT NULL DEFAULT '[]',
 recurrence text NOT NULL CHECK (recurrence IN ('none','daily','weekly','monthly')), requires_approval boolean NOT NULL DEFAULT false,
 blocker_reason text NOT NULL DEFAULT '', deadline_change_reason text NOT NULL DEFAULT '', completed_at text NOT NULL DEFAULT '',
 created_at text NOT NULL, updated_at text NOT NULL, version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 CONSTRAINT task_company_code UNIQUE (company_id,code), UNIQUE (company_id,id), FOREIGN KEY (company_id,owner_id) REFERENCES memberships(company_id,user_id),
 CHECK (reviewer_id = '' OR reviewer_id <> owner_id), CHECK (NOT requires_approval OR reviewer_id <> '')
);
CREATE INDEX idx_tasks_company_status ON tasks(company_id,status);
CREATE INDEX idx_tasks_company_owner ON tasks(company_id,owner_id);
CREATE INDEX idx_tasks_company_department ON tasks(company_id,department_id);
CREATE INDEX idx_tasks_company_due ON tasks(company_id,due_date);
CREATE TABLE comments (
 id varchar(80) PRIMARY KEY, task_id varchar(80) NOT NULL, company_id varchar(80) NOT NULL,
 user_id varchar(80) NOT NULL REFERENCES users(id), body text NOT NULL, created_at text NOT NULL,
 FOREIGN KEY (company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE INDEX idx_comments_task_id ON comments(task_id);
CREATE TABLE time_entries (
 id varchar(80) PRIMARY KEY, task_id varchar(80) NOT NULL, company_id varchar(80) NOT NULL,
 user_id varchar(80) NOT NULL REFERENCES users(id), hours double precision NOT NULL CHECK (hours > 0 AND hours <= 24),
 date text NOT NULL, note text NOT NULL DEFAULT '', created_at text NOT NULL, FOREIGN KEY (company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE INDEX idx_time_entries_task_id ON time_entries(task_id);
CREATE TABLE attachments (
 id varchar(80) PRIMARY KEY, task_id varchar(80) NOT NULL, company_id varchar(80) NOT NULL,
 file_name text NOT NULL, mime_type text NOT NULL, size bigint NOT NULL CHECK (size > 0 AND size <= 10485760),
 uploaded_by varchar(80) NOT NULL REFERENCES users(id), created_at text NOT NULL, data bytea NOT NULL,
 FOREIGN KEY (company_id,task_id) REFERENCES tasks(company_id,id)
);
CREATE INDEX idx_attachments_task_id ON attachments(task_id);
CREATE TABLE goals (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', owner_id varchar(80) NOT NULL, department_id text NOT NULL DEFAULT '', unit text NOT NULL,
 baseline double precision NOT NULL, target double precision NOT NULL, current double precision NOT NULL,
 due_date text NOT NULL DEFAULT '', task_ids jsonb NOT NULL DEFAULT '[]', CHECK (target <> baseline),
 FOREIGN KEY (company_id,owner_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX idx_goals_company_id ON goals(company_id);
CREATE TABLE activities (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), task_id text NOT NULL DEFAULT '',
 user_id text NOT NULL DEFAULT '', action text NOT NULL, detail text NOT NULL DEFAULT '', created_at text NOT NULL
);
CREATE INDEX idx_activities_company_created ON activities(company_id,created_at DESC);
CREATE INDEX idx_activities_task_id ON activities(task_id);
CREATE TABLE notifications (
 id varchar(80) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), user_id varchar(80) NOT NULL REFERENCES users(id),
 task_id text NOT NULL DEFAULT '', title text NOT NULL, body text NOT NULL DEFAULT '', kind text NOT NULL,
 read boolean NOT NULL DEFAULT false, created_at text NOT NULL
);
CREATE INDEX idx_notifications_company_user ON notifications(company_id,user_id,created_at DESC);
CREATE TABLE sessions (
 token_hash varchar(64) PRIMARY KEY, user_id varchar(80) NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL
);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE TABLE automation_records (
 key varchar(240) PRIMARY KEY, company_id varchar(80) NOT NULL REFERENCES companies(id), created_at text NOT NULL
);
CREATE INDEX idx_automation_records_company_id ON automation_records(company_id);
