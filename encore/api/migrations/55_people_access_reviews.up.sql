CREATE TABLE access_reviews (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), reviewer_id text NOT NULL,
 preview_id text NOT NULL UNIQUE REFERENCES people_previews(id), prior_review_id text NOT NULL DEFAULT '',
 version bigint NOT NULL CHECK(version>0), state text NOT NULL CHECK(state IN ('draft','completed','superseded')),
 fingerprint text NOT NULL, reason text NOT NULL, snapshots jsonb NOT NULL, session_effect jsonb NOT NULL,
 company_permission_epoch bigint NOT NULL CHECK(company_permission_epoch>0), created_at text NOT NULL, completed_at text NOT NULL DEFAULT ''
);
CREATE INDEX access_reviews_company ON access_reviews(company_id,id);
CREATE TABLE access_review_decisions (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), review_id text NOT NULL REFERENCES access_reviews(id), user_id text NOT NULL,
 expected_membership_version bigint NOT NULL CHECK(expected_membership_version>0),
 action text NOT NULL CHECK(action IN ('keep','change','revoke_access','departure_required')), fields jsonb,
 reason text NOT NULL DEFAULT '', access_outcome text NOT NULL, handover_status text NOT NULL,
 UNIQUE(review_id,user_id)
);
CREATE INDEX access_review_decisions_company ON access_review_decisions(company_id,review_id);
