ALTER TABLE communication_call_grants ADD COLUMN joined_at timestamptz;
CREATE INDEX call_answered_scope ON communication_call_grants(call_id,user_id,joined_at) WHERE joined_at IS NOT NULL;
ALTER TABLE communication_calls DROP CONSTRAINT communication_calls_state_check;
ALTER TABLE communication_calls ADD CONSTRAINT communication_calls_state_check CHECK(state IN ('active','ended','missed'));
