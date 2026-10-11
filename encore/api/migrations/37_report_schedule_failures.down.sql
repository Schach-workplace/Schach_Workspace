DROP TABLE report_schedule_failures;
ALTER TABLE report_schedules DROP COLUMN next_attempt_at;
ALTER TABLE report_schedules DROP COLUMN attempt_count;
ALTER TABLE report_schedules DROP COLUMN failure_count;
ALTER TABLE report_schedules DROP COLUMN failure_code;
