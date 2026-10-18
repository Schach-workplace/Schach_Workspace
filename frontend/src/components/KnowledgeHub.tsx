import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { executionRead, useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput } from '../data/executionInput';
import { Modal, downloadText } from './UI';
import {
  knowledgeDraft,
  knowledgeSubmission,
  knowledgeMarkdown,
} from '../../../shared/knowledge/drafts';
import type {
  KnowledgeArticle,
  KnowledgeFields,
  KnowledgeDetail,
  KnowledgeList,
  KnowledgeAnswer,
  KnowledgeMutationResult,
} from '../../../shared/knowledge/types';
import '../styles/knowledge.css';
export default function KnowledgeHub() {
  const w = useWorkspace();
  return <Home key={[w.companyId, w.session?.user.id, w.data?.readBasis].join(':')} />;
}
function Home() {
  const w = useWorkspace();
  const [query, setQuery] = useState(''),
    [pilot, setPilot] = useState('all'),
    [id, setId] = useState(''),
    [creating, setCreating] = useState(false),
    [sources, setSources] = useState<string[]>([]),
    [question, setQuestion] = useState(''),
    [asked, setAsked] = useState<{ articleIds: string[]; question: string }>();
  const list = useExecutionRead<KnowledgeList>(
      '/knowledge?query=' + encodeURIComponent(query) + '&pilot=' + pilot,
    ),
    answer = useExecutionRead<KnowledgeAnswer>('/knowledge/answers', !!asked, asked);
  const refresh = useEffectEvent(() => {
    setAsked(undefined);
    list.retry();
  });
  useEffect(() => {
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, []);
  function change() {
    setSources([]);
    setAsked(undefined);
  }
  return (
    <div className="knowledge-hub">
      <header className="knowledge-heading">
        <div>
          <span className="eyebrow">Shared practice</span>
          <h2>Knowledge library</h2>
          <p>Reviewed guidance for the moments that matter.</p>
        </div>
        {w.data?.me.role !== 'viewer' && list.ready && (
          <button className="button button-primary" onClick={() => setCreating(true)}>
            New guidance
          </button>
        )}
      </header>
      <aside className="knowledge-notice">
        Drafts are private to their owner and independent reviewer. Publication requires review and
        an explicit audience. Leadership grants no extra access. Guidance does not approve actions.
      </aside>
      {id ? (
        <Detail
          id={id}
          onBack={() => {
            setId('');
            list.retry();
          }}
        />
      ) : (
        <>
          <div className="knowledge-filters">
            <label>
              Search guidance
              <input
                type="search"
                maxLength={160}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  change();
                }}
              />
            </label>
            <label>
              Pilot
              <select
                value={pilot}
                onChange={(e) => {
                  setPilot(e.target.value);
                  change();
                }}
              >
                {['all', 'engineering', 'office', 'field'].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary"
              onClick={() => {
                change();
                list.retry();
              }}
            >
              Refresh library
            </button>
          </div>
          {list.error && <p role="alert">{list.error.message}</p>}
          {!list.ready && !list.error && <p role="status">Checking current guidance access…</p>}
          <div className="knowledge-grid">
            {list.ready &&
              list.data?.articles.map((a) => (
                <article className="knowledge-card" key={a.id}>
                  <span className="eyebrow">
                    {a.pilot} · {a.state}
                  </span>
                  <h3>
                    <button className="knowledge-title" onClick={() => setId(a.id)}>
                      {a.title}
                    </button>
                  </h3>
                  <p>{a.body.slice(0, 180)}</p>
                  <small>
                    Version {a.version} · Review due {a.reviewDueDate}
                  </small>
                  {a.state === 'published' && (
                    <label className="knowledge-check">
                      <input
                        type="checkbox"
                        aria-label={'Use ' + a.title + ' as a source'}
                        checked={sources.includes(a.id)}
                        disabled={!sources.includes(a.id) && sources.length >= 8}
                        onChange={() => {
                          setSources((s) =>
                            s.includes(a.id) ? s.filter((i) => i !== a.id) : [...s, a.id],
                          );
                          setAsked(undefined);
                        }}
                      />
                      Use as a source
                    </label>
                  )}
                </article>
              ))}
          </div>
          {list.ready && !list.data?.articles.length && (
            <div className="knowledge-card">
              <h3>No guidance found</h3>
              <p>Try another search or create a draft for independent review.</p>
            </div>
          )}
          {list.ready && (
            <section className="knowledge-card knowledge-answer">
              <h3>Find a cited passage</h3>
              <p>
                Choose up to 8 published sources. Deterministic text matching returns current
                authorized passages, or abstains. This is not semantic AI advice.
              </p>
              <label>
                Question
                <textarea
                  value={question}
                  onChange={(e) => {
                    setQuestion(e.target.value);
                    setAsked(undefined);
                  }}
                  maxLength={1000}
                />
              </label>
              <button
                className="button button-primary"
                disabled={!sources.length || !question.trim()}
                onClick={() => setAsked({ articleIds: sources, question })}
              >
                Find cited passages
              </button>
              {asked && answer.ready && answer.data && (
                <div aria-live="polite">
                  <p>{answer.data.answer}</p>
                  {answer.data.reason && <p>{answer.data.reason}</p>}
                  {answer.data.citations.map((c) => (
                    <blockquote key={c.id}>
                      <p>{c.excerpt}</p>
                      <cite>
                        {c.title} · version {c.version}
                      </cite>
                    </blockquote>
                  ))}
                </div>
              )}
              {asked && !answer.ready && !answer.error && (
                <p role="status">Checking current selected sources…</p>
              )}
              {asked && answer.error && <p role="alert">{answer.error.message}</p>}
            </section>
          )}
        </>
      )}
      {creating && list.ready && (
        <Editor
          onClose={() => setCreating(false)}
          onSaved={(saved) => {
            setCreating(false);
            setId(saved);
            list.retry();
          }}
        />
      )}
    </div>
  );
}
function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const q = useExecutionRead<KnowledgeDetail>('/knowledge/' + id);
  const [editing, setEditing] = useState(false),
    [reviewing, setReviewing] = useState(false),
    [exporting, setExporting] = useState(false);
  const refresh = useEffectEvent(() => q.retry());
  useEffect(() => {
    const t = setInterval(() => refresh(), 15000);
    return () => clearInterval(t);
  }, []);
  const d = q.ready ? q.data : undefined;
  return (
    <section>
      <button className="text-button" onClick={onBack}>
        ← Knowledge library
      </button>
      {!d ? (
        <p role="status">{q.error?.message || 'Checking current guidance access…'}</p>
      ) : (
        <>
          <header className="knowledge-heading">
            <div>
              <span className="eyebrow">
                {d.article.pilot} · {d.article.state} · version {d.article.version}
              </span>
              <h2>{d.article.title}</h2>
              <p>Review due {d.article.reviewDueDate}</p>
            </div>
            <div className="knowledge-actions">
              {d.canEdit && (
                <button className="button button-secondary" onClick={() => setEditing(true)}>
                  Edit guidance
                </button>
              )}
              {d.canReview && (
                <button className="button button-primary" onClick={() => setReviewing(true)}>
                  Review publication
                </button>
              )}
              <button className="button button-secondary" onClick={() => setExporting(true)}>
                Download reviewed copy
              </button>
            </div>
          </header>
          <article className="knowledge-card knowledge-prose">{d.article.body}</article>
          <p>
            Publication audience:{' '}
            {d.article.audience === 'company' ? 'Company' : d.article.readerIds.join(', ')}. Draft
            access is limited to owner and reviewer.
          </p>
          {d.reviews.map((r) => (
            <article className="knowledge-card" key={r.id}>
              <strong>
                {r.decision} · version {r.articleVersion}
              </strong>
              <p className="knowledge-prose">{r.reason}</p>
            </article>
          ))}
          {editing && d.canEdit && (
            <Editor
              article={d.article}
              onClose={() => setEditing(false)}
              onSaved={() => {
                setEditing(false);
                q.retry();
              }}
            />
          )}
          {reviewing && d.canReview && (
            <Review
              article={d.article}
              onClose={() => setReviewing(false)}
              onSaved={() => {
                setReviewing(false);
                q.retry();
              }}
            />
          )}
          {exporting && (
            <Export
              article={d.article}
              onClose={() => setExporting(false)}
              onRefresh={() => {
                setExporting(false);
                q.retry();
              }}
            />
          )}
        </>
      )}
    </section>
  );
}
function Editor({
  article: initialArticle,
  onClose,
  onSaved,
}: {
  article?: KnowledgeArticle;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const w = useWorkspace(),
    form = '$knowledge:' + (initialArticle?.id ?? 'new') + ':edit',
    action = useExecutionMutation(form, initialArticle ? ['/knowledge/' + initialArticle.id] : []);
  const [authored, setAuthored, _prefill, retireAuthored] = useExecutionInput<{
    source: KnowledgeArticle | undefined;
    fields: KnowledgeFields;
  }>(form, 'boundDraft', () => ({
    source: initialArticle,
    fields: knowledgeDraft(initialArticle),
  }));
  const { source: article, fields: draft } = authored;
  const setDraft = (update: (fields: KnowledgeFields) => KnowledgeFields) =>
    setAuthored((d) => ({ ...d, fields: update(d.fields) }));
  const [confirmed, setConfirmed] = useState(false);
  const shown = knowledgeSubmission(draft, action.attempt),
    locked = action.busy || !!action.attempt;
  function set<K extends keyof KnowledgeFields>(key: K, value: KnowledgeFields[K]) {
    setConfirmed(false);
    setDraft((d) => ({ ...d, [key]: value }));
  }
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      const r = await action.execute<KnowledgeMutationResult>(
        '/knowledge' + (article ? '/' + article.id : ''),
        action.attempt?.payload ?? {
          ...draft,
          state: draft.state === 'archived' ? 'archived' : 'draft',
          ...(article ? { expectedVersion: article.version } : {}),
        },
        article ? 'PATCH' : 'POST',
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved(r.id);
    } catch {
      /* hook displays server error */
    }
  }
  return (
    <Modal
      open
      title={article ? 'Edit guidance' : 'New guidance'}
      onClose={() => {
        if (!action.busy) onClose();
      }}
      wide
    >
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label>
          Pilot
          <select
            value={shown.pilot}
            disabled={locked}
            onChange={(e) => set('pilot', e.target.value as KnowledgeFields['pilot'])}
          >
            {['engineering', 'office', 'field', 'all'].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <label>
          Title
          <input
            maxLength={160}
            value={shown.title}
            disabled={locked}
            onChange={(e) => set('title', e.target.value)}
          />
        </label>
        <label>
          Guidance
          <textarea
            rows={9}
            maxLength={16000}
            value={shown.body}
            disabled={locked}
            onChange={(e) => set('body', e.target.value)}
          />
        </label>
        <label>
          Independent reviewer
          <select
            value={shown.reviewerId}
            disabled={locked}
            onChange={(e) => set('reviewerId', e.target.value)}
          >
            <option value="">Select reviewer</option>
            {w.data?.people
              .filter((p) => p.active && p.role !== 'viewer' && p.id !== w.session?.user.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Publication audience
          <select
            value={shown.audience}
            disabled={locked}
            onChange={(e) => set('audience', e.target.value as 'company' | 'selected')}
          >
            <option value="selected">Selected readers</option>
            <option value="company">Company</option>
          </select>
        </label>
        {shown.audience === 'selected' && (
          <fieldset disabled={locked}>
            <legend>Readers after publication</legend>
            {w.data?.people
              .filter((p) => p.active)
              .map((p) => (
                <label className="knowledge-check" key={p.id}>
                  <input
                    type="checkbox"
                    checked={shown.readerIds.includes(p.id)}
                    onChange={() =>
                      set(
                        'readerIds',
                        shown.readerIds.includes(p.id)
                          ? shown.readerIds.filter((i) => i !== p.id)
                          : [...shown.readerIds, p.id],
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
          </fieldset>
        )}
        <label>
          Review due date
          <input
            type="date"
            value={shown.reviewDueDate}
            disabled={locked}
            onChange={(e) => set('reviewDueDate', e.target.value)}
          />
        </label>
        {article && (
          <label>
            Save state
            <select
              disabled={locked}
              value={shown.state}
              onChange={(e) => set('state', e.target.value as 'draft' | 'archived')}
            >
              <option value="draft">Draft</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        )}
        <aside className="knowledge-notice">
          Saving creates a draft visible only to you and your reviewer. Publication audience:{' '}
          {shown.audience === 'company'
            ? 'Company'
            : shown.readerIds
                .map((i) => w.data?.people.find((p) => p.id === i)?.name ?? i)
                .join(', ') || 'No readers selected'}
          . An independent reviewer must approve publication.
        </aside>
        {!action.attempt && (
          <label className="knowledge-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the guidance and publication audience
          </label>
        )}
        {action.attempt && (
          <p role="status">
            Result unknown. The original guidance, audience and retry identity are frozen.
          </p>
        )}
        {action.error && <p role="alert">{action.error}</p>}
        <button
          className="button button-primary"
          disabled={action.busy || (!confirmed && !action.attempt)}
        >
          {action.attempt ? 'Retry original guidance' : 'Save draft'}
        </button>
        {action.attempt && (
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => {
              action.abandon();
              retireAuthored(authored);
              setConfirmed(false);
            }}
          >
            Discard attempt and review latest
          </button>
        )}
      </form>
    </Modal>
  );
}
function Review({
  article: initialArticle,
  onClose,
  onSaved,
}: {
  article: KnowledgeArticle;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = '$knowledge:' + initialArticle.id + ':review';
  const action = useExecutionMutation(form, ['/knowledge/' + initialArticle.id]);
  const [authored, setAuthored, _prefill, retireAuthored] = useExecutionInput(
    form,
    'boundDraft',
    () => ({
      source: initialArticle,
      fields: { decision: 'return', reason: '' },
    }),
  );
  const { source: article, fields: draft } = authored;
  const setDraft = (update: (fields: typeof draft) => typeof draft) =>
    setAuthored((d) => ({ ...d, fields: update(d.fields) }));
  const shown = (action.attempt?.payload as typeof draft | undefined) ?? draft,
    locked = action.busy || !!action.attempt;
  const [confirmed, setConfirmed] = useState(false);
  async function save() {
    if (!confirmed && !action.attempt) return;
    try {
      setAuthored(authored);
      await action.execute(
        '/knowledge/' + article.id + '/review',
        action.attempt?.payload ?? { ...draft, expectedVersion: article.version },
        'POST',
        () => retireAuthored(authored),
      );
      retireAuthored(authored);
      onSaved();
    } catch {}
  }
  return (
    <Modal
      open
      title="Independent publication review"
      onClose={() => {
        if (!action.busy) onClose();
      }}
    >
      <form
        className="knowledge-form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h3>
          {article.title} · version {article.version}
        </h3>
        <p>
          Publication audience:{' '}
          {article.audience === 'company' ? 'Company' : article.readerIds.join(', ')}
        </p>
        <p className="knowledge-prose">{article.body}</p>
        <label>
          Decision
          <select
            disabled={locked}
            value={shown.decision}
            onChange={(e) => {
              setConfirmed(false);
              setDraft((d) => ({ ...d, decision: e.target.value }));
            }}
          >
            <option value="return">Return to author</option>
            <option value="publish">Publish to reviewed audience</option>
          </select>
        </label>
        <label>
          Review reason
          <textarea
            disabled={locked}
            value={shown.reason}
            onChange={(e) => {
              setConfirmed(false);
              setDraft((d) => ({ ...d, reason: e.target.value }));
            }}
          />
        </label>
        {!action.attempt && (
          <label className="knowledge-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I reviewed the title, guidance and publication audience
          </label>
        )}
        {action.attempt && <p>Original review and audience are frozen for retry.</p>}
        {action.error && <p role="alert">{action.error}</p>}
        <button
          className="button button-primary"
          disabled={
            action.busy || (!confirmed && !action.attempt) || shown.reason.trim().length < 10
          }
        >
          {action.attempt ? 'Retry original review' : 'Submit independent review'}
        </button>
        {action.attempt && (
          <button
            type="button"
            onClick={() => {
              action.abandon();
              retireAuthored(authored);
              setConfirmed(false);
            }}
          >
            Discard attempt and review latest
          </button>
        )}
      </form>
    </Modal>
  );
}
function Export({
  article: initialArticle,
  onClose,
  onRefresh,
}: {
  article: KnowledgeArticle;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [article] = useState(initialArticle);
  const w = useWorkspace();
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    generation = useRef(0);
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        generation.current++;
        setConsent(false);
        setError('Access changed. Refresh guidance before downloading.');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      generation.current++;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  async function download() {
    setBusy(true);
    const g = generation.current;
    try {
      const current = await executionRead<KnowledgeDetail>(
        w.mode,
        w.companyId!,
        w.session?.user.id ?? w.data!.me.id,
        '/knowledge/' + article.id,
      );
      if (!alive.current || g !== generation.current || document.visibilityState === 'hidden')
        return;
      if (current.article.id !== article.id || current.article.version !== article.version) {
        setConsent(false);
        setError('Guidance changed. Refresh and review the latest copy.');
        return;
      }
      downloadText(
        'workspace-guidance.md',
        knowledgeMarkdown(current.article),
        'text/markdown;charset=utf-8',
      );
      onClose();
    } catch {
      if (alive.current) {
        setConsent(false);
        setError('Current access could not be confirmed. Refresh guidance before downloading.');
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal open title="Review guidance download" onClose={onClose}>
      <div className="knowledge-form">
        <h3>{article.title}</h3>
        <p>
          Version {article.version} · {article.state} · Review due {article.reviewDueDate}
        </p>
        <p>
          Publication audience:{' '}
          {article.audience === 'company' ? 'Company' : article.readerIds.join(', ')}
        </p>
        <p className="knowledge-prose">{article.body}</p>
        <aside className="knowledge-notice">
          This download is an independent external copy. Workspace access changes and expiry cannot
          revoke it. Review who will receive this file before sharing.
        </aside>
        <label className="knowledge-check">
          <input
            type="checkbox"
            checked={consent}
            disabled={busy || !!error}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I reviewed this external copy and its audience
        </label>
        {error && <p role="alert">{error}</p>}
        <button
          className="button button-primary"
          disabled={!consent || busy || !!error}
          onClick={() => void download()}
        >
          Download Markdown
        </button>
        {error && (
          <button className="button button-secondary" onClick={onRefresh}>
            Refresh guidance
          </button>
        )}
      </div>
    </Modal>
  );
}
