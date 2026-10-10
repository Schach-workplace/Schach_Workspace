ALTER TABLE communication_records ADD COLUMN retry_key text NOT NULL DEFAULT '';
ALTER TABLE communication_records ADD COLUMN request_hash text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX record_retry ON communication_records(company_id,created_by,retry_key) WHERE retry_key<>'';
CREATE TABLE communication_record_revisions (
 record_id text NOT NULL, revision bigint NOT NULL, company_id text NOT NULL,
 title text NOT NULL, body text NOT NULL, options jsonb NOT NULL, due_at text NOT NULL, reason text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(record_id,revision), FOREIGN KEY(company_id,record_id) REFERENCES communication_records(company_id,id)
);
INSERT INTO communication_record_revisions SELECT id,revision,company_id,title,body,options,due_at,'Migrated current revision',created_at FROM communication_records;
