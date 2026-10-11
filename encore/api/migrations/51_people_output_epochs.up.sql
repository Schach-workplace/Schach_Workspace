ALTER TABLE attention_items ADD COLUMN membership_epoch bigint NOT NULL DEFAULT 1 CHECK (membership_epoch > 0);
ALTER TABLE goal_reminder_preferences ADD COLUMN membership_epoch bigint NOT NULL DEFAULT 1 CHECK (membership_epoch > 0);
ALTER TABLE report_export_jobs ADD COLUMN recipient_access_epoch bigint NOT NULL DEFAULT 1 CHECK (recipient_access_epoch > 0);
UPDATE attention_items i SET membership_epoch=m.access_epoch FROM memberships m WHERE m.company_id=i.company_id AND m.user_id=i.recipient_id;
UPDATE goal_reminder_preferences p SET membership_epoch=m.access_epoch FROM memberships m WHERE m.company_id=p.company_id AND m.user_id=p.user_id;
UPDATE report_export_jobs j SET recipient_access_epoch=m.access_epoch FROM memberships m WHERE m.company_id=j.company_id AND m.user_id=j.recipient_id;
