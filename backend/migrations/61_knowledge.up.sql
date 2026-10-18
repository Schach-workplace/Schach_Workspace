CREATE TABLE knowledge_articles (
 id text PRIMARY KEY,
 company_id text NOT NULL REFERENCES companies(id),
 owner_id text NOT NULL,
 version bigint NOT NULL CHECK(version > 0),
 pilot text NOT NULL CHECK(pilot IN ('engineering','office','field','all')),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 16000),
 reviewer_id text NOT NULL,
 audience text NOT NULL CHECK(audience IN ('company','selected')),
 reader_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(reader_ids)='array' AND jsonb_array_length(reader_ids)<=100),
 state text NOT NULL CHECK(state IN ('draft','published','archived')),
 review_due_date text NOT NULL,
 reviewed_version bigint NOT NULL DEFAULT 0,
 reviewed_by text NOT NULL DEFAULT '',
 reviewed_at text NOT NULL DEFAULT '',
 created_at text NOT NULL,
 updated_at text NOT NULL,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,owner_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,reviewer_id) REFERENCES memberships(company_id,user_id),
 CHECK(owner_id<>reviewer_id),
 CHECK(state<>'published' OR (reviewed_version=version AND reviewed_by=reviewer_id AND reviewed_at<>''))
);
CREATE INDEX knowledge_articles_company ON knowledge_articles(company_id,id);
CREATE TABLE knowledge_reviews (
 id text PRIMARY KEY,
 company_id text NOT NULL,
 article_id text NOT NULL,
 article_version bigint NOT NULL CHECK(article_version>0),
 reviewer_id text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('publish','return')),
 reason text NOT NULL,
 created_at text NOT NULL,
 UNIQUE(company_id,article_id,article_version),
 FOREIGN KEY(company_id,article_id) REFERENCES knowledge_articles(company_id,id),
 FOREIGN KEY(company_id,reviewer_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX knowledge_reviews_article ON knowledge_reviews(company_id,article_id,article_version);
CREATE FUNCTION knowledge_review_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Knowledge reviews are immutable'; END;
$$;
CREATE TRIGGER knowledge_review_immutable BEFORE UPDATE OR DELETE ON knowledge_reviews FOR EACH ROW EXECUTE FUNCTION knowledge_review_immutable();
