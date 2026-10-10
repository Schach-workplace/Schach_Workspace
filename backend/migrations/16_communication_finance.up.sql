CREATE TABLE communication_expense_links (
 company_id text NOT NULL, conversation_id text NOT NULL, anchor_message_id text NOT NULL, expense_id text NOT NULL, created_by text NOT NULL, source_revision bigint NOT NULL,
 PRIMARY KEY(company_id,anchor_message_id), FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id),
 FOREIGN KEY(company_id,expense_id) REFERENCES expenses(company_id,id), FOREIGN KEY(anchor_message_id,source_revision) REFERENCES message_revisions(message_id,revision),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_expense_retries (
 company_id text NOT NULL, actor_id text NOT NULL, retry_key text NOT NULL, request_hash text NOT NULL, expense_id text NOT NULL,
 PRIMARY KEY(company_id,actor_id,retry_key), FOREIGN KEY(company_id,expense_id) REFERENCES expenses(company_id,id), FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
