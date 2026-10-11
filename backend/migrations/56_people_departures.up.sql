CREATE TABLE company_departures (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), target_user_id text NOT NULL, membership_id text NOT NULL, actor_id text NOT NULL,
 preview_id text NOT NULL UNIQUE REFERENCES people_previews(id), reason text NOT NULL,
 original_membership_version bigint NOT NULL CHECK(original_membership_version>0), original_access_epoch bigint NOT NULL CHECK(original_access_epoch>0),
 graph_fingerprint text NOT NULL, source_manifest_hash text NOT NULL, company_permission_epoch bigint NOT NULL CHECK(company_permission_epoch>0), session_effect jsonb NOT NULL, created_at text NOT NULL,
 UNIQUE(membership_id,original_access_epoch)
);
CREATE INDEX company_departures_company ON company_departures(company_id,id);
CREATE TABLE departure_transfers (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), departure_id text NOT NULL REFERENCES company_departures(id),
 kind text NOT NULL CHECK(kind IN ('task_owner','task_reviewer','project_owner','milestone_owner','milestone_reviewer','goal_owner','department_head','reporting_manager','expense_review_route')),
 source_id text NOT NULL, before_version bigint NOT NULL CHECK(before_version>0), after_version bigint NOT NULL CHECK(after_version>0), old_user_id text NOT NULL, new_user_id text NOT NULL, reason text NOT NULL,
 UNIQUE(departure_id,kind,source_id)
);
CREATE INDEX departure_transfers_departure ON departure_transfers(company_id,departure_id);
