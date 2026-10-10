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
  const [selected, setSelected] = useState('');
  const detail = useExecutionRead<{ template: TaskTemplateView }>(
    `/task-templates/${selected}`,
    !!selected,
  );
  const source = detail.data?.template;
  const action = useExecutionMutation(`template:${selected}:${task?.id ?? 'create'}`);
  const manage = useExecutionMutation(`template-manage:${selected}`);
  const [preview, setPreview] = useState<TemplatePreview>();
  const [error, setError] = useState('');
  const [project, setProject] = useState(initialProject);
  const [anchor, setAnchor] = useState(today(data.company.timezone));
  const [editingTemplate, setEditingTemplate] = useState(false);
  const [managementVersion, setManagementVersion] = useState(0);
  const [managing, setManaging] = useState(false);
  const [name, setName] = useState('');
  const [scopeOwner, setScopeOwner] = useState(data.me.id);
  const [scopeDepartment, setScopeDepartment] = useState(data.me.departmentId);
  const [checklist, setChecklist] = useState('');
  const [ownerPolicy, setOwnerPolicy] = useState('actor');
  const [fixedOwner, setFixedOwner] = useState('');
  const [reviewer, setReviewer] = useState('');
  const [required, setRequired] = useState(false);
  const [relative, setRelative] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
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
  function loadManagement() {
    setEditingTemplate(true);
    if (source) {
      setManagementVersion(source.version);
      setName(source.name);
      setScopeOwner(source.scopeOwnerId);
      setScopeDepartment(source.scopeDepartmentId);
      setChecklist(source.defaults.checklist.join('\n'));
      setTaskTitle(source.defaults.title ?? '');
      setOwnerPolicy(source.defaults.ownerPolicy ?? 'actor');
      setFixedOwner(source.defaults.fixedOwnerId ?? '');
      setReviewer(source.defaults.reviewerId ?? '');
      setRequired(!!source.defaults.requiresApproval);
      setRelative(
        source.defaults.relativeDueDays === undefined
          ? ''
          : String(source.defaults.relativeDueDays),
      );
    }
    setManaging(true);
  }
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
          onChange={(e) => setSelected(e.target.value)}
          disabled={!!action.attempt}
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
                      await action.execute(`/tasks/${task.id}/checklists/apply`, {
                        version: task.version,
                        templateId: source.id,
                        expectedTemplateVersion: source.version,
                      });
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
                    {
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
      {managing && (
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
      {managing && (
        <div className="form-actions">
          <button className="button" onClick={() => setManaging(false)}>
            Cancel template editing
          </button>
          <button
            className="button button-primary"
            disabled={manage.busy || !name || (!task && !taskTitle)}
            onClick={() =>
              void run(async () => {
                const defaults = {
                  checklist: checklist
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean),
                  ...(!task
                    ? {
                        title: taskTitle,
                        ownerPolicy,
                        fixedOwnerId: fixedOwner,
                        reviewerId: reviewer,
                        requiresApproval: required,
                        status: 'todo',
                        ...(relative !== '' ? { relativeDueDays: Number(relative) } : {}),
                      }
                    : {}),
                };
                const editing = !!source && editingTemplate;
                await manage.execute(
                  editing ? `/task-templates/${source.id}` : '/task-templates',
                  {
                    name,
                    kind,
                    scopeOwnerId: scopeOwner,
                    scopeDepartmentId: scopeDepartment,
                    defaults,
                    ...(editing ? { version: managementVersion } : {}),
                  },
                  editing ? 'PATCH' : 'POST',
                );
                setManaging(false);
                await list.retry();
              })
            }
          >
            Save scoped template
          </button>
          {source && (
            <button
              className="button"
              onClick={() =>
                void run(async () => {
                  await manage.execute(
                    `/task-templates/${source.id}`,
                    { version: source.version, archived: !source.archived },
                    'PATCH',
                  );
                  setManaging(false);
                  await list.retry();
                })
              }
            >
              {source.archived ? 'Restore template' : 'Archive template'}
            </button>
          )}
        </div>
      )}
      {!!(error || action.error || manage.error) && (
        <ErrorMessage error={error || action.error || manage.error} />
      )}{' '}
      {action.attempt && (
        <p role="alert">This request may already have succeeded. Retry its frozen details.</p>
      )}
    </section>
  );
}
