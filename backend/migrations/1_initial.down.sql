-- DESTRUCTIVE: removes all workspace data. Prefer restoring a tested backup.
DROP TABLE IF EXISTS automation_records;
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS activities;
DROP TABLE IF EXISTS goals;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS time_entries;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS memberships;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS companies;
