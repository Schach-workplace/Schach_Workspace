CREATE TABLE communication_bookmarks (
 company_id text NOT NULL, user_id text NOT NULL, message_id text NOT NULL, conversation_id text NOT NULL,
 remind_at text NOT NULL DEFAULT '', created_at text NOT NULL,
 PRIMARY KEY(company_id,user_id,message_id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,conversation_id,message_id) REFERENCES messages(company_id,conversation_id,id)
);
CREATE TABLE communication_reactions (
 company_id text NOT NULL, conversation_id text NOT NULL, message_id text NOT NULL, user_id text NOT NULL,
 emoji text NOT NULL CHECK(emoji IN ('👍','👎','❤️','🎉','✅','👀','❓')),
 PRIMARY KEY(company_id,message_id,user_id,emoji),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id),
 FOREIGN KEY(company_id,conversation_id,message_id) REFERENCES messages(company_id,conversation_id,id)
);
CREATE INDEX communication_message_search ON messages USING gin(to_tsvector('simple',body)) WHERE NOT removed;
