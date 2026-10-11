import GoalMetadataForm from './GoalMetadataForm';
import { useState, type FormEvent } from 'react';
import { useWorkspace } from '../store';
import { SUPPORTED_CURRENCIES } from '../data/finance';
import type { Company, Department, Goal, Person, Project } from '../types';
import { canAdmin, ErrorMessage, Field, Modal, ownsScope, SaveButton } from './UI';

export type EntityKind = 'project' | 'goal' | 'person' | 'department' | 'company';
type Entity = Project | Goal | Person | Department | Company;
export default function EntityForm(props: {
  kind: EntityKind;
  item?: Entity;
  onClose: () => void;
}) {
  return props.kind === 'goal' ? (
    <GoalMetadataForm item={props.item as Goal | undefined} onClose={props.onClose} />
  ) : (
    <GenericEntityForm {...props} />
  );
}
function GenericEntityForm({
  kind,
  item,
  onClose,
}: {
  kind: EntityKind;
  item?: Entity;
  onClose: () => void;
}) {
  const { data: workspace, mutate, saving } = useWorkspace();
  const data = workspace!;
  const initial = item ? { ...item } : {};
  const [values, setValues] = useState<Record<string, unknown>>({
    name: '',
    description: '',
    departmentId: data.me.departmentId,
    ownerId: data.me.id,
    managerId: '',
    headId: '',
    dueDate: '',
    color: '#f97316',
    status: 'active',
    taskOwnerPolicy: 'actor',
    defaultTaskOwnerId: '',
    defaultReviewerId: '',
    defaultRequiresApproval: false,
    title: '',
    email: '',
    password: '',
    role: 'member',
    capacityHours: 40,
    active: true,
    unit: '%',
    baseline: 0,
    current: 0,
    target: 100,
    taskIds: [],
    slug: '',
    industry: '',
    timezone: data.company.timezone,
    currency: 'INR',
    fiscalYearStartMonth: 4,
    ...initial,
  });
  const [error, setError] = useState('');
  const get = (key: string) => String(values[key] ?? '');
  const set = (key: string, value: unknown) => setValues((v) => ({ ...v, [key]: value }));
  const names: Record<EntityKind, string> = {
    project: 'project',
    goal: 'goal',
    person: 'person',
    department: 'department',
    company: 'company',
  };
  const paths: Record<EntityKind, string> = {
    project: '/projects',
    goal: '/goals',
    person: '/people',
    department: '/departments',
    company: '/companies',
  };
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      kind === 'person' &&
      item &&
      values.active === false &&
      (item as Person).active &&
      !window.confirm(
        'Revoke company access now? Account sessions will end. Existing responsibilities remain assigned and handover is not performed.',
      )
    )
      return;
    setError('');
    const fields: Record<EntityKind, string[]> = {
      project: [
        'name',
        'description',
        'departmentId',
        'ownerId',
        'dueDate',
        'color',
        'status',
        'taskOwnerPolicy',
        'defaultTaskOwnerId',
        'defaultReviewerId',
        'defaultRequiresApproval',
      ],
      goal: [
        'name',
        'description',
        'ownerId',
        'departmentId',
        'unit',
        'baseline',
        'target',
        'current',
        'dueDate',
        'taskIds',
      ],
      person: item
        ? ['role', 'departmentId', 'managerId', 'title', 'capacityHours', 'active']
        : [
            'name',
            'email',
            'password',
            'role',
            'departmentId',
            'managerId',
            'title',
            'capacityHours',
          ],
      department: ['name', 'headId', 'color', 'description'],
      company: [
        'name',
        'slug',
        'industry',
        'timezone',
        'color',
        'currency',
        'fiscalYearStartMonth',
      ],
    };
    const body = Object.fromEntries(fields[kind].map((k) => [k, values[k]]));
    if (kind === 'project' && item) body.version = values.version;
    if (kind === 'person' && item) body.expectedVersion = values.membershipVersion;
    if (kind === 'department' && item) body.expectedVersion = values.version;
    try {
      await mutate(
        item ? (kind === 'company' ? '' : `${paths[kind]}/${item.id}`) : paths[kind],
        body,
        item ? 'PATCH' : 'POST',
      );
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to save changes.');
    }
  }
  const department = (
    <Field label="Department">
      <select value={get('departmentId')} onChange={(e) => set('departmentId', e.target.value)}>
        <option value="">No department</option>
        {data.departments
          .filter(
            (d) => canAdmin(data) || d.id === data.me.departmentId || d.id === get('departmentId'),
          )
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
      </select>
    </Field>
  );
  const owner = (
    <Field label="Owner">
      <select required value={get('ownerId')} onChange={(e) => set('ownerId', e.target.value)}>
        {data.people
          .filter((p) => p.active && (ownsScope(data, p.id) || p.id === get('ownerId')))
          .map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
      </select>
    </Field>
  );
  return (
    <Modal
      open
      onClose={onClose}
      title={`${item ? 'Edit' : 'New'} ${names[kind]}`}
      description={
        kind === 'person'
          ? 'Set their role, reporting line and planning capacity.'
          : kind === 'company'
            ? 'Each company has its own people, permissions and work.'
            : `Keep ownership and expectations clear for this ${names[kind]}.`
      }
    >
      <form onSubmit={submit} className="entity-form">
        <ErrorMessage error={error} />
        <Field label={kind === 'person' ? 'Full name' : 'Name'}>
          <input
            required
            autoFocus
            maxLength={160}
            value={get('name')}
            disabled={kind === 'person' && !!item}
            onChange={(e) => {
              set('name', e.target.value);
              if (kind === 'company' && !item)
                set(
                  'slug',
                  e.target.value
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-|-$/g, ''),
                );
            }}
            placeholder={kind === 'project' ? 'e.g. Q4 market expansion' : ''}
          />
        </Field>
        {(kind === 'project' || kind === 'goal' || kind === 'department') && (
          <Field label="Description">
            <textarea
              rows={3}
              value={get('description')}
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        )}
        {kind === 'project' && (
          <>
            <Field label="Task owner default">
              <select
                value={get('taskOwnerPolicy')}
                onChange={(e) => set('taskOwnerPolicy', e.target.value)}
              >
                <option value="actor">Person creating the task</option>
                <option value="project_owner">Project owner</option>
                <option value="fixed">Selected person</option>
              </select>
            </Field>
            {get('taskOwnerPolicy') === 'fixed' && (
              <Field label="Default task owner">
                <select
                  value={get('defaultTaskOwnerId')}
                  onChange={(e) => set('defaultTaskOwnerId', e.target.value)}
                >
                  <option value="">Choose a person</option>
                  {data.people
                    .filter((p) => p.active && ownsScope(data, p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
            )}
            <Field label="Default independent reviewer">
              <select
                value={get('defaultReviewerId')}
                onChange={(e) => set('defaultReviewerId', e.target.value)}
              >
                <option value="">No default reviewer</option>
                {data.people
                  .filter((p) => p.active && p.role !== 'viewer')
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
                checked={!!values.defaultRequiresApproval}
                onChange={(e) => set('defaultRequiresApproval', e.target.checked)}
              />{' '}
              Require independent task review
            </label>
          </>
        )}
        {(kind === 'project' || kind === 'goal') && (
          <div className="form-grid">
            {owner}
            {department}
            <Field label="Target date">
              <input
                type="date"
                value={get('dueDate')}
                onChange={(e) => set('dueDate', e.target.value)}
              />
            </Field>
            {kind === 'project' && (
              <Field label="Status">
                <select value={get('status')} onChange={(e) => set('status', e.target.value)}>
                  <option value="active">Active</option>
                  <option value="on_hold">On hold</option>
                  <option value="completed">Completed</option>
                  <option value="archived">Archived</option>
                </select>
              </Field>
            )}
          </div>
        )}
        {kind === 'goal' && (
          <>
            <div className="form-grid">
              <Field label="Unit">
                <input
                  required
                  value={get('unit')}
                  onChange={(e) => set('unit', e.target.value)}
                  placeholder="%, customers, ₹…"
                />
              </Field>
              <Field label="Baseline">
                <input
                  required
                  type="number"
                  step="any"
                  value={get('baseline')}
                  onChange={(e) => set('baseline', Number(e.target.value))}
                />
              </Field>
              <Field label="Target">
                <input
                  required
                  type="number"
                  step="any"
                  value={get('target')}
                  onChange={(e) => set('target', Number(e.target.value))}
                />
              </Field>
              <Field label="Current result">
                <input
                  required
                  type="number"
                  step="any"
                  value={get('current')}
                  onChange={(e) => set('current', Number(e.target.value))}
                />
              </Field>
            </div>
            <Field
              label="Contributing tasks"
              hint="Hold Ctrl / Cmd to select multiple tasks. Lower-is-better targets are supported."
            >
              <select
                multiple
                size={4}
                value={values.taskIds as string[]}
                onChange={(e) =>
                  set(
                    'taskIds',
                    Array.from(e.target.selectedOptions, (o) => o.value),
                  )
                }
              >
                {data.tasks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.title}
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        {kind === 'person' && (
          <>
            <Field label="Email">
              <input
                required
                type="email"
                disabled={!!item}
                value={get('email')}
                onChange={(e) => set('email', e.target.value)}
              />
            </Field>
            {!item && (
              <Field
                label="Initial password"
                hint="At least 12 characters. Share credentials directly; no invitation email is sent."
              >
                <input
                  required
                  minLength={12}
                  type="password"
                  autoComplete="new-password"
                  value={get('password')}
                  onChange={(e) => set('password', e.target.value)}
                />
              </Field>
            )}
            <div className="form-grid">
              <Field label="Job title">
                <input value={get('title')} onChange={(e) => set('title', e.target.value)} />
              </Field>
              <Field label="Role">
                <select value={get('role')} onChange={(e) => set('role', e.target.value)}>
                  {[
                    'founder',
                    'ceo',
                    'admin',
                    'finance',
                    'head',
                    'manager',
                    'member',
                    'viewer',
                  ].map((r) => (
                    <option
                      key={r}
                      value={r}
                      disabled={['founder', 'ceo'].includes(r) && data.me.role !== 'founder'}
                    >
                      {
                        (
                          {
                            founder: 'Founder',
                            ceo: 'CEO',
                            admin: 'Company admin',
                            finance: 'Finance',
                            head: 'Department head',
                            manager: 'Manager',
                            member: 'Member',
                            viewer: 'Viewer',
                          } as Record<string, string>
                        )[r]
                      }
                    </option>
                  ))}
                </select>
              </Field>
              {department}
              <Field label="Reports to">
                <select value={get('managerId')} onChange={(e) => set('managerId', e.target.value)}>
                  <option value="">No reporting manager</option>
                  {data.people
                    .filter((p) => p.active && p.id !== item?.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Weekly capacity (hours)"
                hint="Used for workload planning, not scoring."
              >
                <input
                  required
                  type="number"
                  min={0}
                  max={168}
                  step={1}
                  value={get('capacityHours')}
                  onChange={(e) => set('capacityHours', Number(e.target.value))}
                />
              </Field>
            </div>
            {item && (
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={!!values.active}
                  onChange={(e) => set('active', e.target.checked)}
                />
                <span>Active company membership</span>
              </label>
            )}
          </>
        )}
        {kind === 'department' && (
          <Field label="Department head">
            <select value={get('headId')} onChange={(e) => set('headId', e.target.value)}>
              <option value="">Not assigned yet</option>
              {data.people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        {kind === 'company' && (
          <>
            <div className="form-grid">
              <Field label="Company identifier" hint="Lowercase letters, numbers and hyphens.">
                <input
                  required
                  pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                  value={get('slug')}
                  onChange={(e) => set('slug', e.target.value)}
                />
              </Field>
              <Field label="Industry">
                <input value={get('industry')} onChange={(e) => set('industry', e.target.value)} />
              </Field>
            </div>
            <div className="form-grid">
              <Field
                label="Company currency"
                hint={
                  item && (data.budgets.length > 0 || data.expenses.length > 0)
                    ? 'Locked after the first budget or expense.'
                    : 'All budgets and expenses use this currency.'
                }
              >
                <select
                  value={get('currency')}
                  disabled={!!item && (data.budgets.length > 0 || data.expenses.length > 0)}
                  onChange={(e) => set('currency', e.target.value)}
                >
                  {SUPPORTED_CURRENCIES.map((currency) => (
                    <option key={currency}>{currency}</option>
                  ))}
                </select>
              </Field>
              <Field
                label="Financial year starts"
                hint="Set this before recording financial activity."
              >
                <select
                  value={get('fiscalYearStartMonth')}
                  disabled={!!item && (data.budgets.length > 0 || data.expenses.length > 0)}
                  onChange={(e) => set('fiscalYearStartMonth', Number(e.target.value))}
                >
                  {Array.from({ length: 12 }, (_, i) => (
                    <option key={i} value={i + 1}>
                      {new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(
                        new Date(Date.UTC(2026, i, 1)),
                      )}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Timezone" hint="Calendar deadlines use this timezone.">
              <select value={get('timezone')} onChange={(e) => set('timezone', e.target.value)}>
                {Array.from(
                  new Set([
                    data.company.timezone,
                    'Asia/Kolkata',
                    'UTC',
                    'Europe/London',
                    'America/New_York',
                    'America/Los_Angeles',
                    'Asia/Dubai',
                    'Asia/Singapore',
                    'Australia/Sydney',
                  ]),
                ).map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </>
        )}
        {['project', 'department', 'company'].includes(kind) && (
          <Field label="Colour">
            <div className="color-field">
              <input
                type="color"
                value={get('color')}
                onChange={(e) => set('color', e.target.value)}
              />
              <span>{get('color')}</span>
            </div>
          </Field>
        )}
        <div className="form-actions">
          <button type="button" className="button button-secondary" onClick={onClose}>
            Cancel
          </button>
          <SaveButton saving={saving}>{item ? 'Save changes' : `Create ${names[kind]}`}</SaveButton>
        </div>
      </form>
    </Modal>
  );
}
