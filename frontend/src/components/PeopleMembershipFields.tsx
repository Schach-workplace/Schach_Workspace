import type { MembershipDefaults, PeopleContext } from '../data/people';
import { Field } from './UI';
const roleLabels: Record<string, string> = {
  founder: 'Founder',
  ceo: 'CEO',
  admin: 'Company admin',
  finance: 'Finance',
  head: 'Department head',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
};
export default function PeopleMembershipFields({
  value,
  onChange,
  context,
  disabled = false,
}: {
  value: MembershipDefaults;
  onChange: (next: MembershipDefaults) => void;
  context?: PeopleContext;
  disabled?: boolean;
}) {
  const set = (key: keyof MembershipDefaults, v: string | number) =>
    onChange({ ...value, [key]: v });
  return (
    <fieldset className="form-grid plain-fieldset people-membership">
      <Field label="Company role">
        <select
          disabled={disabled}
          value={value.role}
          onChange={(e) => set('role', e.target.value)}
        >
          {disabled || !context ? (
            <option value={value.role}>Checking selected role…</option>
          ) : (
            context.roles.map((r) => (
              <option key={r} value={r}>
                {roleLabels[r] ?? r}
              </option>
            ))
          )}
        </select>
      </Field>
      <Field label="Department">
        <select
          disabled={disabled}
          value={value.departmentId}
          onChange={(e) => set('departmentId', e.target.value)}
        >
          {disabled || !context ? (
            <option value={value.departmentId}>Checking selected department…</option>
          ) : (
            <>
              <option value="">No department</option>
              {context?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </>
          )}
        </select>
      </Field>
      <Field label="Reporting manager">
        <select
          disabled={disabled}
          value={value.managerId}
          onChange={(e) => set('managerId', e.target.value)}
        >
          {disabled || !context ? (
            <option value={value.managerId}>Checking selected manager…</option>
          ) : (
            <>
              <option value="">No manager</option>
              {context?.people
                .filter((p) => p.active)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.role}
                  </option>
                ))}
            </>
          )}
        </select>
      </Field>
      <Field label="Title">
        <input value={value.title} maxLength={160} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="Weekly capacity">
        <input
          type="number"
          min={0}
          max={168}
          value={value.capacityHours}
          onChange={(e) => set('capacityHours', Number(e.target.value))}
        />
      </Field>
    </fieldset>
  );
}
