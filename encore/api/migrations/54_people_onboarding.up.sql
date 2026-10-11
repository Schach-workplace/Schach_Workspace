CREATE TABLE onboarding_presets (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), version bigint NOT NULL CHECK(version>0),
 name text NOT NULL, description text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false,
 membership jsonb NOT NULL, template_ids jsonb NOT NULL DEFAULT '[]',
 created_by text NOT NULL, updated_by text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL
);
CREATE INDEX onboarding_presets_company ON onboarding_presets(company_id,id);
CREATE TABLE people_previews (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), actor_id text NOT NULL,
 operation text NOT NULL CHECK(operation IN ('onboard','review','departure')), version bigint NOT NULL CHECK(version>0),
 target_user_id text NOT NULL DEFAULT '', target_membership_id text NOT NULL DEFAULT '',
 graph_fingerprint text NOT NULL, intent_hash text NOT NULL, company_epoch bigint NOT NULL CHECK(company_epoch>0), timezone text NOT NULL,
 intent jsonb NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, applied_result_id text NOT NULL DEFAULT ''
);
CREATE INDEX people_previews_actor ON people_previews(company_id,actor_id,id);
CREATE TABLE onboarding_applications (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), actor_id text NOT NULL,
 preview_id text NOT NULL UNIQUE REFERENCES people_previews(id), preset_id text NOT NULL DEFAULT '', preset_version bigint NOT NULL DEFAULT 0,
 user_id text NOT NULL, membership_id text NOT NULL, task_ids jsonb NOT NULL, task_versions jsonb NOT NULL,
 session_effect jsonb NOT NULL, company_permission_epoch bigint NOT NULL CHECK(company_permission_epoch>0), created_at text NOT NULL
);
CREATE INDEX onboarding_applications_company ON onboarding_applications(company_id,id);
