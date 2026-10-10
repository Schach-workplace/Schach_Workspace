CREATE TABLE communication_call_jobs (
 call_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('DeleteRoom','RemoveParticipant')), identity text NOT NULL DEFAULT '',
 company_id text NOT NULL, room text NOT NULL, attempts integer NOT NULL DEFAULT 0, lease_until timestamptz,
 lease_token text NOT NULL DEFAULT '', done boolean NOT NULL DEFAULT false,
 PRIMARY KEY(call_id,operation,identity), FOREIGN KEY(company_id,call_id) REFERENCES communication_calls(company_id,id)
);
