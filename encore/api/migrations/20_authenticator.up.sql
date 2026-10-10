CREATE TABLE user_mfas (
 user_id text PRIMARY KEY REFERENCES users(id), secret_cipher bytea NOT NULL, enabled boolean NOT NULL DEFAULT false,
 last_counter bigint NOT NULL DEFAULT -1, created_at text NOT NULL
);
CREATE TABLE mfa_recoveries (user_id text NOT NULL REFERENCES users(id),code_hash text NOT NULL,used boolean NOT NULL DEFAULT false,PRIMARY KEY(user_id,code_hash));
