import type { ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Flag,
  LoaderCircle,
  X,
} from 'lucide-react';
import type { Person, Priority, Task, TaskStatus, WorkspaceData } from '../types';

export const statuses: TaskStatus[] = [
  'backlog',
  'todo',
  'in_progress',
  'blocked',
  'in_review',
  'done',
  'cancelled',
];
export const statusLabel: Record<TaskStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  blocked: 'Blocked',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};
export const priorities: Priority[] = ['critical', 'high', 'medium', 'low'];
export const cx = (...values: (string | false | null | undefined)[]) =>
  values.filter(Boolean).join(' ');
export const isOpen = (t: Pick<Task, 'status'>) => !['done', 'cancelled'].includes(t.status);
export function today(timezone = 'UTC') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
export function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function dateLabel(date: string, options?: Intl.DateTimeFormatOptions) {
  if (!date) return 'No date';
  return new Date(`${date.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    timeZone: 'UTC',
    ...(options || { day: 'numeric', month: 'short' }),
  });
}
export function relativeTime(value: string) {
  const hours = Math.max(0, (Date.now() - new Date(value).getTime()) / 3600000);
  if (hours < 1) return `${Math.max(1, Math.floor(hours * 60))}m ago`;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
export function initials(name = '') {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((v) => v[0])
    .join('')
    .toUpperCase();
}
export function isOverdue(
  task: Pick<Task, 'status' | 'deadlineMode' | 'dueAt' | 'dueDate'>,
  date: string,
) {
  return (
    isOpen(task) &&
    (task.deadlineMode === 'timed'
      ? !!task.dueAt && Date.now() > Date.parse(task.dueAt)
      : !!task.dueDate && task.dueDate < date)
  );
}
export function canManage(data: WorkspaceData) {
  return ['founder', 'ceo', 'admin', 'head', 'manager'].includes(data.me.role);
}
export function canAdmin(data: WorkspaceData) {
  return ['founder', 'ceo', 'admin'].includes(data.me.role);
}
export function ownsScope(data: WorkspaceData, personId: string) {
  if (personId === data.me.id || canAdmin(data)) return true;
  const person = data.people.find((p) => p.id === personId);
  if (!person?.active) return false;
  if (data.me.role === 'head')
    return !!data.me.departmentId && person.departmentId === data.me.departmentId;
  if (data.me.role === 'manager') {
    let current: Person | undefined = person;
    const seen = new Set<string>();
    while (current?.managerId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.managerId === data.me.id) return true;
      current = data.people.find((p) => p.id === current!.managerId);
    }
  }
  return false;
}
export function canStructureTask(data: WorkspaceData, task: Task) {
  return (
    canAdmin(data) ||
    (data.me.role === 'head' &&
      !!data.me.departmentId &&
      data.me.departmentId === task.departmentId) ||
    (data.me.role === 'manager' && ownsScope(data, task.ownerId))
  );
}
export function canEditTask(data: WorkspaceData, task?: Task | null) {
  if (data.me.role === 'viewer') return false;
  return (
    !task ||
    canStructureTask(data, task) ||
    task.ownerId === data.me.id ||
    task.createdBy === data.me.id
  );
}
export function personName(data: WorkspaceData, id: string) {
  return data.people.find((p) => p.id === id)?.name || 'Unassigned';
}
export function projectName(data: WorkspaceData, id: string) {
  return data.projects.find((p) => p.id === id)?.name || 'No project';
}
export function departmentName(data: WorkspaceData, id: string) {
  return data.departments.find((p) => p.id === id)?.name || 'No department';
}
export function percent(done: number, total: number) {
  return total ? Math.round((done / total) * 100) : 0;
}
export function goalPercent(baseline: number, current: number, target: number) {
  return target === baseline
    ? 0
    : Math.min(100, Math.max(0, Math.round(((current - baseline) / (target - baseline)) * 100)));
}
export function Avatar({
  person,
  name,
  size = 'sm',
}: {
  person?: Person;
  name?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
}) {
  const n = person?.name || name || 'Unassigned';
  const colors = ['apricot', 'sage', 'blue', 'purple', 'sand'];
  const index = [...n].reduce((sum, c) => sum + c.charCodeAt(0), 0) % colors.length;
  return (
    <span className={`avatar avatar-${size} ${colors[index]}`} title={n} aria-label={n}>
      {initials(n)}
    </span>
  );
}
export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`status-badge status-${status}`}>
      {status === 'done' ? (
        <Check size={11} />
      ) : status === 'in_progress' || status === 'in_review' ? (
        <Clock3 size={11} />
      ) : (
        <Circle size={9} fill="currentColor" />
      )}
      {statusLabel[status]}
    </span>
  );
}
export function PriorityBadge({
  priority,
  compact = false,
}: {
  priority: Priority;
  compact?: boolean;
}) {
  const Icon = priority === 'low' ? ArrowDown : priority === 'medium' ? Flag : ArrowUp;
  return (
    <span className={`priority priority-${priority}`} title={`${priority} priority`}>
      <Icon size={13} />
      {!compact && <span>{priority}</span>}
    </span>
  );
}
export function ProgressBar({
  value,
  color = 'orange',
  label,
}: {
  value: number;
  color?: string;
  label?: string;
}) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || 'Progress'}
    >
      <span
        className={`progress-fill fill-${color}`}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon || <Check size={24} />}</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-header">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string;
  children: ReactNode;
  hint?: string;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className={cx('dialog-content', wide && 'dialog-wide')}>
          <div className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description || 'Complete the details below.'}
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-button" aria-label="Close dialog">
              <X size={19} />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function SaveButton({
  saving,
  children = 'Save changes',
}: {
  saving: boolean;
  children?: ReactNode;
}) {
  return (
    <button className="button button-primary" type="submit" disabled={saving}>
      {saving ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />}
      {saving ? 'Saving…' : children}
    </button>
  );
}
export function ErrorMessage({ error }: { error: string }) {
  return error ? (
    <div className="inline-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function LinkButton({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button className="text-button" onClick={onClick}>
      {children}
      <ChevronRight size={14} />
    </button>
  );
}
export function downloadText(name: string, content: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function csvCell(value: unknown) {
  let v = String(value ?? '');
  if (/^[=+@\-\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}
