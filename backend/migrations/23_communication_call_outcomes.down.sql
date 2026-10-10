UPDATE communication_calls SET state='ended' WHERE state='missed';
ALTER TABLE communication_calls DROP CONSTRAINT communication_calls_state_check;
ALTER TABLE communication_calls ADD CONSTRAINT communication_calls_state_check CHECK(state IN ('active','ended'));
DROP INDEX call_answered_scope;
ALTER TABLE communication_call_grants DROP COLUMN joined_at;
