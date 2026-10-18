CREATE TABLE development_plans (
 id text PRIMARY KEY,
 company_id text NOT NULL REFERENCES companies(id),
 owner_id text NOT NULL,
 version bigint NOT NULL CHECK (version > 0),
 pilot text NOT NULL CHECK (pilot IN ('engineering','office','field')),
 title text NOT NULL,
 career_role text NOT NULL,
 career_level text NOT NULL,
 competency_ids jsonb NOT NULL DEFAULT '[]',
 objective text NOT NULL,
 learning_actions jsonb NOT NULL DEFAULT '[]',
 evidence_note text NOT NULL DEFAULT '',
 mentor_id text NOT NULL DEFAULT '',
 state text NOT NULL CHECK (state IN ('active','archived')),
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,owner_id) REFERENCES memberships(company_id,user_id),
 CHECK(mentor_id = '' OR mentor_id <> owner_id)
);
CREATE INDEX development_plans_participants ON development_plans(company_id,owner_id,mentor_id,id);
CREATE TABLE development_reviews (
 id text PRIMARY KEY,
 company_id text NOT NULL,
 plan_id text NOT NULL,
 mentor_id text NOT NULL,
 feedback text NOT NULL,
 next_step text NOT NULL,
 plan_version bigint NOT NULL CHECK(plan_version > 1),
 created_at text NOT NULL,
 UNIQUE(company_id,plan_id,plan_version),
 FOREIGN KEY(company_id,plan_id) REFERENCES development_plans(company_id,id),
 FOREIGN KEY(company_id,mentor_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX development_reviews_plan ON development_reviews(company_id,plan_id,plan_version);
CREATE FUNCTION development_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Development reviews are immutable'; END;
$$;
CREATE TRIGGER development_review_immutable BEFORE UPDATE OR DELETE ON development_reviews FOR EACH ROW EXECUTE FUNCTION development_review_immutable();
-- Optional mentor is stored as an empty string when absent. The trigger supplies
-- the same tenant membership integrity as the owner/reviewer composite FKs.
CREATE FUNCTION development_mentor_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.mentor_id <> '' AND NOT EXISTS (SELECT 1 FROM memberships WHERE company_id=NEW.company_id AND user_id=NEW.mentor_id) THEN
  RAISE EXCEPTION 'Mentor must belong to the plan company';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER development_mentor_membership BEFORE INSERT OR UPDATE ON development_plans FOR EACH ROW EXECUTE FUNCTION development_mentor_membership();
