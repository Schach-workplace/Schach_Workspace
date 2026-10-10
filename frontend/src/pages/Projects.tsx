import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarDays,
  Layers3,
  Pencil,
  Plus,
  Search,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { Project } from '../types';
import EntityForm from '../components/EntityForm';
import {
  Avatar,
  canManage,
  dateLabel,
  departmentName,
  EmptyState,
  isOpen,
  isOverdue,
  percent,
  personName,
  ProgressBar,
  today,
} from '../components/UI';
import { TaskTable } from './Tasks';

export default function Projects({
  selectedId,
  onSelect,
  onTask,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  onTask: (id: string, projectId?: string) => void;
}) {
  const { data: workspace } = useWorkspace();
  const data = workspace!;
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Project | 'new' | null>(null);
  const date = today(data.company.timezone);
  const project = data.projects.find((p) => p.id === selectedId);
  const shown = data.projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) &&
      (!department || p.departmentId === department) &&
      (!status || p.status === status),
  );
  const tasks = project ? data.tasks.filter((t) => t.projectId === project.id) : [];
  const taskProgress = percent(
    tasks.filter((t) => t.status === 'done').length,
    tasks.filter((t) => t.status !== 'cancelled').length,
  );
  return (
    <div className="page-content">
      {project ? (
        <>
          <button className="back-button" onClick={() => onSelect('')}>
            <ArrowLeft size={15} />
            All projects
          </button>
          <section className="project-detail-banner">
            <div className="project-detail-heading">
              <span
                className="project-large-icon"
                style={{ background: `${project.color}15`, color: project.color }}
              >
                <Layers3 size={27} />
              </span>
              <div>
                <span className="eyebrow">{departmentName(data, project.departmentId)}</span>
                <h2>{project.name}</h2>
                <p>{project.description || 'No project description yet.'}</p>
              </div>
              {canManage(data) && (
                <button className="button button-secondary" onClick={() => setEditing(project)}>
                  <Pencil size={14} />
                  Edit
                </button>
              )}
            </div>
            <div className="project-detail-meta">
              <span>
                <Avatar person={data.people.find((p) => p.id === project.ownerId)} size="xs" />
                {personName(data, project.ownerId)}
              </span>
              <span>
                <CalendarDays size={14} />
                Target {dateLabel(project.dueDate)}
              </span>
              <span className={`pill ${project.status === 'active' ? 'pill-green' : 'pill-slate'}`}>
                {project.status.replace('_', ' ')}
              </span>
            </div>
            <div className="project-stats">
              <div>
                <b>{tasks.length}</b>
                <span>Total tasks</span>
              </div>
              <div>
                <b>{tasks.filter((t) => t.status === 'done').length}</b>
                <span>Accepted</span>
              </div>
              <div>
                <b className="text-danger">{tasks.filter((t) => isOverdue(t, date)).length}</b>
                <span>Overdue</span>
              </div>
              <div>
                <b>{tasks.filter((t) => t.status === 'blocked').length}</b>
                <span>Blocked</span>
              </div>
              <div className="project-overall-progress">
                <span>{taskProgress}% accepted</span>
                <ProgressBar value={taskProgress} color="green" />
              </div>
            </div>
          </section>
          <div className="section-header">
            <div>
              <h2>Project work</h2>
              <p>Every commitment, owner and next step.</p>
            </div>
            {data.me.role !== 'viewer' && (
              <button className="button button-primary" onClick={() => onTask('new', project.id)}>
                <Plus size={15} />
                Add task
              </button>
            )}
          </div>
          <section className="panel">
            <TaskTable data={data} tasks={tasks} onTask={onTask} />
          </section>
        </>
      ) : (
        <>
          <div className="task-toolbar">
            <div className="search-input">
              <Search size={16} />
              <input
                aria-label="Search projects"
                placeholder="Find a project…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="toolbar-actions">
              <select
                aria-label="Filter projects by department"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
              >
                <option value="">All departments</option>
                {data.departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter projects by status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="">All statuses</option>
                <option value="active">Active</option>
                <option value="on_hold">On hold</option>
                <option value="completed">Completed</option>
                <option value="archived">Archived</option>
              </select>
              {canManage(data) && (
                <button className="button button-primary" onClick={() => setEditing('new')}>
                  <Plus size={15} />
                  New project
                </button>
              )}
            </div>
          </div>
          <div className="project-grid">
            {shown.map((p) => {
              const work = data.tasks.filter(
                (t) => t.projectId === p.id && t.status !== 'cancelled',
              );
              const completed = work.filter((t) => t.status === 'done').length;
              const overdue = work.filter((t) => isOverdue(t, date)).length;
              const blocked = work.filter((t) => t.status === 'blocked').length;
              const owners = [...new Set(work.map((t) => t.ownerId))];
              return (
                <button className="project-card" key={p.id} onClick={() => onSelect(p.id)}>
                  <div className="project-card-top">
                    <span
                      className="project-large-icon"
                      style={{ background: `${p.color}15`, color: p.color }}
                    >
                      <Layers3 size={22} />
                    </span>
                    <span className={`pill ${p.status === 'active' ? 'pill-green' : 'pill-slate'}`}>
                      {p.status.replace('_', ' ')}
                    </span>
                    <ArrowUpRight size={17} />
                  </div>
                  <span className="eyebrow">{departmentName(data, p.departmentId)}</span>
                  <h2>{p.name}</h2>
                  <p>{p.description || 'A shared space for related work and clear outcomes.'}</p>
                  <div className="project-card-progress">
                    <span>
                      {completed}/{work.length} tasks accepted
                    </span>
                    <strong>{percent(completed, work.length)}%</strong>
                  </div>
                  <ProgressBar
                    value={percent(completed, work.length)}
                    color={overdue || blocked ? 'orange' : 'green'}
                  />
                  <div className="project-card-health">
                    <span className={overdue || blocked ? 'health-at-risk' : 'health-good'}>
                      {overdue || blocked
                        ? `${overdue} overdue · ${blocked} blocked`
                        : 'No overdue or blocked work'}
                    </span>
                  </div>
                  <div className="project-card-footer">
                    <div className="avatar-stack">
                      {owners.slice(0, 3).map((id) => (
                        <Avatar person={data.people.find((v) => v.id === id)} size="xs" key={id} />
                      ))}
                      {owners.length > 3 && (
                        <span className="avatar-extra">+{owners.length - 3}</span>
                      )}
                    </div>
                    <span>
                      <CalendarDays size={13} />
                      {dateLabel(p.dueDate)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
          {shown.length === 0 && (
            <EmptyState
              icon={<Layers3 size={26} />}
              title="A place for the bigger picture"
              description={
                search || status || department
                  ? 'No projects match these filters.'
                  : 'Create a project and connect the tasks that deliver an outcome.'
              }
              action={
                canManage(data) ? (
                  <button className="button button-primary" onClick={() => setEditing('new')}>
                    <Plus size={15} />
                    Create project
                  </button>
                ) : undefined
              }
            />
          )}
        </>
      )}
      {editing && (
        <EntityForm
          kind="project"
          item={editing === 'new' ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
