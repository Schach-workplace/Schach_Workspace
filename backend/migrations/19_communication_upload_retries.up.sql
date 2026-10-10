ALTER TABLE communication_media ADD COLUMN client_upload_id text NOT NULL DEFAULT '', ADD COLUMN request_hash text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX media_upload_retry ON communication_media(company_id,user_id,client_upload_id) WHERE client_upload_id<>'';
