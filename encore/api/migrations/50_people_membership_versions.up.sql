ALTER TABLE companies ADD COLUMN permission_epoch bigint NOT NULL DEFAULT 1 CHECK (permission_epoch > 0);
ALTER TABLE memberships ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE memberships ADD COLUMN access_epoch bigint NOT NULL DEFAULT 1 CHECK (access_epoch > 0);
ALTER TABLE departments ADD COLUMN version bigint NOT NULL DEFAULT 1 CHECK (version > 0);
ALTER TABLE users ADD COLUMN session_epoch bigint NOT NULL DEFAULT 1 CHECK (session_epoch > 0);
ALTER TABLE sessions ADD COLUMN session_epoch bigint NOT NULL DEFAULT 1 CHECK (session_epoch > 0);
