CREATE TABLE communication_requests (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id), conversation_id text NOT NULL,
 anchor_message_id text NOT NULL, source_revision bigint NOT NULL, created_by text NOT NULL,
 retry_key text NOT NULL, request_hash text NOT NULL, department_id text NOT NULL,
 title text NOT NULL, summary text NOT NULL, state text NOT NULL CHECK(state IN ('open','assigned','resolved','cancelled')),
 version bigint NOT NULL DEFAULT 1, task_id text NOT NULL DEFAULT '', created_at text NOT NULL, updated_at text NOT NULL,
 UNIQUE(company_id,created_by,retry_key),
 FOREIGN KEY(company_id,department_id) REFERENCES departments(company_id,id),
 FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id),
 FOREIGN KEY(anchor_message_id,source_revision) REFERENCES message_revisions(message_id,revision),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
