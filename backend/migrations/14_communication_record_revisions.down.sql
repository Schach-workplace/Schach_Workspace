DROP TABLE communication_record_revisions;
DROP INDEX record_retry;
ALTER TABLE communication_records DROP COLUMN retry_key, DROP COLUMN request_hash;
