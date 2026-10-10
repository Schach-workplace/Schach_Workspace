CREATE TABLE attention_deliveries(id text PRIMARY KEY,company_id text NOT NULL,item_id text NOT NULL,recipient_id text NOT NULL,stage text NOT NULL,created_at timestamptz NOT NULL);
CREATE INDEX attention_delivery_recipient ON attention_deliveries(company_id,item_id,recipient_id);
