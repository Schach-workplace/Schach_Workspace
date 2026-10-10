-- New company-owned communication domain. Existing migrations remain immutable.
CREATE TABLE conversations (
 id text PRIMARY KEY, company_id text NOT NULL REFERENCES companies(id),
 title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
 kind text NOT NULL CHECK (kind IN ('dm','group','channel')),
 public boolean NOT NULL DEFAULT false,
 pair_key text NOT NULL DEFAULT '',
 forwarding text NOT NULL DEFAULT 'deny' CHECK (forwarding IN ('deny','selected')),
 version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
 next_sequence bigint NOT NULL DEFAULT 0 CHECK (next_sequence >= 0),
 next_event bigint NOT NULL DEFAULT 0 CHECK (next_event >= 0),
 archived boolean NOT NULL DEFAULT false,
 created_by text NOT NULL, created_at text NOT NULL,
 UNIQUE(company_id,id),
 FOREIGN KEY(company_id,created_by) REFERENCES memberships(company_id,user_id),
 CHECK ((kind = 'dm' AND pair_key <> '' AND NOT public) OR (kind <> 'dm' AND pair_key = '')),
 CHECK (NOT public OR kind = 'channel')
);
CREATE UNIQUE INDEX conversation_dm_pair ON conversations(company_id,pair_key) WHERE pair_key <> '';
CREATE INDEX conversation_company_order ON conversations(company_id,created_at,id);
CREATE TABLE conversation_members (
 company_id text NOT NULL, conversation_id text NOT NULL, user_id text NOT NULL,
 role text NOT NULL CHECK(role IN ('owner','moderator','member','viewer')),
 active boolean NOT NULL, history_from_sequence bigint NOT NULL CHECK(history_from_sequence > 0),
 read_sequence bigint NOT NULL DEFAULT 0 CHECK(read_sequence >= 0),
 epoch bigint NOT NULL DEFAULT 1 CHECK(epoch > 0),
 PRIMARY KEY(company_id,conversation_id,user_id),
 FOREIGN KEY(company_id,conversation_id) REFERENCES conversations(company_id,id),
 FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX conversation_member_lookup ON conversation_members(company_id,user_id,active,conversation_id);
CREATE TABLE conversation_intervals (
 id text PRIMARY KEY, company_id text NOT NULL, conversation_id text NOT NULL, user_id text NOT NULL,
 from_sequence bigint NOT NULL CHECK(from_sequence > 0), through_sequence bigint,
 joined_at text NOT NULL, left_at text NOT NULL DEFAULT '',
 FOREIGN KEY(company_id,conversation_id,user_id) REFERENCES conversation_members(company_id,conversation_id,user_id),
 CHECK(through_sequence IS NULL OR through_sequence >= from_sequence - 1)
);
