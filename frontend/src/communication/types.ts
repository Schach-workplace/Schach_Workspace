export interface Conversation {
  peerId?: string;
  id: string;
  companyId: string;
  title: string;
  kind: 'dm' | 'group' | 'channel';
  public: boolean;
  forwarding: 'deny' | 'selected';
  version: number;
  archived: boolean;
  createdBy: string;
  createdAt: string;
}
export interface Message {
  mediaIds?: string[];
  mentionIds?: string[];
  mentionAll?: boolean;
  id: string;
  conversationId: string;
  senderId: string;
  clientMessageId: string;
  body: string;
  replyToId: string;
  sequence: number;
  revision: number;
  removed: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Member {
  userId: string;
  role: 'owner' | 'moderator' | 'member' | 'viewer';
  active: boolean;
  historyFromSequence: number;
  epoch: number;
  readSequence: number;
}
