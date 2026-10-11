import PeopleProjection from './PeopleProjection';
import { onboardingTaskReview } from '../../../shared/people/taskReview';
import { useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionInput } from '../data/executionInput';
import { businessAttemptGeneration } from '../data/businessAttempts';
import {
  usePeopleEditorBasis,
  usePeopleRead,
  usePeopleMutation,
  emptyOnboarding,
  onboardingStages,
  privateInviteCopy,
  type PeopleContext,
  type PeoplePreset,
  type OnboardingPreview,
  type PeopleResult,
} from '../data/people';
import type { TaskTemplateView, ExecutionProject } from '../../../shared/business/types';
import { Modal, Field, ErrorMessage } from './UI';
import MembershipFields from './PeopleMembershipFields';
import SessionEffect from './SessionEffect';
export default function PeopleOnboarding({ onClose }: { onClose: () => void }) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>('/people/context');
  const presets = usePeopleRead<{ items: PeoplePreset[] }>('/people/presets');
  const templates = usePeopleRead<{ templates: TaskTemplateView[] }>('/task-templates');
  const projects = usePeopleRead<{ projects: ExecutionProject[] }>('/projects');
  const [draft, setDraft, , retire] = useExecutionInput(
    '$people-onboard',
    'intent',
    emptyOnboarding,
  );
  const [stage, setStage] = useState(0);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const previewAction = usePeopleMutation('$people-onboard-preview');
  const action = usePeopleMutation(
    '$people-onboard-apply',
    draft.tasks.flatMap((t) => [
      '/task-templates/' + t.templateId,
      ...(t.projectId ? ['/projects/' + t.projectId] : []),
    ]),
  );
  const [preview, setPreview] = useState<{ basis: string; value: OnboardingPreview }>();
  const [done, setDone] = useState<{ generation: number; value: PeopleResult }>();
  const basis = usePeopleEditorBasis(w.data?.readBasis);
  const presented = preview?.basis === basis ? preview.value : undefined;
  const currentPreview = context.ready ? presented : undefined;
  const unknown = action.attempt?.state === 'unknown';
  const result =
    done?.generation === businessAttemptGeneration() && context.ready ? done.value : undefined;
  const passwordScope =
    businessAttemptGeneration() + ':' + basis + ':' + w.companyId + ':' + w.session?.user.id;
  const [capturedPasswordScope, setCapturedPasswordScope] = useState(passwordScope);
  if (capturedPasswordScope !== passwordScope) {
    setCapturedPasswordScope(passwordScope);
    setPassword('');
    setPreview(undefined);
  }
  const ready = context.ready && !action.busy && !w.authorizing;
  const change = () => {
    setPreview(undefined);
    setError('');
  };
  async function inspect() {
    if (!ready) return;
    setError('');
    previewAction.abandon();
    try {
      const p = await previewAction.execute<OnboardingPreview>(
        '/people/onboarding/preview',
        draft as unknown as Record<string, unknown>,
      );
      setPreview({ basis, value: p });
      setStage(3);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function apply() {
    if (!ready) return;
    const payload =
      action.attempt?.payload ??
      (currentPreview
        ? {
            previewId: currentPreview.id,
            expectedPreviewVersion: currentPreview.version,
            ...(currentPreview.accountMode === 'new_account' ? { password } : {}),
          }
        : undefined);
    if (!payload) return;
    try {
      const promise = action.execute<PeopleResult>(
        '/people/onboarding/apply',
        payload,
        'POST',
        (r) => {
          setPassword('');
          retire(draft);
          setDone({ generation: businessAttemptGeneration(), value: r });
          setStage(4);
        },
      );
      setPassword('');
      await promise;
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add person"
      description="Review company access and starting work before applying."
    >
      <div className="entity-form people-form">
        <ol aria-label="Onboarding stages">
          {onboardingStages.map((s, i) => (
            <li key={s} aria-current={stage === i ? 'step' : undefined}>
              {s}
            </li>
          ))}
        </ol>
        <div
          aria-hidden={context.ready}
          style={{ visibility: context.ready ? 'hidden' : 'visible' }}
        >
          <p role="status">Checking current company access…</p>
        </div>
        <ErrorMessage error={error || action.error || previewAction.error} />
        {unknown ? (
          <section>
            <h3>Submitted request</h3>
            <p>
              The result is unknown. Your original preview, password and action key remain frozen in
              this session.
            </p>
            <Field label="Submitted preview version">
              <input
                readOnly
                value={String(action.attempt?.payload.expectedPreviewVersion ?? '')}
              />
            </Field>
            <button
              className="button button-primary"
              disabled={!ready}
              onClick={() => void apply()}
            >
              Retry the same submission
            </button>
            <button
              className="button button-secondary"
              disabled={!ready}
              onClick={() => {
                if (
                  window.confirm(
                    'The original submission may already have succeeded. Inspect current People records before discarding this recovery request.',
                  )
                ) {
                  action.abandon();
                  setStage(0);
                  setPreview(undefined);
                }
              }}
            >
              Discard after inspecting current records
            </button>
          </section>
        ) : stage === 4 ? (
          <section>
            <h3>Done</h3>
            {result && (
              <>
                <p>Company onboarding completed.</p>
                <SessionEffect effect={result.sessionEffect} />
                <button className="button" onClick={onClose}>
                  Open current People
                </button>
              </>
            )}
          </section>
        ) : (
          <>
            <div hidden={stage !== 0}>
              <Field label="Name">
                <input
                  value={draft.name}
                  maxLength={120}
                  onChange={(e) => {
                    change();
                    setDraft({ ...draft, name: e.target.value });
                  }}
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={draft.email}
                  maxLength={254}
                  onChange={(e) => {
                    change();
                    setDraft({ ...draft, email: e.target.value });
                  }}
                />
              </Field>
              <button
                className="button button-primary"
                disabled={!ready || !draft.name.trim() || !draft.email.includes('@')}
                onClick={() => setStage(1)}
              >
                Continue to access
              </button>
            </div>
            <div hidden={stage !== 1}>
              {
                <>
                  <Field label="Onboarding preset">
                    <select
                      value={draft.presetId ?? ''}
                      onChange={(e) => {
                        change();
                        const p = presets.data?.items.find((p) => p.id === e.target.value);
                        setDraft({
                          ...draft,
                          presetId: p?.id,
                          expectedPresetVersion: p?.version,
                          membership: p?.membership ?? draft.membership,
                          tasks: p
                            ? p.templateIds.map((id) => ({
                                templateId: id,
                                expectedTemplateVersion:
                                  templates.data?.templates.find((t) => t.id === id)?.version ?? 0,
                                anchorDate: '',
                                fields: {},
                              }))
                            : draft.tasks,
                        });
                      }}
                    >
                      <option value="">Manual access choices</option>
                      {presets.data?.items
                        .filter((p) => !p.archived)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <MembershipFields
                    value={draft.membership}
                    context={context.data}
                    disabled={!ready}
                    onChange={(membership) => {
                      change();
                      setDraft({ ...draft, membership });
                    }}
                  />
                </>
              }
              <p>{privateInviteCopy}</p>
              <button className="button" onClick={() => setStage(0)}>
                Back
              </button>
              <button
                className="button button-primary"
                disabled={
                  !ready ||
                  !Number.isFinite(draft.membership.capacityHours) ||
                  draft.membership.capacityHours < 0 ||
                  draft.membership.capacityHours > 168
                }
                onClick={() => setStage(2)}
              >
                Continue to starting work
              </button>
            </div>
            <div hidden={stage !== 2}>
              <h3>Optional starting tasks</h3>
              <p>Choose optional task templates and review every assignment and date.</p>
              {templates.ready &&
                templates.data?.templates
                  .filter((t) => t.kind === 'task' && !t.archived)
                  .map((t) => (
                    <label key={t.id}>
                      <input
                        type="checkbox"
                        checked={draft.tasks.some((x) => x.templateId === t.id)}
                        onChange={(e) => {
                          change();
                          setDraft({
                            ...draft,
                            tasks: e.target.checked
                              ? [
                                  ...draft.tasks,
                                  {
                                    templateId: t.id,
                                    expectedTemplateVersion: t.version,
                                    anchorDate: '',
                                    fields: {},
                                  },
                                ]
                              : draft.tasks.filter((x) => x.templateId !== t.id),
                          });
                        }}
                      />
                      {t.name}
                    </label>
                  ))}
              {draft.tasks.map((task, index) => {
                const template = templates.data?.templates.find((t) => t.id === task.templateId);
                const update = (patch: Partial<typeof task>) => {
                  change();
                  setDraft({
                    ...draft,
                    tasks: draft.tasks.map((x, i) => (i === index ? { ...x, ...patch } : x)),
                  });
                };
                return (
                  <fieldset key={task.templateId}>
                    <legend>
                      {templates.ready
                        ? (template?.name ?? 'Choose a current replacement')
                        : 'Checking template access…'}
                    </legend>
                    <Field label={'Anchor date ' + (index + 1)}>
                      <input
                        type="date"
                        value={task.anchorDate}
                        onChange={(e) => update({ anchorDate: e.target.value })}
                      />
                    </Field>
                    <Field label={'Project ' + (index + 1)}>
                      <select
                        value={task.projectId ?? ''}
                        onChange={(e) => {
                          const p = projects.data?.projects.find((p) => p.id === e.target.value);
                          update({ projectId: p?.id, expectedProjectVersion: p?.version });
                        }}
                      >
                        <option value="">No project</option>
                        {projects.data?.projects.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {(['ownerId', 'reviewerId'] as const).map((field) => (
                      <Field
                        key={field}
                        label={
                          (field === 'ownerId' ? 'Owner ' : 'Independent reviewer ') + (index + 1)
                        }
                      >
                        <select
                          value={String(task.fields[field] ?? '')}
                          onChange={(e) =>
                            update({ fields: { ...task.fields, [field]: e.target.value } })
                          }
                        >
                          <option value="">Use reviewed template default</option>
                          {context.data?.people
                            .filter(
                              (p) => p.active && (field !== 'reviewerId' || p.role !== 'viewer'),
                            )
                            .map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    ))}
                    <button
                      className="button"
                      onClick={() =>
                        setDraft({ ...draft, tasks: draft.tasks.filter((_, i) => i !== index) })
                      }
                    >
                      Remove optional task
                    </button>
                  </fieldset>
                );
              })}
              <button className="button" onClick={() => setStage(1)}>
                Back
              </button>
              <button
                className="button button-primary"
                disabled={
                  !ready ||
                  previewAction.busy ||
                  draft.tasks.some((t) => !t.anchorDate || t.expectedTemplateVersion < 1)
                }
                onClick={() => void inspect()}
              >
                Review onboarding
              </button>
            </div>
            <div hidden={stage !== 3}>
              {presented ? (
                <>
                  <PeopleProjection current={!!currentPreview}>
                    <h3>Review exact access</h3>
                    <p>
                      {presented.person.name} · {presented.person.email}
                    </p>
                    {presented.grants.map((g) => (
                      <p key={g.area}>{g.summary}</p>
                    ))}
                    {presented.taskPreviews.map((t, i) => (
                      <section key={i}>
                        <h4>{String(t.fields.title ?? 'Starting task')}</h4>
                        <p>
                          Template version {t.templateVersion} ·{' '}
                          {String(t.fields.dueDate ?? 'No deadline')}
                        </p>
                        {onboardingTaskReview(t, context.data, projects.data?.projects).map(
                          (line, j) => (
                            <p key={j}>{line}</p>
                          ),
                        )}
                      </section>
                    ))}
                    {presented.unresolved.map((u, i) => (
                      <p role="alert" key={i}>
                        {u.message}
                      </p>
                    ))}
                    <SessionEffect effect={presented.sessionEffect} />
                  </PeopleProjection>
                  {presented.accountMode === 'new_account' ? (
                    <Field
                      label="New account password"
                      hint="At least 12 characters; only the submitted request retains it while its result is unknown."
                    >
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                      />
                    </Field>
                  ) : (
                    <p>The existing account name, password and account settings are preserved.</p>
                  )}
                  <button
                    className="button button-primary"
                    disabled={
                      !ready ||
                      presented.unresolved.length > 0 ||
                      (presented.accountMode === 'new_account' && Array.from(password).length < 12)
                    }
                    onClick={() => void apply()}
                  >
                    Confirm onboarding
                  </button>
                </>
              ) : (
                <p>Review choices again to capture current access and source versions.</p>
              )}
              <button
                className="button"
                disabled={action.busy}
                onClick={() => {
                  setStage(2);
                  setPassword('');
                  setPreview(undefined);
                }}
              >
                Edit reviewed choices
              </button>
              <button className="button" disabled={!ready} onClick={() => void inspect()}>
                Create fresh preview
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
