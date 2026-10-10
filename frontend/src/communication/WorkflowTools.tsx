import { useEffect, useState, useEffectEvent, useRef } from 'react';
import type { Conversation, Message } from './types';
import type { WorkspaceData, Task } from '../types';
interface Intake {
  id: string;
  title: string;
  summary: string;
  state: string;
  version: number;
  departmentId: string;
  taskId: string;
  createdAt: string;
}
interface ExpenseLink {
  id: string;
  title: string;
  status: string;
  amountMinor: number;
  currency: string;
}
export default function WorkflowTools({
  conversation,
  source,
  data,
  command,
  onClose,
  onTask,
  onSource,
}: {
  conversation: Conversation;
  source: Message | null;
  data: WorkspaceData;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
  onClose: () => void;
  onTask?: (id: string) => void;
  onSource?: (id: string) => void;
}) {
  const [mode, setMode] = useState<'request' | 'expense'>('request');
  const [title, setTitle] = useState(source?.body.slice(0, 200) ?? '');
  const [summary, setSummary] = useState('');
  const [department, setDepartment] = useState(data.me.departmentId ?? '');
  const [category, setCategory] = useState('');
  const [vendor, setVendor] = useState('');
  const [invoice, setInvoice] = useState('');
  const [expenseDate, setExpenseDate] = useState('');
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [preview, setPreview] = useState<{ audienceUserIds: string[]; notice: string } | null>(
    null,
  );
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<Intake[]>([]);
  const [links, setLinks] = useState<Task[]>([]);
  const [expenseLinks, setExpenseLinks] = useState<ExpenseLink[]>([]);
  const [owner, setOwner] = useState(data.me.id);
  const [due, setDue] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [split, setSplit] = useState('');
  const [actions, setActions] = useState<string[]>([]);
  const [sources, setSources] = useState<
    Record<
      string,
      { messageId: string; revision: number; currentRevision: number; outOfDate: boolean }[]
    >
  >({});
  const alive = useRef(true);
  const revision = useRef(0);
  async function refresh() {
    const current = ++revision.current;
    setLinks([]);
    setSources({});
    setRequests([]);
    setExpenseLinks([]);
    const [r, t, e] = await Promise.all([
      command<{ requests: Intake[] }>('/communication/requests', undefined, 'GET'),
      command<{ tasks: Task[] }>(`/conversations/${conversation.id}/work-links`, undefined, 'GET'),
      command<{ expenses: ExpenseLink[] }>(
        `/conversations/${conversation.id}/expense-links`,
        undefined,
        'GET',
      ),
    ]);
    if (!alive.current || revision.current !== current) return;
    const checked = await Promise.all(
      t.tasks.map(async (task) => {
        try {
          const v = await command<{
            sources: {
              messageId: string;
              revision: number;
              currentRevision: number;
              outOfDate: boolean;
            }[];
          }>(`/conversations/${conversation.id}/work-links/${task.id}/sources`, undefined, 'GET');
          return [task.id, v.sources] as const;
        } catch {
          return [task.id, null] as const;
        }
      }),
    );
    if (!alive.current || revision.current !== current) return;
    const accessible = new Set(checked.filter(([, s]) => s).map(([id]) => id));
    setRequests(r.requests);
    setLinks(t.tasks.filter((t) => accessible.has(t.id)));
    setSources(Object.fromEntries(checked.filter(([, s]) => s).map(([id, s]) => [id, s!])));
    setExpenseLinks(e.expenses);
  }
  const refreshEvent = useEffectEvent(() => {
    void refresh().catch((e) => {
      if (alive.current) setError(e.message);
    });
  });
  useEffect(() => {
    alive.current = true;
    refreshEvent();
    const timer = setInterval(() => refreshEvent(), 15000);
    const event = () => refreshEvent();
    window.addEventListener('schach-work-event', event);
    return () => {
      alive.current = false;
      revision.current++;
      clearInterval(timer);
      window.removeEventListener('schach-work-event', event);
    };
  }, [conversation.id]);
  const change = () => {
    setPreview(null);
    setConfirmed(false);
  };
  const conversion = {
    retryKey: key,
    anchorMessageId: source?.id,
    sources: source ? [{ messageId: source.id, revision: source.revision }] : [],
    expectedPolicyVersion: conversation.version,
    publication: { excerpt: summary, attachmentIds: [] },
    expense: {
      departmentId: department,
      categoryId: category,
      title,
      description: '',
      vendor,
      invoiceNumber: invoice,
      expenseDate,
      amountMinor: Number(amount),
      projectId: '',
      taskId: '',
      receiptExceptionReason: '',
    },
  };
  async function publish(create: boolean) {
    if (!source) return;
    setBusy(true);
    try {
      if (mode === 'expense') {
        if (!/^\d+$/.test(amount) || !Number.isSafeInteger(Number(amount)))
          throw new Error('Enter an exact integer amount in minor units.');
        const result = await command<{ audienceUserIds: string[]; notice: string }>(
          `/conversations/${conversation.id}/expense-conversions${create ? '' : '/preview'}`,
          conversion,
        );
        if (!create) {
          setPreview(result);
          return;
        }
      } else {
        if (!create) {
          setPreview(
            await command<{ audienceUserIds: string[]; notice: string }>(
              `/conversations/${conversation.id}/requests/preview`,
              {
                retryKey: key,
                anchorMessageId: source.id,
                sourceRevision: source.revision,
                expectedPolicyVersion: conversation.version,
                departmentId: department,
                title,
                summary,
              },
            ),
          );
          return;
        }
        await command(`/conversations/${conversation.id}/requests`, {
          retryKey: key,
          anchorMessageId: source.id,
          sourceRevision: source.revision,
          expectedPolicyVersion: conversation.version,
          departmentId: department,
          title,
          summary,
        });
      }
      setKey(crypto.randomUUID());
      await refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function assign(item: Intake) {
    try {
      await command(`/communication/requests/${item.id}/assign`, {
        expectedVersion: item.version,
        task: {
          title: item.title,
          description: item.summary,
          ownerId: owner,
          reviewerId: reviewer,
          requiresApproval: !!reviewer,
          departmentId: item.departmentId,
          projectId: '',
          parentId: '',
          priority: 'medium',
          status: 'todo',
          dueDate: due,
          startDate: '',
          estimatedHours: 0,
          tags: [],
          checklist: [],
          dependencies: [],
          collaborators: [],
          recurrence: 'none',
        },
      });
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function close(item: Intake, state: string) {
    const reason = window.prompt('Explain the outcome');
    if (!reason) return;
    try {
      await command(
        `/communication/requests/${item.id}`,
        { expectedVersion: item.version, state, reason },
        'PATCH',
      );
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <section aria-label="Published work and finance">
      <h3>Published work and finance</h3>
      <p>Links are shown only when you can read both the source and the destination record.</p>
      {links.map((t) => (
        <article key={t.id}>
          <p>
            {t.code} · {t.title} · {t.status} · {t.dueDate || 'No deadline'}
          </p>
          <button onClick={() => onTask?.(t.id)}>Open task: {t.title}</button>
          {sources[t.id]?.map((source) => (
            <p key={source.messageId}>
              {source.outOfDate
                ? 'Source changed; published excerpt remains its reviewed revision.'
                : 'Published source is current.'}{' '}
              Revision {source.revision} · current {source.currentRevision}
              <button onClick={() => onSource?.(source.messageId)}>Open current source</button>
            </p>
          ))}
        </article>
      ))}
      {expenseLinks.map((e) => (
        <p key={e.id}>
          {e.title} · {e.status} · {e.currency} {e.amountMinor / 100}
        </p>
      ))}
      {source && conversation.forwarding === 'selected' && (
        <div>
          <label>
            Publish as
            <select
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as typeof mode);
                change();
              }}
            >
              <option value="request">Operational intake request</option>
              <option value="expense">Incurred-expense draft</option>
            </select>
          </label>
          <label>
            Published title
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                change();
              }}
            />
          </label>
          <label>
            Selected summary / excerpt
            <textarea
              value={summary}
              onChange={(e) => {
                setSummary(e.target.value);
                change();
              }}
            />
          </label>
          <label>
            Responsible department
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                change();
              }}
            >
              <option value="">Choose department</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          {mode === 'expense' && (
            <>
              <label>
                Category
                <select
                  value={category}
                  onChange={(e) => {
                    setCategory(e.target.value);
                    change();
                  }}
                >
                  <option value="">Choose category</option>
                  {data.expenseCategories
                    .filter((c) => c.active)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Vendor
                <input
                  value={vendor}
                  onChange={(e) => {
                    setVendor(e.target.value);
                    change();
                  }}
                />
              </label>
              <label>
                Invoice number
                <input
                  value={invoice}
                  onChange={(e) => {
                    setInvoice(e.target.value);
                    change();
                  }}
                />
              </label>
              <label>
                Incurred date
                <input
                  type="date"
                  value={expenseDate}
                  onChange={(e) => {
                    setExpenseDate(e.target.value);
                    change();
                  }}
                />
              </label>
              <label>
                Exact amount in minor units ({data.company.currency})
                <input
                  inputMode="numeric"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    change();
                  }}
                />
              </label>
            </>
          )}
          {preview && (
            <div>
              <p>{preview.notice}</p>
              <p>
                Current audience:{' '}
                {preview.audienceUserIds
                  .map((uid) => data.people.find((p) => p.id === uid)?.name ?? 'Company member')
                  .join(', ')}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                I reviewed the selected publication and work audience
              </label>
            </div>
          )}
          <button
            disabled={busy || !title.trim() || !department}
            onClick={() => void publish(false)}
          >
            Preview publication
          </button>
          <button disabled={busy || !preview || !confirmed} onClick={() => void publish(true)}>
            Publish selected record
          </button>
          <button onClick={onClose}>Cancel</button>
          <label>
            Explicit split action titles, one per line
            <textarea value={split} onChange={(e) => setSplit(e.target.value)} />
          </label>
          <button
            disabled={busy || split.split('\n').filter(Boolean).length < 2}
            onClick={() =>
              void command<{ actionIds: string[] }>(
                `/conversations/${conversation.id}/work-actions`,
                {
                  retryKey: key,
                  anchorMessageId: source.id,
                  sourceRevision: source.revision,
                  expectedPolicyVersion: conversation.version,
                  titles: split.split('\n').filter(Boolean),
                },
              )
                .then((v) => setActions(v.actionIds))
                .catch((e) => setError(e.message))
            }
          >
            Declare separate work actions
          </button>
          {actions.length > 0 && (
            <p>
              Declared {actions.length} separate actions. Their identifiers are retained by the
              server for task conversion.
            </p>
          )}
        </div>
      )}
      <h4>Authorized intake queue</h4>
      {requests.map((item) => (
        <article key={item.id}>
          <strong>
            {item.title} · {item.state}
          </strong>
          <p>{item.summary}</p>
          <small>Created {new Date(item.createdAt).toLocaleString()}</small>
          {item.state === 'open' &&
            (['founder', 'ceo', 'admin'].includes(data.me.role) ||
              (data.me.role === 'head' && item.departmentId === data.me.departmentId)) && (
              <div>
                <label>
                  Task owner
                  <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                    {data.people
                      .filter((p) => p.active && p.role !== 'viewer')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Independent reviewer
                  <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                    <option value="">No review</option>
                    {data.people
                      .filter((p) => p.active && p.role !== 'viewer' && p.id !== owner)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                  </select>
                </label>
                <label>
                  Task due date
                  <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                </label>
                <button disabled={!due} onClick={() => void assign(item)}>
                  Assign through task workflow
                </button>
              </div>
            )}
          {!['resolved', 'cancelled'].includes(item.state) && data.me.role !== 'viewer' && (
            <>
              <button onClick={() => void close(item, 'resolved')}>
                Resolve after task acceptance
              </button>
              <button onClick={() => void close(item, 'cancelled')}>Cancel with reason</button>
            </>
          )}
        </article>
      ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
