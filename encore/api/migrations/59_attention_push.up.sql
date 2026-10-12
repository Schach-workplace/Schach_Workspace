CREATE TABLE attention_pushes (
 item_id text NOT NULL REFERENCES attention_items(id), device_id text NOT NULL REFERENCES communication_devices(id), event_id text NOT NULL, company_id text NOT NULL,
 user_id text NOT NULL, attempts integer NOT NULL DEFAULT 0, done boolean NOT NULL DEFAULT false, lease_until timestamptz, lease_token text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(item_id,device_id), FOREIGN KEY(company_id,user_id) REFERENCES memberships(company_id,user_id)
);
CREATE INDEX attention_push_pending ON attention_pushes(lease_until) WHERE NOT done;
CREATE INDEX attention_delivery_push_recent ON attention_deliveries(created_at,item_id);
