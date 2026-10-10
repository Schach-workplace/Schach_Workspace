export interface SelectablePerson {
  id: string;
  name: string;
  active: boolean;
  role: string;
  departmentId?: string;
}
export function selectablePeople(
  people: SelectablePerson[],
  excludeIds: string[] = [],
  query = "",
) {
  return people.filter(
    (p) =>
      p.active &&
      p.role !== "viewer" &&
      !excludeIds.includes(p.id) &&
      p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
}
