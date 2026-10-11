-- Downgrade requires cancelling/purging pending capture reservations first.
DELETE FROM finance_assistance_intakes WHERE size=0;
ALTER TABLE finance_assistance_intakes DROP CONSTRAINT finance_intake_capture_state;
ALTER TABLE finance_assistance_intakes DROP CONSTRAINT finance_intake_content_identity;
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_bound_size CHECK(size BETWEEN 1 AND 10485760 AND (purpose<>'statement' OR size<=8388608));
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_bound_hash CHECK(internal_sha256 ~ '^[0-9a-f]{64}$');
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_bound_state CHECK(state IN ('reserved','uploaded','scanning','clean','rejected','cancelled','expired','purged'));
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_bound_generation CHECK(content_generation>=1);
