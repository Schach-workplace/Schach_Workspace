-- SQL38 remains immutable. Identify only its bound-content CHECKs by column
-- dependencies; preserve the statement destination and clean-generation checks.
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='finance_assistance_intakes'::regclass AND contype='c'
 AND conkey && ARRAY(SELECT attnum FROM pg_attribute WHERE attrelid='finance_assistance_intakes'::regclass AND attname IN ('size','internal_sha256','state','content_generation'))
 AND NOT conkey && ARRAY(SELECT attnum FROM pg_attribute WHERE attrelid='finance_assistance_intakes'::regclass AND attname='clean_generation')
 LOOP EXECUTE format('ALTER TABLE finance_assistance_intakes DROP CONSTRAINT %I',c.conname); END LOOP;
END $$;
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_capture_state CHECK(state IN ('capture_reserved','reserved','uploaded','scanning','clean','rejected','cancelled','expired','purged'));
ALTER TABLE finance_assistance_intakes ADD CONSTRAINT finance_intake_content_identity CHECK(
 (size=0 AND file_name='' AND internal_sha256='' AND mime_type='' AND purpose='receipt' AND clean_generation=0 AND content_generation>=0 AND state IN ('capture_reserved','cancelled','expired','purged') AND (state<>'capture_reserved' OR content_generation=0))
 OR (size BETWEEN 1 AND 10485760 AND (purpose<>'statement' OR size<=8388608) AND internal_sha256 ~ '^[0-9a-f]{64}$' AND file_name<>'' AND content_generation>=1 AND state<>'capture_reserved')
);
