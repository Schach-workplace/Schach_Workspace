import { expect, it } from 'vitest';
import {
  readDraft,
  writeDraft,
  clearAllDrafts,
  clearCompanyDrafts,
  clearConversationDrafts,
} from './drafts';
const scope = {
  serverOrigin: 'https://one.test',
  companyId: 'c',
  userId: 'u',
  conversationId: 'a',
  threadRootId: '',
};
it('isolates authored RAM by conversation and thread and erases company scope', () => {
  clearAllDrafts();
  writeDraft(scope, { body: 'private' });
  expect(readDraft({ ...scope, conversationId: 'b' }).body).toBe('');
  expect(readDraft({ ...scope, threadRootId: 'm' }).body).toBe('');
  expect(readDraft(scope).body).toBe('private');
  clearCompanyDrafts('c', 'u');
  expect(readDraft(scope).body).toBe('');
});
it('clears all affected thread drafts on a conversation history boundary', () => {
  writeDraft(scope, { body: 'main' });
  writeDraft({ ...scope, threadRootId: 'm' }, { body: 'thread' });
  clearConversationDrafts('c', 'u', 'a');
  expect(readDraft(scope).body).toBe('');
  expect(readDraft({ ...scope, threadRootId: 'm' }).body).toBe('');
});
