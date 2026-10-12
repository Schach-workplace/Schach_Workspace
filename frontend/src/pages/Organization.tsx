import { usePeopleTools } from '../components/PeopleTools';
import { DirectCompanyRevocation } from '../components/DepartureHandover';
import { useState } from 'react';
import {
  ArrowRight,
  Building2,
  GitBranch,
  Mail,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UsersRound,
} from 'lucide-react';
import { useWorkspace } from '../store';
import type { Department, Person, TaskFilters, View } from '../types';
import EntityForm, { type EntityKind } from '../components/EntityForm';
import {
  Avatar,
  canAdmin,
  departmentName,
  EmptyState,
  isOpen,
  Modal,
  personName,
} from '../components/UI';

export const roleNames: Record<string, string> = {
  founder: 'Founder',
  ceo: 'CEO',
  admin: 'Company admin',
  finance: 'Finance',
  head: 'Department head',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};
export default function Organization({
  onNavigate,
}: {
  onNavigate: (view: View, filters?: Partial<TaskFilters>) => void;
}) {
  const { data: workspace, mode } = useWorkspace();
  const data = workspace!;
  const [tab, setTab] = useState('people');
  const openPeople = usePeopleTools();
  const [search, setSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [active, setActive] = useState('active');
  const [selected, setSelected] = useState<Person | null>(null);
  const [editing, setEditing] = useState<{ kind: EntityKind; item?: Person | Department } | null>(
    null,
  );
  const people = data.people.filter(
    (p) =>
      `${p.name} ${p.email} ${p.title}`.toLowerCase().includes(search.toLowerCase()) &&
      (!department || p.departmentId === department) &&
      (active === 'all' || p.active === (active === 'active')),
  );
  const admin = canAdmin(data);
  return (
    <div className="page-content">
      {mode === 'demo' && (
        <p role="status">
          Fictional local People demonstration. No real accounts, credentials, private invitations
          or server changes. Starting task templates and private review obligations require a
          connected company.
        </p>
      )}
      <div className="organization-summary">
        <div>
          <span className="org-summary-icon">
            <UsersRound size={21} />
          </span>
          <div>
            <strong>{data.people.filter((p) => p.active).length}</strong>
            <span>Active people</span>
          </div>
        </div>
        <div>
          <span className="org-summary-icon">
            <Building2 size={21} />
          </span>
          <div>
            <strong>{data.departments.length}</strong>
            <span>Departments</span>
          </div>
        </div>
        <div>
          <span className="org-summary-icon">
            <GitBranch size={21} />
          </span>
          <div>
            <strong>
              {data.people.filter((p) => p.active && ['head', 'manager'].includes(p.role)).length}
            </strong>
            <span>Heads & managers</span>
          </div>
        </div>
      </div>
      <div className="task-toolbar">
        <div className="segmented organization-tabs" role="group" aria-label="Organization views">
          <button
            aria-pressed={tab === 'people'}
            className={tab === 'people' ? 'active' : ''}
            onClick={() => setTab('people')}
          >
            <UsersRound size={15} />
            People
          </button>
          <button
            aria-pressed={tab === 'departments'}
            className={tab === 'departments' ? 'active' : ''}
            onClick={() => setTab('departments')}
          >
            <Building2 size={15} />
            Departments
          </button>
          <button
            aria-pressed={tab === 'hierarchy'}
            className={tab === 'hierarchy' ? 'active' : ''}
            onClick={() => setTab('hierarchy')}
          >
            <GitBranch size={15} />
            Reporting lines
          </button>
        </div>
        {admin && (
          <button
            className="button button-primary"
            onClick={() =>
              tab === 'departments' ? setEditing({ kind: 'department' }) : openPeople('onboard')
            }
          >
            <Plus size={15} />
            {tab === 'departments' ? 'Add department' : 'Add person'}
          </button>
        )}
      </div>
      {admin && (
        <div className="form-actions">
          <button className="button" onClick={() => openPeople('presets')}>
            Onboarding presets
          </button>
          <button className="button" onClick={() => openPeople('reviews')}>
            Review access
          </button>
        </div>
      )}
      {tab === 'people' && (
        <>
          <div className="filters-panel">
            <div className="filters-main">
              <div className="search-input">
                <Search size={16} />
                <input
                  aria-label="Search people"
                  placeholder="Search people, roles or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <select
                aria-label="People department"
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
                aria-label="Membership status"
                value={active}
                onChange={(e) => setActive(e.target.value)}
              >
                <option value="active">Active members</option>
                <option value="inactive">Inactive members</option>
                <option value="all">All members</option>
              </select>
            </div>
          </div>
          <section className="panel">
            <div className="table-scroll">
              <table className="data-table people-table">
                <thead>
                  <tr>
                    <th>Person</th>
                    <th>Department</th>
                    <th>Role</th>
                    <th>Reports to</th>
                    <th>Weekly capacity</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <button className="person-details-button" onClick={() => setSelected(p)}>
                          <Avatar person={p} size="md" />
                          <div>
                            <strong>
                              {p.name}
                              {!p.active && <span className="inactive-label">Inactive</span>}
                            </strong>
                            <span>{p.title || p.email}</span>
                          </div>
                        </button>
                      </td>
                      <td>{departmentName(data, p.departmentId)}</td>
                      <td>
                        <span
                          className={`pill ${['founder', 'ceo', 'admin'].includes(p.role) ? 'pill-orange' : 'pill-slate'}`}
                        >
                          {roleNames[p.role]}
                        </span>
                      </td>
                      <td>{p.managerId ? personName(data, p.managerId) : '—'}</td>
                      <td>{p.capacityHours}h / week</td>
                      <td>
                        {admin ? (
                          <button
                            className="icon-button"
                            aria-label={`Edit ${p.name}`}
                            onClick={() => setEditing({ kind: 'person', item: p })}
                          >
                            <Pencil size={15} />
                          </button>
                        ) : (
                          <button
                            className="icon-button"
                            aria-label={`View ${p.name}`}
                            onClick={() => setSelected(p)}
                          >
                            <ArrowRight size={15} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {people.length === 0 && (
              <EmptyState
                title="No people match this view"
                description="Change your search or department filter."
              />
            )}
          </section>
        </>
      )}
      {tab === 'departments' && (
        <div className="department-grid">
          {data.departments.map((d) => {
            const members = data.people.filter((p) => p.active && p.departmentId === d.id);
            const tasks = data.tasks.filter((t) => t.departmentId === d.id && isOpen(t));
            return (
              <section className="panel department-card" key={d.id}>
                <div className="department-card-top">
                  <span
                    className="department-large-icon"
                    style={{ color: d.color, background: `${d.color}15` }}
                  >
                    <Building2 size={24} />
                  </span>
                  {admin && (
                    <button
                      className="icon-button"
                      aria-label={`Edit ${d.name}`}
                      onClick={() => setEditing({ kind: 'department', item: d })}
                    >
                      <Pencil size={15} />
                    </button>
                  )}
                </div>
                <h2>{d.name}</h2>
                <p>{d.description || 'A focused team with shared ownership and goals.'}</p>
                <div className="department-head">
                  <span className="muted">Department head</span>
                  <div>
                    <Avatar person={data.people.find((p) => p.id === d.headId)} size="xs" />
                    <strong>{d.headId ? personName(data, d.headId) : 'Not assigned'}</strong>
                  </div>
                </div>
                <div className="department-card-stats">
                  <button
                    onClick={() => {
                      setTab('people');
                      setDepartment(d.id);
                    }}
                  >
                    <b>{members.length}</b>
                    <span>
                      People
                      <ArrowRight size={13} />
                    </span>
                  </button>
                  <button
                    onClick={() => onNavigate('tasks', { departmentId: d.id, status: 'open' })}
                  >
                    <b>{tasks.length}</b>
                    <span>
                      Open tasks
                      <ArrowRight size={13} />
                    </span>
                  </button>
                </div>
              </section>
            );
          })}
          {data.departments.length === 0 && (
            <EmptyState
              title="Create your first department"
              description="Group your people and work into clear areas of ownership."
            />
          )}
        </div>
      )}
      {tab === 'hierarchy' && (
        <div className="hierarchy">
          <div className="hierarchy-company">
            <Building2 size={22} />
            <div>
              <strong>{data.company.name}</strong>
              <span>
                {data.departments.length} departments · {data.people.filter((p) => p.active).length}{' '}
                people
              </span>
            </div>
          </div>
          <div className="leadership-strip">
            {data.people
              .filter((p) => p.active && ['founder', 'ceo', 'admin'].includes(p.role))
              .map((p) => (
                <button key={p.id} onClick={() => setSelected(p)}>
                  <Avatar person={p} />
                  <div>
                    <strong>{p.name}</strong>
                    <span>{roleNames[p.role]}</span>
                  </div>
                </button>
              ))}
          </div>
          <div className="hierarchy-departments">
            {data.departments.map((d) => {
              const members = data.people.filter((p) => p.active && p.departmentId === d.id);
              return (
                <section className="panel hierarchy-department" key={d.id}>
                  <header style={{ borderTopColor: d.color }}>
                    <Building2 size={17} />
                    <h3>{d.name}</h3>
                    <span>{members.length}</span>
                  </header>
                  <div className="hierarchy-head">
                    <span>DEPARTMENT HEAD</span>
                    {d.headId ? (
                      <button
                        onClick={() =>
                          setSelected(data.people.find((p) => p.id === d.headId) || null)
                        }
                      >
                        <Avatar person={data.people.find((p) => p.id === d.headId)} />
                        <strong>{personName(data, d.headId)}</strong>
                      </button>
                    ) : (
                      <p>Not assigned</p>
                    )}
                  </div>
                  <div className="hierarchy-members">
                    {members
                      .filter((p) => p.id !== d.headId)
                      .map((p) => (
                        <button key={p.id} onClick={() => setSelected(p)}>
                          <Avatar person={p} size="xs" />
                          <div>
                            <strong>{p.name}</strong>
                            <span>{p.title || roleNames[p.role]}</span>
                            <small>
                              Reports to{' '}
                              {p.managerId ? personName(data, p.managerId) : 'company leadership'}
                            </small>
                          </div>
                        </button>
                      ))}
                    {members.length === 0 && <p className="muted small">No members assigned.</p>}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
      {selected && (
        <Modal
          open
          onClose={() => setSelected(null)}
          title={selected.name}
          description={selected.title || roleNames[selected.role]}
        >
          <div className="entity-form person-profile">
            <div className="person-profile-top">
              <Avatar person={selected} size="lg" />
              <div>
                <span className="pill pill-slate">{roleNames[selected.role]}</span>
                <p>
                  <Mail size={14} />
                  {selected.email}
                </p>
              </div>
            </div>
            <dl className="profile-facts">
              <div>
                <dt>Department</dt>
                <dd>{departmentName(data, selected.departmentId)}</dd>
              </div>
              <div>
                <dt>Reports to</dt>
                <dd>
                  {selected.managerId
                    ? personName(data, selected.managerId)
                    : 'No manager assigned'}
                </dd>
              </div>
              <div>
                <dt>Planning capacity</dt>
                <dd>{selected.capacityHours}h / week</dd>
              </div>
              <div>
                <dt>Direct reports</dt>
                <dd>{data.people.filter((p) => p.active && p.managerId === selected.id).length}</dd>
              </div>
              <div>
                <dt>Membership</dt>
                <dd>{selected.active ? 'Active' : 'Inactive'}</dd>
              </div>
            </dl>
            {admin && (
              <>
                <button
                  className="button"
                  onClick={() => {
                    openPeople('departure', selected.id, (id) =>
                      onNavigate('projects', { projectId: id }),
                    );
                    setSelected(null);
                  }}
                >
                  Review company departure
                </button>
                <DirectCompanyRevocation userId={selected.id} />
              </>
            )}
            <div className="form-actions">
              {admin && (
                <button
                  className="button button-secondary"
                  onClick={() => {
                    setEditing({ kind: 'person', item: selected });
                    setSelected(null);
                  }}
                >
                  <Pencil size={15} />
                  Edit person
                </button>
              )}
              <button
                className="button button-primary"
                onClick={() => {
                  onNavigate('tasks', { ownerId: selected.id });
                  setSelected(null);
                }}
              >
                View assigned work
                <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </Modal>
      )}
      {editing && (
        <EntityForm kind={editing.kind} item={editing.item} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
