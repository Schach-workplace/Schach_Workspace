import type {
  MembershipDefaults,
  OnboardingIntent,
  PeoplePerson,
  ReviewDecision,
} from "./types";
export const onboardingStages = [
  "Person",
  "Access",
  "Starting work",
  "Review",
  "Done",
] as const;
export const departureStages = [
  "Obligations",
  "Replacements",
  "Review",
  "Confirm",
] as const;
export const sessionEffectCopy =
  "Existing account sessions will end; other company memberships remain. Devices must register again and calls must be rejoined after signing in.";
export const privateInviteCopy =
  "Private conversations require explicit owner invitations.";
export const directRevocationCopy =
  "Revoke this company access while preserving existing responsibilities and history. Handover is not performed. " +
  sessionEffectCopy;
export const emptyMembership = (): MembershipDefaults => ({
  role: "member",
  departmentId: "",
  managerId: "",
  title: "",
  capacityHours: 40,
});
export const emptyOnboarding = (): OnboardingIntent => ({
  name: "",
  email: "",
  membership: emptyMembership(),
  tasks: [],
});
export const initialDecisions = (people: PeoplePerson[]): ReviewDecision[] =>
  people.map((p) => ({
    userId: p.id,
    expectedMembershipVersion: p.membershipVersion,
    action: "keep",
  }));
export const replacementLabel = (kind: string) => kind.replaceAll("_", " ");
