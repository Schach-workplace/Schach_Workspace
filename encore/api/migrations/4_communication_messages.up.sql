CREATE TABLE messages (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL,
 sender_id text NOT NULL, client_message_id text NOT NULL CHECK(length(client_message_id) BETWEEN 1 AND 100),
 request_hash text NOT NULL, body text NOT NULL CHECK(length(body) <= 10000), reply_to_id text NOT NULL DEFAULT '',
 sequence bigint NOT NULL CHECK(sequence > 0), revision bigint NOT NULL CHECK(revision > 0),
 removed boolean NOT NULL DEFAULT false, created_at text NOT NULL, updated_at text NOT NULL,
 UNIQUE(company_id,conversation_id,id), UNIQUE(company_id,conversation_id,sequence),
 UNIQUE(company_id,conversation_id,sender_id,client_message_id),
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id),
 FOREIGN KEY(company_id,sender_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE message_revisions (
 company_id text NOT NULL, conversation_id text NOT NULL, message_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision > 0), body text NOT NULL, removed boolean NOT NULL DEFAULT false,
 created_at text NOT NULL, PRIMARY KEY(message_id,revision),
 FOREIGN KEY(company_id,conversation_id,message_id) REFERENCES messages(company_id,conversation_id,id)
);
CREATE TABLE communication_events (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL,
 sequence bigint NOT NULL CHECK(sequence > 0), kind text NOT NULL, message_id text NOT NULL DEFAULT '',
 message_sequence bigint NOT NULL DEFAULT 0, created_at text NOT NULL,
 UNIQUE(conversation_id,sequence), UNIQUE(company_id,conversation_id,id),
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id)
);
CREATE TABLE communication_outboxes (
 event_id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL,
 lease_token text NOT NULL DEFAULT '', lease_until timestamptz, attempts integer NOT NULL DEFAULT 0,
 delivered boolean NOT NULL DEFAULT false,
 FOREIGN KEY(company_id,conversation_id,event_id) REFERENCES communication_events(company_id,conversation_id,id)
);
CREATE INDEX communication_pending_outbox ON communication_outboxes(delivered,lease_until);
CREATE TABLE communication_inboxes (
 event_id text NOT NULL, user_id text NOT NULL, company_id text NOT NULL, conversation_id text NOT NULL,
 read boolean NOT NULL DEFAULT false, PRIMARY KEY(event_id,user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,conversation_id,event_id) REFERENCES communication_events(company_id,conversation_id,id)
);
