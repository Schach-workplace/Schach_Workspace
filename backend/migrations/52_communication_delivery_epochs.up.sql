ALTER TABLE communication_events ADD COLUMN audience_captured boolean NOT NULL DEFAULT false;
CREATE TABLE communication_audiences (
 event_id varchar(80) NOT NULL REFERENCES communication_events(id),
 -- Opaque recipient identity, deliberately no late User FK lock at event creation.
 user_id varchar(80) NOT NULL,
 membership_epoch bigint NOT NULL CHECK (membership_epoch>0),
 recipient_epoch bigint NOT NULL CHECK (recipient_epoch>=0),
 PRIMARY KEY(event_id,user_id)
);
ALTER TABLE communication_inboxes ADD COLUMN membership_epoch bigint NOT NULL DEFAULT 1 CHECK (membership_epoch>0);
ALTER TABLE communication_inboxes ADD COLUMN recipient_epoch bigint NOT NULL DEFAULT 0 CHECK (recipient_epoch>=0);
INSERT INTO communication_audiences(event_id,user_id,membership_epoch,recipient_epoch)
SELECT e.id,m.user_id,m.access_epoch,COALESCE(cm.epoch,0)
FROM communication_events e JOIN conversations c ON c.company_id=e.company_id AND c.id=e.conversation_id
JOIN memberships m ON m.company_id=e.company_id AND m.active
LEFT JOIN conversation_members cm ON cm.company_id=e.company_id AND cm.conversation_id=e.conversation_id AND cm.user_id=m.user_id AND cm.active
WHERE (c.public OR cm.user_id IS NOT NULL) AND (c.public OR e.message_sequence=0 OR e.message_sequence>=cm.history_from_sequence);
UPDATE communication_events SET audience_captured=true;
UPDATE communication_inboxes i SET membership_epoch=m.access_epoch FROM memberships m WHERE m.company_id=i.company_id AND m.user_id=i.user_id;
UPDATE communication_inboxes i SET recipient_epoch=cm.epoch FROM conversation_members cm WHERE cm.company_id=i.company_id AND cm.conversation_id=i.conversation_id AND cm.user_id=i.user_id AND cm.active;
