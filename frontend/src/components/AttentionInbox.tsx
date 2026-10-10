import { useAttentionInput } from '../data/attentionInput';
import AttentionSource from './AttentionSource';
import { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../store';
import { ApiError } from '../data/api';
import { attentionDetail, useAttention } from '../data/attention';
import { attentionIntent } from '../../../shared/attention/types';
import type { AttentionView, AttentionTransitionInput } from '../types';
import { deadlineCandidates, localDeadline } from '../data/deadlines';
import { Modal, ErrorMessage, Field } from './UI';
export default function AttentionInbox({
  onTask,
  onExpense,
  decisionsOnly = false,
}: {
  onTask: (id: string) => void;
  onExpense: (id: string) => void;
  decisionsOnly?: boolean;
}) {
  const store = useWorkspace();
  const [state, setState] = useState('open');
  const query = useAttention({ state, decisionsOnly });
  const [business, setBusiness] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    action: AttentionTransitionInput['action'];
  } | null>(null);
  useEffect(() => {
    if (query.denied) {
      setSelected(null);
      setBusiness(null);
    } else if (query.ready) {
      if (selected && !query.items.some((i) => i.id === selected.id)) setSelected(null);
      if (business && !query.items.some((i) => i.id === business)) setBusiness(null);
    }
  }, [query.denied, query.ready, query.items, selected, business]);
  const company = store.companyId ?? store.data?.company.id ?? '';
  const user = store.session?.user.id ?? store.data?.me.id ?? '';
  return (
    <section
      className="panel attention-inbox"
      aria-label={decisionsOnly ? 'Your pending business decisions' : 'Action required'}
    >
      <h2>{decisionsOnly ? 'Your business decisions' : 'Action required'}</h2>
      <p>
        {decisionsOnly
          ? 'Pending business decisions, including resolved or snoozed Inbox items.'
          : 'Resolve this Inbox item; this does not approve the work. Reading updates is separate.'}
      </p>
      {!decisionsOnly && (
        <Field label="Attention filter">
          <select
            aria-label="Attention filter"
            value={state}
            onChange={(e) => setState(e.target.value)}
          >
            <option value="open">Action required</option>
            <option value="resolved">Resolved</option>
            <option value="all">All actions</option>
          </select>
        </Field>
      )}
      {query.loading && <p role="status">Loading authorized attention…</p>}
      {query.error && (
        <>
          <ErrorMessage error={query.error.message} />
          <button className="button" onClick={() => void query.retry()}>
            Retry attention
          </button>
        </>
      )}
      {query.ready && query.items.length === 0 && <p>No current actions in this view.</p>}
      {query.items.map((item) => (
        <article className="attention-card" key={item.id}>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          {item.ownerName && <p>Owner: {item.ownerName}</p>}
          {item.snoozedUntil && (
            <p>
              Snoozed until{' '}
              {new Intl.DateTimeFormat(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: store.data!.company.timezone,
              }).format(new Date(item.snoozedUntil))}
            </p>
          )}
          <div className="attention-actions">
            <button
              className="button button-secondary"
              onClick={() => {
                if (item.sourceKind === 'task') onTask(item.sourceId);
                else if (item.sourceKind === 'expense') onExpense(item.sourceId);
                else if (item.sourceKind === 'intake' || item.sourceKind === 'record')
                  setBusiness(item.id);
                else window.location.hash = item.link;
              }}
            >
              {item.canDecide ? 'Open business decision' : 'Open source'}
            </button>
            {!decisionsOnly && item.state === 'open' && (
              <>
                <button
                  className="button button-secondary"
                  onClick={() => setSelected({ id: item.id, action: 'resolve' })}
                >
                  Resolve Inbox item
                </button>
                <button
                  className="button button-secondary"
                  onClick={() =>
                    setSelected({ id: item.id, action: item.snoozedUntil ? 'unsnooze' : 'snooze' })
                  }
                >
                  {item.snoozedUntil ? 'Unsnooze' : 'Snooze'}
                </button>
                {item.canRoute && (
                  <button
                    className="button button-secondary"
                    onClick={() => setSelected({ id: item.id, action: 'route' })}
                  >
                    Route Inbox item
                  </button>
                )}
              </>
            )}
          </div>
        </article>
      ))}
      {business && query.foreground && query.ready && (
        <AttentionSource
          key={
            company +
            ':' +
            user +
            ':' +
            business +
            ':' +
            query.items.find((i) => i.id === business)?.sourceVersion
          }
          id={business}
          onClose={() => setBusiness(null)}
          onTask={onTask}
        />
      )}
      {selected && (
        <div hidden={!query.ready}>
          <AttentionAction
            key={company + ':' + user + ':' + selected.id + ':' + selected.action}
            visible={query.ready && query.foreground}
            authorizationKey={String(
              query.items.find((i) => i.id === selected.id)?.sourceVersion ?? 'pending',
            )}
            company={company}
            user={user}
            id={selected.id}
            action={selected.action}
            onClose={() => setSelected(null)}
          />
        </div>
      )}
    </section>
  );
}
function AttentionAction({
  company,
  user,
  id,
  action,
  onClose,
  visible,
  authorizationKey,
}: {
  visible: boolean;
  authorizationKey: string;
  company: string;
  user: string;
  id: string;
  action: AttentionTransitionInput['action'];
  onClose: () => void;
}) {
  const store = useWorkspace();
  const [source, setSource] = useState<AttentionView | null>(null);
  const [error, setError] = useState('');
  const [draft, editDraft, retireDraft] = useAttentionInput(company, user, id, action);
  const { reason, recipient, local, instant, reviewed, attempt } = draft;
  const setReason = (reason: string) => editDraft({ reason });
  const setRecipient = (recipient: string) => editDraft({ recipient });
  const setLocal = (local: string) => editDraft({ local });
  const setInstant = (instant: string) => editDraft({ instant });
  const setReviewed = (reviewed: boolean) =>
    editDraft({ reviewed, reviewVersion: source?.version ?? 0 });
  const setAttempt = (attempt: AttentionTransitionInput | null) => editDraft({ attempt });
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    const abort = new AbortController();
    setSource(null);
    attentionDetail(store.mode, company, user, id, abort.signal)
      .then((r) => {
        if (current.current) setSource(r.item);
      })
      .catch((e) => {
        if (current.current && e.name !== 'AbortError') {
          setError(e.message);
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) retireDraft();
        }
      });
    return () => {
      current.current = false;
      abort.abort();
    };
  }, [store.mode, company, user, id, authorizationKey]);
  useEffect(() => {
    if (source && draft.reviewed && !draft.attempt && draft.reviewVersion !== source.version)
      editDraft({ reviewed: false });
  }, [source, draft.reviewed, draft.attempt, draft.reviewVersion]);
  const zone = store.data?.company.timezone ?? 'UTC';
  const candidates = local ? deadlineCandidates(local, zone) : [];
  const snooze = instant || (candidates.length === 1 ? candidates[0] : '');
  const labels = {
    resolve: 'resolution',
    route: 'routing',
    snooze: 'snooze',
    unsnooze: 'unsnooze',
  };
  const label = labels[action];
  const valid =
    !!source &&
    (action === 'resolve'
      ? reason.trim().length > 0
      : action === 'route'
        ? reason.trim().length > 0 && source.routePeople.some((p) => p.id === recipient)
        : action === 'snooze'
          ? !!snooze
          : true);
  async function submit() {
    if (busyRef.current || !source) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    const payload =
      attempt ??
      attentionIntent(
        source,
        action,
        { reason, recipientId: recipient, snoozedUntil: snooze },
        crypto.randomUUID(),
      );
    setAttempt(payload);
    try {
      await store.mutate(`/attention/${encodeURIComponent(id)}/transition`, payload);
      if (current.current) {
        retireDraft();
        onClose();
      }
    } catch (e) {
      if (current.current) {
        setError((e as Error).message);
        if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
          setSource(null);
          retireDraft();
        }
      }
    } finally {
      busyRef.current = false;
      if (current.current) setBusy(false);
    }
  }
  return (
    <Modal
      open={visible}
      title={`Review ${label}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>Resolve this Inbox item; this does not approve the work.</p>
      <ErrorMessage error={error} />
      {!source && !error && <p role="status">Checking current source access…</p>}
      {source && (
        <>
          <p>{source.title}</p>
          {['resolve', 'route'].includes(action) && (
            <Field label={action === 'resolve' ? 'Resolution reason' : 'Routing reason'}>
              <textarea
                aria-label={action === 'resolve' ? 'Resolution reason' : 'Routing reason'}
                value={reason}
                maxLength={4000}
                disabled={reviewed || busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          )}
          {action === 'route' && (
            <Field label="Route to">
              <select
                aria-label="Route to"
                value={recipient}
                disabled={reviewed || busy}
                onChange={(e) => setRecipient(e.target.value)}
              >
                <option value="">Choose a person</option>
                {source.routePeople.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {action === 'snooze' && (
            <>
              <Field label={`Snooze until (${zone})`}>
                <input
                  aria-label="Snooze until"
                  type="datetime-local"
                  value={local}
                  disabled={reviewed || busy}
                  onChange={(e) => {
                    setLocal(e.target.value);
                    setInstant('');
                  }}
                />
              </Field>
              <button
                className="button button-secondary"
                disabled={reviewed || busy}
                onClick={() => {
                  const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                  setLocal(localDeadline(at, zone));
                  setInstant(at);
                }}
              >
                In one hour
              </button>
              {candidates.length === 0 && local && (
                <p role="alert">This local time does not exist. Choose another time.</p>
              )}
              {candidates.length > 1 && (
                <Field label="Choose exact instant">
                  <select
                    aria-label="Choose exact instant"
                    value={instant}
                    disabled={reviewed || busy}
                    onChange={(e) => setInstant(e.target.value)}
                  >
                    <option value="">Choose an offset</option>
                    {candidates.map((v) => (
                      <option value={v} key={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </>
          )}
          {reviewed ? (
            <>
              <p>
                Confirm {label}
                {recipient ? ' to ' + source.routePeople.find((p) => p.id === recipient)?.name : ''}
                {snooze && action === 'snooze' ? ' until ' + snooze : ''}.
              </p>
              <button
                className="button button-secondary"
                disabled={busy}
                onClick={() => {
                  setReviewed(false);
                  setAttempt(null);
                  setError('');
                }}
              >
                Edit action
              </button>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? 'Saving…' : attempt && error ? 'Retry same action' : `Confirm ${label}`}
              </button>
            </>
          ) : (
            <button
              className="button button-primary"
              disabled={!valid || busy}
              onClick={() => setReviewed(true)}
            >
              Review {label}
            </button>
          )}
        </>
      )}
    </Modal>
  );
}
