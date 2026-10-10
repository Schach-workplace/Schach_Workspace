CREATE TABLE communication_records (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, anchor_message_id text NOT NULL,
 source_revision bigint NOT NULL, kind text NOT NULL CHECK(kind IN ('ack','poll','event','decision')),
 title text NOT NULL, body text NOT NULL, options jsonb NOT NULL DEFAULT '[]',
 created_by text NOT NULL, reviewer_id text NOT NULL DEFAULT '', revision bigint NOT NULL DEFAULT 1,
 state text NOT NULL CHECK(state IN ('open','confirmed','rejected','closed')), due_at text NOT NULL DEFAULT '', created_at text NOT NULL,
 UNIQUE(company_id,id), FOREIGN KEY(company_id,conversation_id,anchor_message_id) REFERENCES messages(company_id,conversation_id,id),
 FOREIGN KEY(anchor_message_id,source_revision) REFERENCES message_revisions(message_id,revision),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id),
 CHECK(kind<>'decision' OR (reviewer_id<>'' AND reviewer_id<>created_by))
);
CREATE TABLE communication_recipients (
 record_id text NOT NULL, revision bigint NOT NULL, user_id text NOT NULL, company_id text NOT NULL,
 conversation_id text NOT NULL, response text NOT NULL DEFAULT '', responded_at text NOT NULL DEFAULT '',
 PRIMARY KEY(record_id,revision,user_id), FOREIGN KEY(company_id,record_id) REFERENCES communication_records(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
