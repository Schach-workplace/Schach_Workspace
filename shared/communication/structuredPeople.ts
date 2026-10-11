interface PersonChoice {
  id: string;
  name: string;
  active: boolean;
  role: string;
}
export interface StructuredMember {
  userId: string;
  active?: boolean;
  role: string;
  historyFromSequence?: number;
}
// Advisory choices from current metadata. The server rechecks source access at submission.
export function structuredPeople<T extends PersonChoice>(
  people: T[],
  members: StructuredMember[],
  publicChannel: boolean,
  sourceSequence: number,
  actor: string,
  decision: boolean,
) {
  return people.filter((person) => {
    if (!person.active) return false;
    const member = members.find(
      (m) => m.userId === person.id && m.active === true,
    );
    if (
      !publicChannel &&
      (!member ||
        !member.historyFromSequence ||
        member.historyFromSequence > sourceSequence)
    )
      return false;
    return (
      !decision ||
      (person.id !== actor &&
        person.role !== "viewer" &&
        member?.role !== "viewer")
    );
  });
}
