import ExecutionRecovery from '../components/ExecutionRecovery';
import { clearAttemptScope } from '../data/businessAttempts';
import { ApiError } from '../data/api';
import {
  useBusinessAttempt,
  beginAttempt,
  businessKey,
  markAttemptCommitted,
  retireAttempt,
} from '../data/businessAttempts';
import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  Check,
  CheckCheck,
  ChevronDown,
  ClipboardList,
  Filter,
  GripVertical,
  LayoutGrid,
  List,
  Plus,
  Search,
  X,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { CreateTaskInput, Task, TaskFilters, TaskStatus, WorkspaceData } from '../types';
import { createTaskCSVTemplate, exportTasksCSV, parseTaskCSV } from '../data/imports';
import {
  Avatar,
  canEditTask,
  cx,
  dateLabel,
  downloadText,
  EmptyState,
  ErrorMessage,
  isOpen,
  isOverdue,
  Modal,
  personName,
  PriorityBadge,
  ProgressBar,
  statuses,
  statusLabel,
  StatusBadge,
  today,
  addDays,
} from '../components/UI';

export const emptyFilters: TaskFilters = {
  search: '',
  departmentId: '',
  ownerId: '',
  projectId: '',
  status: '',
  priority: '',
  due: '',
};
export function filterTasks(tasks: Task[], filters: TaskFilters, date: string) {
  return tasks.filter(
    (t) =>
      (!filters.search ||
        `${t.title} ${t.code} ${t.description} ${t.tags.join(' ')}`
          .toLowerCase()
          .includes(filters.search.toLowerCase())) &&
      (!filters.departmentId || t.departmentId === filters.departmentId) &&
      (!filters.ownerId || t.ownerId === filters.ownerId) &&
      (!filters.projectId || t.projectId === filters.projectId) &&
      (!filters.status || (filters.status === 'open' ? isOpen(t) : t.status === filters.status)) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!filters.due ||
        (filters.due === 'overdue'
          ? isOverdue(t, date)
          : filters.due === 'soon'
            ? isOpen(t) && !!t.dueDate && t.dueDate >= date && t.dueDate <= addDays(date, 7)
            : filters.due === 'today'
              ? isOpen(t) && t.dueDate === date
              : filters.due === 'none'
                ? !t.dueDate
                : true)),
  );
}

