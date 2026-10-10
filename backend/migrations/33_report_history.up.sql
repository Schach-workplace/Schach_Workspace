CREATE TABLE task_facts (
 id text PRIMARY KEY, company_id text NOT NULL, task_id text NOT NULL, task_version bigint NOT NULL,
 recorded_at timestamptz NOT NULL, effective_at timestamptz NOT NULL, effective_at_raw text NOT NULL,
 operation text NOT NULL, actor_id text NOT NULL, actor_kind text NOT NULL CHECK(actor_kind IN ('user','system','observation')),
 provenance text NOT NULL CHECK(provenance IN ('native_event','observed_current_state')), known_from timestamptz NOT NULL,
 unknown_before boolean NOT NULL, state_hash text NOT NULL, state jsonb NOT NULL,
 UNIQUE(company_id,task_id,task_version)
);
CREATE INDEX task_facts_company_effective ON task_facts(company_id,effective_at,task_id);
CREATE TABLE task_history_coverages (
 company_id text NOT NULL, task_id text NOT NULL, first_known_at timestamptz NOT NULL, unknown_before boolean NOT NULL,
 last_recorded_version bigint NOT NULL, state_hash text NOT NULL, inconsistent boolean NOT NULL, last_fact_id text NOT NULL,
 PRIMARY KEY(company_id,task_id)
);
CREATE TABLE task_history_gaps (
 id text PRIMARY KEY, company_id text NOT NULL, task_id text NOT NULL, from_exclusive timestamptz NOT NULL,
 to_exclusive timestamptz, reason text NOT NULL, before_fact_id text NOT NULL, after_fact_id text NOT NULL
);
CREATE INDEX task_history_gaps_task ON task_history_gaps(company_id,task_id);
CREATE TABLE task_acceptance_facts (
 id text PRIMARY KEY, company_id text NOT NULL, task_id text NOT NULL, task_version bigint NOT NULL,
 task_fact_id text NOT NULL UNIQUE, accepted_at timestamptz NOT NULL, accepted_at_raw text NOT NULL,
 actor_id text NOT NULL, acceptance_kind text NOT NULL CHECK(acceptance_kind IN ('independent_review','direct_completion')),
 state jsonb NOT NULL, UNIQUE(company_id,task_id,task_version)
);
CREATE INDEX task_acceptance_company_at ON task_acceptance_facts(company_id,accepted_at,task_id);
CREATE TABLE task_time_facts (
 id text PRIMARY KEY, company_id text NOT NULL, time_entry_id text NOT NULL, task_id text NOT NULL,
 task_version bigint NOT NULL, task_fact_id text NOT NULL, recorded_at timestamptz NOT NULL, recorded_at_raw text NOT NULL,
 observed_at timestamptz, entry_date text NOT NULL, hours double precision NOT NULL, actor_id text NOT NULL,
 provenance text NOT NULL CHECK(provenance IN ('native_time_entry','observed_time_entry')), UNIQUE(company_id,time_entry_id)
);
CREATE INDEX task_time_company_date ON task_time_facts(company_id,entry_date,task_id);
