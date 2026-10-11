ALTER TABLE sessions DROP COLUMN session_epoch;
ALTER TABLE users DROP COLUMN session_epoch;
ALTER TABLE departments DROP COLUMN version;
ALTER TABLE memberships DROP COLUMN access_epoch;
ALTER TABLE memberships DROP COLUMN version;
ALTER TABLE companies DROP COLUMN permission_epoch;