export function TaskTable({
  tasks,
  data,
  onTask,
  compact = false,
}: {
  tasks: Task[];
  data: WorkspaceData;
  onTask: (id: string) => void;
  compact?: boolean;
}) {
  const date = today(data.company.timezone);
  return tasks.length === 0 ? (
    <EmptyState
      icon={<CheckCheck size={25} />}
      title="Nothing needs attention here"
      description="Try another filter, or add a task to start moving work forward."
    />
  ) : (
    <div className="table-scroll">
      <table className={cx('task-table', compact && 'compact-table')}>
        <thead>
          <tr>
            <th>Task</th>
            <th>Status</th>
            <th>Owner</th>
            <th>Due date</th>
            {!compact && (
              <>
                <th>Priority</th>
                <th>Progress</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="task-name-cell">
                <button className="task-open" onClick={() => onTask(t.id)}>
                  <span className={cx('task-check', t.status === 'done' && 'completed')}>
                    {t.status === 'done' && <Check size={11} />}
                  </span>
                  <span>
                    <strong>{t.title}</strong>
                    <span className="task-meta">
                      <span>{t.code}</span>
                      <span className="dot-separator">·</span>
                      {data.projects.find((p) => p.id === t.projectId)?.name ||
                        data.departments.find((d) => d.id === t.departmentId)?.name ||
                        'Independent task'}
                    </span>
                  </span>
                </button>
              </td>
              <td data-label="Status">
                <StatusBadge status={t.status} />
              </td>
              <td data-label="Owner">
                <span className="person-cell">
                  <Avatar person={data.people.find((p) => p.id === t.ownerId)} size="xs" />
                  <span>{personName(data, t.ownerId).split(' ')[0]}</span>
                </span>
              </td>
              <td data-label="Due date">
                <span className={cx('due-date', isOverdue(t, date) && 'overdue')}>
                  <CalendarDays size={13} />
                  {t.dueDate === date ? 'Today' : dateLabel(t.dueDate)}
                </span>
              </td>
              {!compact && (
                <>
                  <td data-label="Priority">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td data-label="Progress">
                    <div className="table-progress">
                      <ProgressBar
                        value={t.progress}
                        color={t.status === 'done' ? 'green' : 'slate'}
                      />
                      <span>{t.progress}%</span>
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function TasksPage({
  filters,
  setFilters,
  onTask,
  mine = false,
}: {
  filters: TaskFilters;
  setFilters: Dispatch<SetStateAction<TaskFilters>>;
  onTask: (id: string) => void;
  mine?: boolean;
}) {
  const store = useWorkspace();
  const business = useBusinessAttempt<{ rows: CreateTaskInput[] }>('task-import');
  const data = store.data!;
  const [layout, setLayout] = useState('list');
  const [sort, setSort] = useState('deadline');
  const [expanded, setExpanded] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [rows, setRows] = useState<CreateTaskInput[]>(() => business.attempt?.payload.rows ?? []);
  const [importError, setImportError] = useState('');
  const importPending = useRef(false);
  const [importBusy, setImportBusy] = useState(false);
  const [moving, setMoving] = useState('');
  const [moveError, setMoveError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const date = today(data.company.timezone);
  const source = mine
    ? data.tasks.filter((t) => t.ownerId === data.me.id || t.reviewerId === data.me.id)
    : data.tasks;
  const shown = filterTasks(source, filters, date).sort((a, b) =>
    sort === 'deadline'
      ? (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
      : sort === 'newest'
        ? b.createdAt.localeCompare(a.createdAt)
        : sort === 'priority'
          ? ['critical', 'high', 'medium', 'low'].indexOf(a.priority) -
            ['critical', 'high', 'medium', 'low'].indexOf(b.priority)
          : a.title.localeCompare(b.title),
  );
  const filterCount = Object.entries(filters).filter(([k, v]) => k !== 'search' && !!v).length;
  const set = (key: keyof TaskFilters, value: string) =>
    setFilters((v) => ({ ...v, [key]: value }));
  async function move(task: Task, status: TaskStatus) {
    if (task.status === status) return;
    if (status === 'blocked') {
      store.notify('Add a blocker reason in the task details, then save.');
      onTask(task.id);
      return;
    }
    if (status === 'done' && task.requiresApproval) {
      store.notify(
        'This task needs an independent review. Use the review controls in its details.',
      );
      onTask(task.id);
      return;
    }
    setMoving(task.id);
    setMoveError('');
    try {
      await store.mutate(`/tasks/${task.id}`, { status, version: task.version }, 'PATCH');
    } catch (e) {
      setMoveError(e instanceof Error ? e.message : 'Unable to move task.');
    } finally {
      setMoving('');
    }
  }
  const own = source.filter((t) => t.ownerId === data.me.id);
  return (
    <div className="page-content">
      {mine && (
        <div className="my-work-summary">
          <div>
            <span className="eyebrow">YOUR FOCUS</span>
            <h2>Small steps. Meaningful progress.</h2>
            <p>
              {own.filter((t) => isOverdue(t, date)).length
                ? `${own.filter((t) => isOverdue(t, date)).length} overdue commitments need your attention.`
                : 'Your next priorities, with the context to move them forward.'}
            </p>
          </div>
          <div className="my-stats">
            <button
              onClick={() => setFilters({ ...emptyFilters, ownerId: data.me.id, status: 'open' })}
            >
              <b>{own.filter(isOpen).length}</b>
              <span>Open tasks</span>
            </button>
            <button
              onClick={() => setFilters({ ...emptyFilters, ownerId: data.me.id, due: 'today' })}
            >
              <b>{own.filter((t) => isOpen(t) && t.dueDate === date).length}</b>
              <span>Due today</span>
            </button>
            <button onClick={() => setFilters({ ...emptyFilters, status: 'in_review' })}>
              <b>{source.filter((t) => t.status === 'in_review').length}</b>
              <span>In review</span>
            </button>
          </div>
        </div>
      )}
      <div className="task-toolbar">
        <div className="segmented" aria-label="Task view">
          <button onClick={() => setLayout('list')} className={layout === 'list' ? 'active' : ''}>
            <List size={16} />
            List
          </button>
          <button onClick={() => setLayout('board')} className={layout === 'board' ? 'active' : ''}>
            <LayoutGrid size={15} />
            Board
          </button>
        </div>
        <div className="toolbar-actions">
          <button
            className="button button-secondary"
            onClick={() => {
              downloadText(`schach-tasks-${date}.csv`, exportTasksCSV(shown, data));
              store.notify(`Exported ${shown.length} tasks.`);
            }}
          >
            <ArrowDownToLine size={15} />
            <span className="hide-small">Export</span>
          </button>
          {data.me.role !== 'viewer' && (
            <>
              <button
                className="button button-secondary"
                onClick={() => {
                  setImportError('');
                  setRows(business.attempt?.payload.rows ?? []);
                  setImportOpen(true);
                }}
              >
                <ArrowUpFromLine size={15} />
                <span className="hide-small">Import CSV</span>
              </button>
              <button className="button button-primary" onClick={() => onTask('new')}>
                <Plus size={15} />
                New task
              </button>
            </>
          )}
        </div>
      </div>
      <div className="filters-panel">
        <div className="filters-main">
          <div className="search-input">
            <Search size={16} />
            <input
              aria-label="Search tasks"
              placeholder="Search tasks, tags or ID…"
              value={filters.search}
              onChange={(e) => set('search', e.target.value)}
            />
          </div>
          <select
            aria-label="Filter status"
            value={filters.status}
            onChange={(e) => set('status', e.target.value)}
          >
            <option value="">All statuses</option>
            <option value="open">Open tasks</option>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {statusLabel[s]}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter department"
            value={filters.departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
          >
            <option value="">All departments</option>
            {data.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <button
            className={cx('button button-secondary', expanded && 'is-selected')}
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <Filter size={14} />
            Filters{filterCount > 0 && <span className="count-badge">{filterCount}</span>}
            <ChevronDown size={13} />
          </button>
        </div>
        {expanded && (
          <div className="filters-extra">
            <select
              aria-label="Filter owner"
              value={filters.ownerId}
              onChange={(e) => set('ownerId', e.target.value)}
            >
              <option value="">All owners</option>
              {data.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter project"
              value={filters.projectId}
              onChange={(e) => set('projectId', e.target.value)}
            >
              <option value="">All projects</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter priority"
              value={filters.priority}
              onChange={(e) => set('priority', e.target.value)}
            >
              <option value="">All priorities</option>
              {['critical', 'high', 'medium', 'low'].map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter deadline"
              value={filters.due}
              onChange={(e) => set('due', e.target.value)}
            >
              <option value="">All deadlines</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="soon">Due within 7 days</option>
              <option value="none">No deadline</option>
            </select>
          </div>
        )}
        {filterCount > 0 && (
          <div className="active-filters">
            <span>{shown.length} matching tasks</span>
            <button onClick={() => setFilters(emptyFilters)}>
              <X size={12} />
              Clear filters
            </button>
          </div>
        )}
      </div>
      <div className="list-heading">
        <span>
          <strong>{shown.length}</strong> {mine ? 'personal' : 'total'} tasks
        </span>
        <label>
          Sort by{' '}
          <select aria-label="Sort tasks" value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="deadline">Deadline</option>
            <option value="priority">Priority</option>
            <option value="newest">Newest first</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>
      <ErrorMessage error={moveError} />
      {layout === 'list' ? (
        <div className="panel">
          <TaskTable tasks={shown} data={data} onTask={onTask} />
        </div>
      ) : (
        <div className="board" aria-label="Task board">
          {statuses
            .filter((s) => s !== 'cancelled' || shown.some((t) => t.status === 'cancelled'))
            .map((status) => {
              const cards = shown.filter((t) => t.status === status);
              return (
                <section
                  className={`board-column board-${status}`}
                  key={status}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const t = data.tasks.find((t) => t.id === e.dataTransfer.getData('text/plain'));
                    if (t && canEditTask(data, t)) move(t, status);
                  }}
                >
                  <div className="board-column-header">
                    <span>
                      <i />
                      {statusLabel[status]}
                      <b>{cards.length}</b>
                    </span>
                  </div>
                  <div className="board-cards">
                    {cards.map((t) => (
                      <article
                        className={cx('board-card', moving === t.id && 'is-moving')}
                        key={t.id}
                        draggable={canEditTask(data, t)}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', t.id)}
                      >
                        <div className="board-card-top">
                          <span>{t.code}</span>
                          <div>
                            <PriorityBadge priority={t.priority} compact />
                            <GripVertical size={13} />
                          </div>
                        </div>
                        <button className="board-card-title" onClick={() => onTask(t.id)}>
                          {t.title}
                        </button>
                        <p>
                          {data.projects.find((p) => p.id === t.projectId)?.name ||
                            'Independent task'}
                        </p>
                        {t.blockerReason && t.status === 'blocked' && (
                          <div className="blocker-preview">{t.blockerReason}</div>
                        )}
                        <div className="board-card-bottom">
                          <span className={cx('due-date', isOverdue(t, date) && 'overdue')}>
                            <CalendarDays size={12} />
                            {dateLabel(t.dueDate)}
                          </span>
                          <Avatar size="xs" person={data.people.find((p) => p.id === t.ownerId)} />
                        </div>
                        {canEditTask(data, t) && (
                          <select
                            aria-label={`Move ${t.title} to status`}
                            className="board-move"
                            disabled={!!moving || store.saving}
                            value={t.status}
                            onChange={(e) => move(t, e.target.value as TaskStatus)}
                          >
                            {statuses.map((s) => (
                              <option key={s} value={s}>
                                Move: {statusLabel[s]}
                              </option>
                            ))}
                          </select>
                        )}
                      </article>
                    ))}
                    {cards.length === 0 && <div className="board-empty">No tasks</div>}
                  </div>
                </section>
              );
            })}
        </div>
      )}
      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import tasks from CSV"
        description="Preview and validate your data before adding up to 200 tasks."
      >
        <div className="entity-form">
          <ErrorMessage error={importError} />
          <div className="import-steps">
            <span>1</span>
            <div>
              <h3>Start with the template</h3>
              <p>Use exact department and project names, and existing owner emails.</p>
              <button
                className="text-button"
                onClick={() =>
                  downloadText('schach-task-template.csv', createTaskCSVTemplate(data))
                }
              >
                <ArrowDownToLine size={14} />
                Download CSV template
              </button>
            </div>
          </div>
          <div className="import-steps">
            <span>2</span>
            <div>
              <h3>Choose your completed CSV</h3>
              <p>The whole import is validated together. Failed rows are never partially added.</p>
              <button
                className="button button-secondary"
                disabled={!!business.attempt || importBusy}
                onClick={() => fileRef.current?.click()}
              >
                <ArrowUpFromLine size={14} />
                Choose CSV
              </button>
              <input
                type="file"
                ref={fileRef}
                hidden
                accept=".csv,text/csv"
                disabled={!!business.attempt || importBusy}
                onChange={async (e) => {
                  if (business.attempt || importPending.current) return;
                  setImportError('');
                  setRows([]);
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      if (file.size > 2000000) throw new Error('Choose a CSV smaller than 2 MB.');
                      setRows(parseTaskCSV(await file.text(), data));
                    } catch (err) {
                      setImportError(err instanceof Error ? err.message : 'Invalid CSV.');
                    }
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </div>
          {rows.length > 0 && (
            <div className="import-preview">
              <strong>{rows.length} tasks ready to import</strong>
              <ul>
                {rows.slice(0, 5).map((r, i) => (
                  <li key={i}>{r.title}</li>
                ))}
              </ul>
              {rows.length > 5 && <span>And {rows.length - 5} more</span>}
            </div>
          )}
          {business.attempt && (
            <p role="alert">
              The previous import may already exist. Retry its original frozen rows; choosing
              another CSV will not replace this attempt.
            </p>
          )}
          <ExecutionRecovery
            action={{
              attempt: business.attempt,
              busy: importBusy,
              abandon: () => {
                if (!importPending.current) {
                  clearAttemptScope(business.scope);
                  setImportError('');
                  setRows([]);
                }
              },
            }}
          />
          <div className="form-actions">
            <button className="button button-secondary" onClick={() => setImportOpen(false)}>
              Cancel
            </button>
            <button
              className="button button-primary"
              disabled={(!rows.length && !business.attempt) || store.saving || importBusy}
              onClick={async () => {
                if (importPending.current) return;
                importPending.current = true;
                setImportBusy(true);
                setImportError('');
                try {
                  const attempt = beginAttempt(
                    business.scope,
                    business.attempt?.payload ?? { rows },
                    businessKey(),
                    { path: '/tasks/import', method: 'POST' },
                  );
                  if (attempt.state !== 'committed')
                    await store.mutate(
                      '/tasks/import',
                      { ...attempt.payload, retryKey: attempt.retryKey },
                      'POST',
                      (result) =>
                        markAttemptCommitted(business.scope, attempt.retryKey, {
                          ids: result.ids ?? [],
                        }),
                    );
                  retireAttempt(business.scope, attempt.retryKey);
                  setImportOpen(false);
                } catch (e) {
                  if (e instanceof ApiError && [401, 403, 404].includes(e.status))
                    clearAttemptScope(business.scope);
                  setImportError(e instanceof Error ? e.message : 'Import failed.');
                } finally {
                  importPending.current = false;
                  setImportBusy(false);
                }
              }}
            >
              <Plus size={15} />
              Import {rows.length || ''} tasks
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
