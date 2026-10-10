CREATE TABLE communication_actions (
 company_id text NOT NULL, anchor_message_id text NOT NULL, action_id text NOT NULL,
 conversation_id text NOT NULL, task_id text NOT NULL, created_by text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(company_id,anchor_message_id,action_id),
 FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_retries (
 company_id text NOT NULL, actor_id text NOT NULL, operation text NOT NULL, retry_key text NOT NULL,
 request_hash text NOT NULL, task_id text NOT NULL,
 PRIMARY KEY(company_id,actor_id,operation,retry_key),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_work_sources (
 company_id text NOT NULL, conversation_id text NOT NULL, task_id text NOT NULL, message_id text NOT NULL,
 revision bigint NOT NULL, PRIMARY KEY(task_id,message_id),
 FOREIGN KEY(company_id,task_id) REFERENCES tasks(company_id,id),
 FOREIGN KEY(company_id,conversation_id,message_id) REFERENCES messages(company_id,conversation_id,id),
 FOREIGN KEY(message_id,revision) REFERENCES message_revisions(message_id,revision)
);
