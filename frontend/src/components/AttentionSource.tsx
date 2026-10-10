import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { attentionDetail } from '../data/attention';
import { request } from '../data/api';
import type { AttentionView } from '../types';
import type { Conversation } from '../communication/types';
import Structured from '../communication/Structured';
import WorkflowTools from '../communication/WorkflowTools';
import { Modal, ErrorMessage } from './UI';
export default function AttentionSource({
  id,
  onClose,
  onTask,
}: {
  id: string;
  onClose: () => void;
  onTask: (id: string) => void;
}) {
  const store = useWorkspace();
  const company = store.companyId;
  const [view, setView] = useState<AttentionView | null>(null);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [error, setError] = useState('');
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const abort = new AbortController();
    attentionDetail(store.mode, company, store.session!.user.id, id, abort.signal)
      .then(async (r) => {
        if (r.item.sourceKind === 'record') {
          const params = new URLSearchParams(r.item.link.split('?')[1]);
          const v = await request<{ conversation: Conversation }>(
            `/companies/${encodeURIComponent(company)}/conversations/${encodeURIComponent(params.get('conversation') ?? '')}`,
            { signal: abort.signal },
          );
          if (active.current) setConversation(v.conversation);
        }
        if (active.current) setView(r.item);
      })
      .catch((e) => {
        if (active.current && e.name !== 'AbortError') setError(e.message);
      });
    return () => {
      active.current = false;
      abort.abort();
    };
  }, [company, id, store.mode, store.session?.user.id]);
  async function command<T>(path: string, body: unknown, method = 'POST'): Promise<T> {
    if (method === 'GET') return request<T>(`/companies/${encodeURIComponent(company)}${path}`);
    const result = await store.mutate(path, body, method as 'POST' | 'PATCH');
    return result as T;
  }
  return (
    <Modal open title="Current business source" onClose={onClose} wide>
      <ErrorMessage error={error} />
      {!view && !error && <p role="status">Checking current business access…</p>}
      {view?.sourceKind === 'intake' && (
        <WorkflowTools
          conversation={null}
          requestId={view.sourceId}
          source={null}
          data={store.data!}
          command={command}
          onClose={onClose}
          onTask={onTask}
        />
      )}
      {view?.sourceKind === 'record' && conversation && (
        <Structured
          conversation={conversation}
          recordId={view.sourceId}
          source={null}
          data={store.data!}
          command={command}
          onClose={onClose}
        />
      )}
    </Modal>
  );
}
