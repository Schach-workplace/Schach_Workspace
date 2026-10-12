import { useAttentionInput, purgeAttentionInput } from '../data/attentionInput';
import AttentionSource from './AttentionSource';
import { useState, useRef, useEffect } from 'react';
import { useWorkspace } from '../store';
import { ApiError } from '../data/api';
import { attentionDetail, useAttention } from '../data/attention';
import { attentionIntent } from '../../../shared/attention/types';
import type { AttentionView, AttentionTransitionInput } from '../types';
import { deadlineCandidates, localDeadline } from '../data/deadlines';
import { Modal, ErrorMessage, Field, cx } from './UI';
import {
  ArrowRight,
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Clock3,
  Forward,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react';
import '../styles/shell.css';
const kindLabels: Record<string, string> = {
  task_review: 'Task review',
  expense_review: 'Expense review',
  decision: 'Decision',
  intake_triage: 'Intake triage',
  deadline: 'Deadline',
  saved_reminder: 'Reminder',
  blocker: 'Blocker',
  update: 'Update',
  report_ready: 'Report ready',
  receipt_review: 'Receipt review',
  duplicate_review: 'Duplicate review',
  reconciliation_review: 'Reconciliation',
};
function kindTone(kind: string) {
  if (kind.endsWith('_review') || kind === 'decision') return 'purple';
  if (kind === 'blocker' || kind === 'deadline') return 'red';
  if (kind === 'report_ready' || kind === 'update') return 'slate';
  return 'orange';
}
function formatInstant(value: string, timeZone: string, withTime: boolean) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone,
  }).format(new Date(value));
}
export default function AttentionInbox({
  onTask,
  onExpense,
  decisionsOnly = false,
  sourceTaskId,
}: {
  onTask: (id: string) => void;
  onExpense: (id: string) => void;
  decisionsOnly?: boolean;
  sourceTaskId?: string;
}) {
  const store = useWorkspace();
  const [state, setState] = useState('open');
  const [decisionFilter, setDecisionFilter] = useState('all');
  const query = useAttention({ state, decisionsOnly, sourceTaskId });
  const [business, setBusiness] = useState<string | null>(null);
  const [selected, setSelected] = useState<{
    id: string;
    action: AttentionTransitionInput['action'];
  } | null>(null);
  const company = store.companyId ?? store.data?.company.id ?? '';
  const user = store.session?.user.id ?? store.data?.me.id ?? '';
  useEffect(() => {
    if (query.denied) {
      if (selected) purgeAttentionInput(company, user, selected.id, selected.action);
      setSelected(null);
      setBusiness(null);
    } else if (query.ready) {
      if (selected && !query.items.some((i) => i.id === selected.id)) {
        purgeAttentionInput(company, user, selected.id, selected.action);
        setSelected(null);
      }
      if (business && !query.items.some((i) => i.id === business)) setBusiness(null);
    }
  }, [query.denied, query.ready, query.items, selected, business, company, user]);
  const zone = store.data?.company.timezone ?? 'UTC';
  const now = Date.now();
  const snoozed = (i: AttentionView) =>
    i.state === 'open' && !!i.snoozedUntil && new Date(i.snoozedUntil).getTime() > now;
  const bucket = (i: AttentionView) =>
    i.state !== 'open' ? 'resolved' : snoozed(i) ? 'snoozed' : 'open';
  // Decisions stay listed whatever their Inbox state; this filter only narrows the view.
  const inFilter = (i: AttentionView, filter: string) =>
    !decisionsOnly || filter === 'all' || bucket(i) === filter;
  // An item that is open in a decision/action surface stays listed even if its
  // state changes underneath the filter, so the selection never points at a hidden row.
  const shown = query.items.filter(
    (i) => inFilter(i, decisionFilter) || i.id === business || i.id === selected?.id,
  );
  const chooseDecisionFilter = (filter: string) => {
    setDecisionFilter(filter);
    const hidden = (id: string) => {
      const item = query.items.find((i) => i.id === id);
      return !item || !inFilter(item, filter);
    };
    if (business && hidden(business)) setBusiness(null);
    if (selected && hidden(selected.id)) {
      purgeAttentionInput(company, user, selected.id, selected.action);
      setSelected(null);
    }
  };
  const title = decisionsOnly ? 'Your business decisions' : 'Action required';
  const description = decisionsOnly
    ? 'Pending business decisions, including resolved or snoozed Inbox items.'
    : 'Resolve this Inbox item; this does not approve the work. Reading updates is separate.';
  const segments = decisionsOnly
    ? [
        { id: 'all', label: 'All', count: query.items.length },
        {
          id: 'open',
          label: 'Awaiting you',
          count: query.items.filter((i) => bucket(i) === 'open').length,
        },
        {
          id: 'snoozed',
          label: 'Snoozed',
          count: query.items.filter((i) => bucket(i) === 'snoozed').length,
        },
        {
          id: 'resolved',
          label: 'Resolved in Inbox',
          count: query.items.filter((i) => bucket(i) === 'resolved').length,
        },
      ]
    : [
        { id: 'open', label: 'Action required' },
        { id: 'resolved', label: 'Resolved' },
        { id: 'all', label: 'All actions' },
      ];
  const active = decisionsOnly ? decisionFilter : state;
  const showFilter = decisionsOnly ? query.ready && query.items.length > 0 : !sourceTaskId;
  return (
    <section
      className={cx('panel decision-panel', decisionsOnly && 'decision-panel-overview')}
      aria-label={decisionsOnly ? 'Your pending business decisions' : 'Action required'}
    >
      <div className="section-header decision-header">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        {showFilter && (
          <div
            className="segmented decision-filter"
            role="group"
            aria-label={decisionsOnly ? 'Decision filter' : 'Attention filter'}
          >
            {segments.map((seg) => (
              <button
                key={seg.id}
                type="button"
                aria-pressed={active === seg.id}
                className={active === seg.id ? 'active' : ''}
                onClick={() => (decisionsOnly ? chooseDecisionFilter(seg.id) : setState(seg.id))}
              >
                {seg.label}
                {'count' in seg && <span className="count-badge">{seg.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      {query.loading && (
        <p className="decision-status" role="status">
          <LoaderCircle size={15} className="spin" />
          Loading authorized attention…
        </p>
      )}
      {query.error && (
        <div className="decision-error">
          <ErrorMessage error={query.error.message} />
          <button className="button button-secondary" onClick={() => void query.retry()}>
            <RefreshCw size={14} />
            Retry attention
          </button>
        </div>
      )}
      {query.ready && shown.length === 0 && (
        <div className="decision-empty">
          <span className="decision-empty-icon">
            <CheckCheck size={18} />
          </span>
          <div>
            <strong>
              {query.items.length > 0
                ? 'Nothing in this filter'
                : decisionsOnly
                  ? 'No decisions are waiting on you'
                  : 'No current actions in this view.'}
            </strong>
            <span>
              {query.items.length > 0
                ? 'Choose another filter to see the rest of your decisions.'
                : decisionsOnly
                  ? 'Reviews, approvals and intake you can decide will appear here.'
                  : 'Items that need your action will appear here as they arrive.'}
            </span>
          </div>
        </div>
      )}
      {shown.length > 0 && (
        <ul className="decision-list">
          {shown.map((item) => {
            const kind = kindLabels[item.kind] ?? item.kind.replaceAll('_', ' ');
            return (
              <li className="decision-row" key={item.id}>
                <span className={`pill pill-${kindTone(item.kind)} decision-kind`}>{kind}</span>
                <div className="decision-main">
                  <h3>{item.title}</h3>
                  {item.summary && <p>{item.summary}</p>}
                  <div className="decision-meta">
                    {item.ownerName && <span>Owner: {item.ownerName}</span>}
                    {item.dueAt && (
                      <span className={new Date(item.dueAt).getTime() < now ? 'decision-late' : ''}>
                        <Clock3 size={12} />
                        Due {formatInstant(item.dueAt, zone, false)}
                      </span>
                    )}
                    {item.snoozedUntil && (
                      <span className="decision-snoozed">
                        <BellOff size={12} />
                        Snoozed until {formatInstant(item.snoozedUntil, zone, true)}
                      </span>
                    )}
                    {item.state !== 'open' && (
                      <span className="pill pill-green">
                        {item.state === 'routed' ? 'Routed in Inbox' : 'Resolved in Inbox'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="decision-actions">
                  <button
                    className={cx(
                      'button button-small',
                      item.canDecide ? 'button-primary' : 'button-secondary',
                    )}
                    onClick={() => {
                      if (item.sourceKind === 'task') onTask(item.sourceId);
                      else if (item.sourceKind === 'expense') onExpense(item.sourceId);
                      else if (item.sourceKind === 'intake' || item.sourceKind === 'record')
                        setBusiness(item.id);
                      else window.location.hash = item.link;
                    }}
                  >
                    {item.canDecide ? 'Open business decision' : 'Open source'}
                    <ArrowRight size={13} />
                  </button>
                  {!decisionsOnly && item.state === 'open' && (
                    <>
                      <button
                        className="button button-secondary button-small"
                        onClick={() => setSelected({ id: item.id, action: 'resolve' })}
                      >
                        <Check size={13} />
                        Resolve Inbox item
                      </button>
                      <button
                        className="button button-secondary button-small"
                        onClick={() =>
                          setSelected({
                            id: item.id,
                            action: item.snoozedUntil ? 'unsnooze' : 'snooze',
                          })
                        }
                      >
                        {item.snoozedUntil ? <Bell size={13} /> : <BellOff size={13} />}
                        {item.snoozedUntil ? 'Unsnooze' : 'Snooze'}
                      </button>
                      {item.canRoute && (
                        <button
                          className="button button-secondary button-small"
                          onClick={() => setSelected({ id: item.id, action: 'route' })}
                        >
                          <Forward size={13} />
                          Route Inbox item
                        </button>
                      )}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
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
      description={
        action === 'resolve'
          ? 'Resolve this Inbox item; this does not approve the work.'
          : action === 'route'
            ? 'Route this Inbox item to a colleague; this does not approve the work.'
            : 'Snooze changes Inbox timing only; this does not approve the work.'
      }
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="entity-form decision-action">
        <ErrorMessage error={error} />
        {!source && !error && (
          <p className="decision-status" role="status">
            <LoaderCircle size={15} className="spin" />
            Checking current source access…
          </p>
        )}
        {source && (
          <>
            <div className="decision-source">
              <span>Inbox item</span>
              <strong>{source.title}</strong>
            </div>
            {['resolve', 'route'].includes(action) && (
              <Field label={action === 'resolve' ? 'Resolution reason' : 'Routing reason'}>
                <textarea
                  aria-label={action === 'resolve' ? 'Resolution reason' : 'Routing reason'}
                  value={reason}
                  maxLength={4000}
                  rows={3}
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
                <div className="decision-snooze-row">
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
                    type="button"
                    className="button button-secondary"
                    disabled={reviewed || busy}
                    onClick={() => {
                      const at = new Date(Date.now() + 60 * 60 * 1000).toISOString();
                      setLocal(localDeadline(at, zone));
                      setInstant(at);
                    }}
                  >
                    <Clock3 size={14} />
                    In one hour
                  </button>
                </div>
                {candidates.length === 0 && local && (
                  <p className="inline-error" role="alert">
                    This local time does not exist. Choose another time.
                  </p>
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
            {reviewed && (
              <p className="decision-confirm">
                Confirm {label}
                {recipient ? ' to ' + source.routePeople.find((p) => p.id === recipient)?.name : ''}
                {snooze && action === 'snooze' ? ' until ' + snooze : ''}.
              </p>
            )}
            <div className="form-actions">
              {reviewed ? (
                <>
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
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
