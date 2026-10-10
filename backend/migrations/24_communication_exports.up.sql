CREATE TABLE communication_export_audits (
 id varchar(80) PRIMARY KEY,
 company_id varchar(80) NOT NULL,
 conversation_id varchar(80) NOT NULL,
 actor_id varchar(80) NOT NULL,
 purpose text NOT NULL,
 selection_hash text NOT NULL,
 created_at text NOT NULL,
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id),
 FOREIGN KEY(company_id,actor_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX private_export_audit_scope ON communication_export_audits(company_id,conversation_id,created_at);
