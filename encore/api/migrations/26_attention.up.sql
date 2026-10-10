CREATE TABLE attention_items (
 id text PRIMARY KEY, company_id text NOT NULL, recipient_id text NOT NULL,
 source_kind text NOT NULL CHECK(source_kind IN ('task','expense','record','intake','bookmark')),
 source_id text NOT NULL, source_revision bigint NOT NULL DEFAULT 0, record_revision bigint NOT NULL DEFAULT 0,
 occurrence_key text NOT NULL, kind text NOT NULL CHECK(kind IN ('task_review','expense_review','decision','intake_triage','deadline','saved_reminder','blocker','update')),
 conversation_id text NOT NULL DEFAULT '', anchor_message_id text NOT NULL DEFAULT '', message_sequence bigint NOT NULL DEFAULT 0, recipient_epoch bigint NOT NULL DEFAULT 0,
 state text NOT NULL CHECK(state IN ('open','resolved','routed','superseded')), version bigint NOT NULL DEFAULT 1,
 snoozed_until timestamptz, due_at timestamptz, routed_to_id text NOT NULL DEFAULT '', resolved_by text NOT NULL DEFAULT '', resolved_at timestamptz,
 resolution_reason text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT attention_obligation UNIQUE(company_id,recipient_id,source_kind,source_id,occurrence_key,kind)
);
CREATE INDEX attention_recipient_page ON attention_items(company_id,recipient_id,created_at DESC,id DESC);
CREATE TABLE attention_retries (company_id text NOT NULL,actor_id text NOT NULL,operation text NOT NULL,retry_key text NOT NULL,request_hash text NOT NULL,item_id text NOT NULL,result_item_id text NOT NULL,result_version bigint NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(company_id,actor_id,operation,retry_key));
CREATE TABLE attention_preferences (company_id text NOT NULL,user_id text NOT NULL,version bigint NOT NULL,working_hours_enabled boolean NOT NULL DEFAULT false,working_days jsonb NOT NULL DEFAULT '[]',working_start text NOT NULL DEFAULT '',working_end text NOT NULL DEFAULT '',quiet_start text NOT NULL DEFAULT '',quiet_end text NOT NULL DEFAULT '',escalation_enabled boolean NOT NULL DEFAULT false,escalation_after_minutes integer NOT NULL DEFAULT 0,escalation_user_id text NOT NULL DEFAULT '',PRIMARY KEY(company_id,user_id));
CREATE TABLE attention_reminders(id text PRIMARY KEY,company_id text NOT NULL,item_id text NOT NULL,recipient_id text NOT NULL,stage text NOT NULL,window_key text NOT NULL,available_at timestamptz NOT NULL,lease_token text NOT NULL DEFAULT '',lease_until timestamptz,attempts integer NOT NULL DEFAULT 0,delivered_at timestamptz,cancelled_at timestamptz,CONSTRAINT attention_reminder_window UNIQUE(company_id,item_id,recipient_id,stage,window_key));
CREATE INDEX attention_reminder_due ON attention_reminders(available_at) WHERE delivered_at IS NULL AND cancelled_at IS NULL;
