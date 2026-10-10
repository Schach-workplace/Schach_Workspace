CREATE TABLE communication_bundles (
 id text PRIMARY KEY, company_id text NOT NULL, actor_id text NOT NULL, retry_key text NOT NULL, request_hash text NOT NULL,
 conversation_id text NOT NULL, anchor_message_id text NOT NULL, source_revision bigint NOT NULL, created_at text NOT NULL,
 UNIQUE(company_id,actor_id,retry_key), UNIQUE(company_id,id),
 FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id), FOREIGN KEY(anchor_message_id,source_revision) REFERENCES message_revisions(message_id,revision), FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_bundle_actions (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, anchor_message_id text NOT NULL, bundle_id text NOT NULL, title text NOT NULL, position integer NOT NULL,
 UNIQUE(bundle_id,position), FOREIGN KEY(company_id,bundle_id) REFERENCES communication_bundles(company_id,id), FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id)
);
