ALTER TABLE communication_inboxes DROP COLUMN recipient_epoch;
ALTER TABLE communication_inboxes DROP COLUMN membership_epoch;
DROP TABLE communication_audiences;
ALTER TABLE communication_events DROP COLUMN audience_captured;
