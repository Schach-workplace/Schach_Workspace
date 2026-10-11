DROP TABLE goal_audits;
DROP TABLE goal_revisions;
DROP TABLE goal_measurements;
ALTER TABLE goals DROP COLUMN version,DROP COLUMN current_measurement_id,DROP COLUMN measurement_coverage_from,DROP COLUMN legacy_observed_current,DROP COLUMN legacy_observed_unit;
