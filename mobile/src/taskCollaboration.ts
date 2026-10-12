// Mirrors frontend/src/components/UI.tsx (canAdmin/ownsScope/canStructureTask/
// canEditTask) and TaskDrawer.tsx (canComment/canNudge/canLogTime). The server
// remains the authority; these only decide which controls are offered.
export interface CollaborationPerson {
  id: string;
  role: string;
  departmentId: string;
  managerId: string;
  active: boolean;
}
export interface CollaborationTask {
  ownerId: string;
  reviewerId: string;
  departmentId?: string;
  createdBy?: string;
  collaborators?: string[];
}
export interface CollaborationData {
  me: CollaborationPerson;
  people: CollaborationPerson[];
}
export function canAdmin(data: CollaborationData) {
  return ["founder", "ceo", "admin"].includes(data.me.role);
}
export function ownsScope(data: CollaborationData, personId: string) {
  if (personId === data.me.id || canAdmin(data)) return true;
  const person = data.people.find((p) => p.id === personId);
  if (!person?.active) return false;
  if (data.me.role === "head")
    return (
      !!data.me.departmentId && person.departmentId === data.me.departmentId
    );
  if (data.me.role === "manager") {
    let current: CollaborationPerson | undefined = person;
    const seen = new Set<string>();
    while (current?.managerId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.managerId === data.me.id) return true;
      current = data.people.find((p) => p.id === current!.managerId);
    }
  }
  return false;
}
export function canStructureTask(
  data: CollaborationData,
  task: CollaborationTask,
) {
  return (
    canAdmin(data) ||
    (data.me.role === "head" &&
      !!data.me.departmentId &&
      data.me.departmentId === task.departmentId) ||
    (data.me.role === "manager" && ownsScope(data, task.ownerId))
  );
}
export function canEditTask(data: CollaborationData, task: CollaborationTask) {
  if (data.me.role === "viewer") return false;
  return (
    canStructureTask(data, task) ||
    task.ownerId === data.me.id ||
    task.createdBy === data.me.id
  );
}
export function taskCollaborationRights(
  data: CollaborationData,
  task: CollaborationTask,
) {
  const member = data.me.role !== "viewer";
  const writable = canEditTask(data, task);
  const nudgeAuthority =
    member && (writable || task.reviewerId === data.me.id);
  return {
    comment: member,
    // The web only offers a nudge to someone other than the owner.
    nudge: nudgeAuthority && task.ownerId !== data.me.id,
    logTime:
      nudgeAuthority ||
      (member && !!task.collaborators?.includes(data.me.id)),
  };
}
export const DEFAULT_NUDGE = "Please share a progress update on this task.";
/** Same bounds the server enforces in backend/platform/collaboration.go. */
export function timeEntryBody(hours: string, date: string, note: string) {
  const value = Number(hours);
  if (!hours.trim() || !Number.isFinite(value) || value <= 0 || value > 24)
    throw Error("Enter more than 0 and at most 24 hours.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw Error("Enter the work date as YYYY-MM-DD.");
  if (!note.trim()) throw Error("Describe the work completed.");
  if (note.length > 4000)
    throw Error("Keep the work note to 4,000 characters.");
  return { hours: value, date, note };
}
