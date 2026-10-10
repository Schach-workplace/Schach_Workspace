CREATE TABLE communication_blocks (
 company_id text NOT NULL, user_id text NOT NULL, blocked_user_id text NOT NULL,
 PRIMARY KEY(company_id,user_id,blocked_user_id), CHECK(user_id<>blocked_user_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id), FOREIGN KEY(company_id,blocked_user_id) REFERENCES memberships(company_id,user_id)
);
CREATE TABLE communication_pins (
 company_id text NOT NULL, conversation_id text NOT NULL, message_id text NOT NULL, created_by text NOT NULL, created_at text NOT NULL,
 PRIMARY KEY(company_id,message_id), FOREIGN KEY(company_id,conversation_id,message_id) REFERENCES messages(company_id,conversation_id,id), FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id)
);
ALTER TABLE messages ADD COLUMN mention_ids jsonb NOT NULL DEFAULT '[]', ADD COLUMN mention_all boolean NOT NULL DEFAULT false;
