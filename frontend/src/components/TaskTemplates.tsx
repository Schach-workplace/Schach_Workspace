import ExecutionRecovery from './ExecutionRecovery';
import { useExecutionInput, clearExecutionForm } from '../data/executionInput';
import { clearAttemptScope } from '../data/businessAttempts';
import { useEffect, useState } from 'react';
import { useWorkspace } from '../store';
import {
  executionRead,
  useExecutionRead,
  useExecutionMutation,
  type TaskTemplateView,
  type TemplatePreview,
} from '../data/execution';
import type { Task } from '../types';
import { Field, ErrorMessage, today } from './UI';
export default function TaskTemplates({
  task,
  initialProject = '',
  onCreated,
}: {
  task?: Task;
  initialProject?: string;
  onCreated?: (id: string) => void;
}) {
  const store = useWorkspace();
  const data = store.data!;
  const kind = task ? 'checklist' : 'task';
  const list = useExecutionRead<{ templates: TaskTemplateView[] }>(`/task-templates?kind=${kind}`);
  const [selected, setSelected] = useExecutionInput('$template-nav:' + kind, 'selected', '');
  const detail = useExecutionRead<{ template: TaskTemplateView }>(
    `/task-templates/${selected}`,
    !!selected,
  );
  const source = detail.data?.template;
  const action = useExecutionMutation(`template:${selected}:${task?.id ?? 'create'}`);
  const [managementId, setManagementId] = useExecutionInput(
    '$template-nav:' + kind,
    'managementId',
    '',
  );
  const managementForm = '$template-manage:' + (managementId || 'new-' + kind);
  const manage = useExecutionMutation('template-manage:' + (managementId || 'new-' + kind));
  const [preview, setPreview] = useState<TemplatePreview>();
  const [error, setError] = useState('');
  const [project, setProject] = useState(
    String(action.attempt?.payload.projectId ?? initialProject),
  );
  const [anchor, setAnchor] = useState(
    String(action.attempt?.payload.anchorDate ?? today(data.company.timezone)),
  );
  const [editingTemplate, setEditingTemplate] = useExecutionInput(
    '$template-nav:' + kind,
    'editing',
    false,
  );
  const [managementVersion, setManagementVersion] = useExecutionInput(
    '$template-nav:' + kind,
    'expectedBasis',
    0,
  );
  const [managing, setManaging] = useExecutionInput('$template-nav:' + kind, 'managing', false);
  const [name, setName, prefillName] = useExecutionInput(managementForm, 'name', '');
  const [scopeOwner, setScopeOwner, prefillScopeOwner] = useExecutionInput(
    managementForm,
    'scopeOwner',
    data.me.id,
  );
  const [scopeDepartment, setScopeDepartment, prefillScopeDepartment] = useExecutionInput(
    managementForm,
    'scopeDepartment',
    data.me.departmentId,
  );
  const [checklist, setChecklist, prefillChecklist] = useExecutionInput(
    managementForm,
    'checklist',
    '',
  );
  const [ownerPolicy, setOwnerPolicy, prefillOwnerPolicy] = useExecutionInput(
    managementForm,
    'ownerPolicy',
    'actor',
  );
  const [fixedOwner, setFixedOwner, prefillFixedOwner] = useExecutionInput(
    managementForm,
    'fixedOwner',
    '',
  );
  const [reviewer, setReviewer, prefillReviewer] = useExecutionInput(
    managementForm,
    'reviewer',
    '',
  );
  const [required, setRequired, prefillRequired] = useExecutionInput(
    managementForm,
    'required',
    false,
  );
  const [relative, setRelative, prefillRelative] = useExecutionInput(
    managementForm,
    'relative',
    '',
  );
  const [taskTitle, setTaskTitle, prefillTaskTitle] = useExecutionInput(
    managementForm,
    'taskTitle',
    '',
  );
  const [taskDescription, setTaskDescription, prefillTaskDescription] = useExecutionInput(
    managementForm,
    'taskDescription',
    '',
  );
  const [priority, setPriority, prefillPriority] = useExecutionInput(
    managementForm,
    'priority',
    'medium',
  );
  const [estimate, setEstimate, prefillEstimate] = useExecutionInput(
    managementForm,
    'estimate',
    '0',
  );
  const [tags, setTags, prefillTags] = useExecutionInput(managementForm, 'tags', '');
  const [initialStatus, setInitialStatus, prefillInitialStatus] = useExecutionInput(
    managementForm,
    'initialStatus',
    'todo',
  );
  const currentProject = data.projects.find((p) => p.id === project);
  const projectDetail = useExecutionRead<{ project: { version: number } }>(
    `/projects/${project}`,
    !!project,
  );
  const projectVersion = projectDetail.data?.project?.version;
  useEffect(() => {
    setPreview(undefined);
    setError('');
  }, [selected]);
  useEffect(() => {
    if (detail.denied) {
      clearAttemptScope(action.scope);
      clearAttemptScope(manage.scope);
      setPreview(undefined);
      setManaging(false);
      clearExecutionForm(store.companyId, store.session?.user.id ?? data.me.id, managementForm);
      setManagementId('');
      setSelected('');
      setName('');
      setChecklist('');
    }
  }, [detail.denied]);
  const fields =
    (action.attempt?.payload.fields as Record<string, unknown> | undefined) ?? preview?.fields;
  const persons = data.people.filter((p) => p.active);
  const change = (key: string, value: unknown) =>
    setPreview((p) => (p ? { ...p, fields: { ...p.fields, [key]: value } } : p));
  async function run(fn: () => Promise<void>) {
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function inspect() {
    if (!source) return;
    await run(async () => {
      const p = await executionRead<TemplatePreview>(
        store.mode,
        store.companyId,
        store.session?.user.id ?? data.me.id,
        `/task-templates/${source.id}/preview`,
        {
          expectedTemplateVersion: source.version,
          projectId: project,
          expectedProjectVersion: project ? projectVersion : 0,
          anchorDate: anchor,
          fields: {},
        },
      );
      setPreview(p);
    });
  }
  function prefillManagement() {
    if (source) {
      prefillName(source.name);
      prefillScopeOwner(source.scopeOwnerId);
      prefillScopeDepartment(source.scopeDepartmentId);
      prefillChecklist(source.defaults.checklist.join('\n'));
      prefillTaskTitle(source.defaults.title ?? '');
      prefillTaskDescription(source.defaults.description ?? '');
      prefillPriority(source.defaults.priority || 'medium');
      prefillEstimate(String(source.defaults.estimatedHours ?? 0));
      prefillTags((source.defaults.tags ?? []).join(', '));
      prefillInitialStatus(source.defaults.status ?? 'todo');
      prefillOwnerPolicy(source.defaults.ownerPolicy ?? 'actor');
      prefillFixedOwner(source.defaults.fixedOwnerId ?? '');
      prefillReviewer(source.defaults.reviewerId ?? '');
      prefillRequired(!!source.defaults.requiresApproval);
      prefillRelative(
        source.defaults.relativeDueDays === undefined
          ? ''
          : String(source.defaults.relativeDueDays),
      );
    }
  }
  function loadManagement() {
    if (!source || !detail.ready) return;
    setEditingTemplate(true);
    setManagementId(source.id);
    setManagementVersion(source.version);
    prefillManagement();
    setManaging(true);
  }
  useEffect(() => {
    if (managing && managementId && source?.id === managementId && detail.ready) {
      prefillManagement();
      if (!managementVersion) setManagementVersion(source.version);
    }
  }, [managing, managementId, source?.id, detail.ready]);
  const managementReady = !managementId || (detail.ready && source?.id === managementId);

  return (
    <section
      className="panel execution-panel"
      aria-label={task ? 'Reusable checklist' : 'Task templates'}
    >
      <h3>{task ? 'Reusable checklist' : 'Task templates'}</h3>
      {list.loading && <p role="status">Checking current template access…</p>}
      {list.error && (
        <>
          <ErrorMessage error={list.error.message} />
          <button className="button" onClick={() => void list.retry()}>
            Retry templates
          </button>
        </>
      )}
      <Field label="Template">
        <select
          value={selected}
          disabled={managing || !!action.attempt || !!manage.attempt}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Choose an authorized template</option>
          {list.data?.templates
            .filter((t) => !t.archived)
            .map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
        </select>
      </Field>
      {source && (
        <>
          <p>{source.description}</p>
          {!task && (
            <>
              <Field label="Template project">
                <select
                  value={project}
                  onChange={(e) => {
                    setProject(e.target.value);
                    setPreview(undefined);
                  }}
                  disabled={!!action.attempt}
                >
                  <option value="">No project</option>
                  {data.projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Company calendar anchor">
                <input
                  type="date"
                  value={anchor}
                  onChange={(e) => {
                    setAnchor(e.target.value);
                    setPreview(undefined);
                  }}
                  disabled={!!action.attempt}
                />
              </Field>
              <button
                className="button"
                disabled={action.busy || !!action.attempt || (!!project && !projectVersion)}
                onClick={() => void inspect()}
              >
                Preview template
              </button>
            </>
          )}
          {task && (
            <>
              <p>
                Append {source.defaults.checklist.length} unchecked items. Existing checks and
                required review stay intact.
              </p>
              {task.status === 'done' ? (
                <p>Use the task’s reopen workflow before appending checks.</p>
              ) : (
                <button
                  className="button button-primary"
                  disabled={action.busy}
                  onClick={() =>
                    void run(async () => {
                      await action.execute(
                        `/tasks/${task.id}/checklists/apply`,
                        action.attempt?.payload ?? {
                          version: task.version,
                          templateId: source.id,
                          expectedTemplateVersion: source.version,
                        },
                      );
                      setSelected('');
                    })
                  }
                >
                  {action.attempt ? 'Retry same checklist append' : 'Append checklist'}
                </button>
              )}
            </>
          )}
          {fields && !task && (
            <fieldset disabled={!!action.attempt || action.busy}>
              <legend>Review resolved task</legend>
              <Field label="Reviewed task title">
                <input
                  value={String(fields.title ?? '')}
                  onChange={(e) => change('title', e.target.value)}
                />
              </Field>
              <Field label="Reviewed owner">
                <select
                  value={String(fields.ownerId ?? '')}
                  onChange={(e) => change('ownerId', e.target.value)}
                >
                  <option value="">Choose an active owner</option>
                  {persons.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Reviewed independent reviewer">
                <select
                  value={String(fields.reviewerId ?? '')}
                  onChange={(e) => change('reviewerId', e.target.value)}
                >
                  <option value="">No reviewer</option>
                  {persons
                    .filter((p) => p.role !== 'viewer' && p.id !== fields.ownerId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <p>
                {fields.requiresApproval
                  ? 'Independent review is required.'
                  : 'Review is optional.'}
              </p>
              <Field label="Reviewed due date">
                <input
                  type="date"
                  value={String(fields.dueDate ?? '')}
                  onChange={(e) => change('dueDate', e.target.value)}
                />
              </Field>
              <p>{source.defaults.checklist.join(' · ')}</p>
            </fieldset>
          )}
          {fields && !task && (
            <button
              className="button button-primary"
              disabled={
                action.busy || !fields.ownerId || (!!fields.requiresApproval && !fields.reviewerId)
              }
              onClick={() =>
                void run(async () => {
                  const result = await action.execute<{ id: string }>(
                    `/task-templates/${source.id}/apply`,
                    action.attempt?.payload ?? {
                      expectedTemplateVersion: preview?.templateVersion ?? source.version,
                      projectId: project,
                      expectedProjectVersion: project
                        ? (preview?.projectVersion ?? projectVersion)
                        : 0,
                      anchorDate: anchor,
                      fields,
                    },
                  );
                  setPreview(undefined);
                  onCreated?.(result.id);
                })
              }
            >
              {action.attempt ? 'Retry same template application' : 'Create reviewed task'}
            </button>
          )}
        </>
      )}
      {data.me.role !== 'viewer' && (
        <div className="form-actions">
          <button
            className="button"
            onClick={() => {
              setEditingTemplate(false);
              setManaging(true);
              setName('');
              setChecklist('');
              setManagementId('');
              setManagementVersion(0);
              setTaskTitle('');
            }}
          >
            New {kind} template
          </button>
          {source && (
            <button className="button" onClick={loadManagement}>
              Edit template
            </button>
          )}
        </div>
      )}
      {managing && managementReady && (
        <fieldset disabled={manage.busy || !!manage.attempt}>
          <legend>Manage explicit template scope</legend>
          <Field label="Template name">
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Scope owner">
            <select value={scopeOwner} onChange={(e) => setScopeOwner(e.target.value)}>
              {persons.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scope department">
            <select value={scopeDepartment} onChange={(e) => setScopeDepartment(e.target.value)}>
              <option value="">No department</option>
              {data.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Checklist entries, one per line">
            <textarea value={checklist} onChange={(e) => setChecklist(e.target.value)} />
          </Field>
          {!task && (
            <>
              <Field label="Default task title">
                <input value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} />
              </Field>
              <Field label="Default task description">
                <textarea
                  value={taskDescription}
                  onChange={(e) => setTaskDescription(e.target.value)}
                />
              </Field>
              <Field label="Default task priority">
                <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  {['critical', 'high', 'medium', 'low'].map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Default task estimated hours">
                <input
                  type="number"
                  min="0"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                />
              </Field>
              <Field label="Default task tags, comma separated">
                <input value={tags} onChange={(e) => setTags(e.target.value)} />
              </Field>
              <Field label="Default task initial status">
                <select value={initialStatus} onChange={(e) => setInitialStatus(e.target.value)}>
                  <option value="todo">To do</option>
                  <option value="backlog">Backlog</option>
                </select>
              </Field>
              <Field label="Template owner policy">
                <select value={ownerPolicy} onChange={(e) => setOwnerPolicy(e.target.value)}>
                  {['actor', 'fixed', 'project_owner', 'project_default'].map((p) => (
                    <option key={p} value={p}>
                      {p.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </Field>
              {ownerPolicy === 'fixed' && (
                <Field label="Fixed task owner">
                  <select value={fixedOwner} onChange={(e) => setFixedOwner(e.target.value)}>
                    <option value="">Choose person</option>
                    {persons.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              <Field label="Template reviewer">
                <select value={reviewer} onChange={(e) => setReviewer(e.target.value)}>
                  <option value="">No reviewer</option>
                  {persons
                    .filter((p) => p.role !== 'viewer')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <label>
                <input
                  type="checkbox"
                  checked={required}
                  onChange={(e) => setRequired(e.target.checked)}
                />
                Require independent review
              </label>
              <Field label="Relative all-day deadline offset">
                <input
                  type="number"
                  min={-366}
                  max={366}
                  value={relative}
                  onChange={(e) => setRelative(e.target.value)}
                />
              </Field>
            </>
          )}
        </fieldset>
      )}
      {managing && !managementReady && (
        <p role="status">Checking current template access. Editing resumes after authorization.</p>
      )}
      {managing && (
        <div className="form-actions">
          <button className="button" onClick={() => setManaging(false)}>
            Cancel template editing
          </button>
          <button
            className="button button-primary"
            disabled={
              !managementReady ||
              manage.busy ||
              (!manage.attempt && (!name || (!task && !taskTitle)))
            }
            onClick={() =>
              void run(async () => {
                if (!managementReady) return;
                if (manage.attempt) {
                  await manage.execute(
                    manage.attempt.target?.path ??
                      (managementId ? `/task-templates/${managementId}` : '/task-templates'),
                    manage.attempt.payload,
                    manage.attempt.target?.method ?? (managementId ? 'PATCH' : 'POST'),
                    () => {
                      clearExecutionForm(
                        store.companyId,
                        store.session?.user.id ?? data.me.id,
                        managementForm,
                      );
                      setManaging(false);
                    },
                  );
                  await list.retry();
                  return;
                }
                const defaults = {
                  checklist: checklist
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  ...(!task
                    ? {
                        title: taskTitle,
                        description: taskDescription,
                        priority,
                        estimatedHours: Number(estimate),
                        tags: tags
                          .split(',')
                          .map((s) => s.trim())
                          .filter(Boolean),
                        ownerPolicy,
                        fixedOwnerId: fixedOwner,
                        reviewerId: reviewer,
                        requiresApproval: required,
                        status: initialStatus,
                        ...(relative !== '' ? { relativeDueDays: Number(relative) } : {}),
                      }
                    : {}),
                };
                const editing = !!managementId && editingTemplate;
                await manage.execute(
                  editing ? `/task-templates/${managementId}` : '/task-templates',
                  {
                    name,
                    kind,
                    scopeOwnerId: scopeOwner,
                    scopeDepartmentId: scopeDepartment,
                    defaults,
                    ...(editing ? { version: managementVersion } : {}),
                  },
                  editing ? 'PATCH' : 'POST',
                  () => {
                    clearExecutionForm(
                      store.companyId,
                      store.session?.user.id ?? data.me.id,
                      managementForm,
                    );
                    setManaging(false);
                  },
                );
                await list.retry();
              })
            }
          >
            {manage.attempt ? 'Retry same scoped template submission' : 'Save scoped template'}
          </button>
          {source && managementReady && !manage.attempt && (
            <button
              className="button"
              onClick={() =>
                void run(async () => {
                  await manage.execute(
                    `/task-templates/${source.id}`,
                    { version: source.version, archived: !source.archived },
                    'PATCH',
                    () => {
                      clearExecutionForm(
                        store.companyId,
                        store.session?.user.id ?? data.me.id,
                        managementForm,
                      );
                      setManaging(false);
                    },
                  );
                  await list.retry();
                })
              }
            >
              {source.archived ? 'Restore template' : 'Archive template'}
            </button>
          )}
        </div>
      )}
      <ExecutionRecovery action={action} onReconcile={() => setPreview(undefined)} />
      <ExecutionRecovery
        action={manage}
        onReconcile={() => {
          clearExecutionForm(store.companyId, store.session?.user.id ?? data.me.id, managementForm);
          setManaging(false);
          setManagementVersion(0);
          void detail.retry();
        }}
      />
      {!!(error || action.error || manage.error) && (
        <ErrorMessage error={error || action.error || manage.error} />
      )}{' '}
      {action.attempt && (
        <p role="alert">This request may already have succeeded. Retry its frozen details.</p>
      )}
    </section>
  );
}
