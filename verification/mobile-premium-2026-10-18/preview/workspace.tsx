import type { ReactNode } from "react";
import WorkspaceFrame from "../../../mobile/src/WorkspaceFrame";
const params = new URLSearchParams(location.search),
  empty = params.has("empty");
const long = params.has("long");
export const fixture = {
  selected: "group",
  recordEpoch: 0,
  device: "fictional-device",
  invalidatePrivateViews: () => {},
  registerDevice: async () => {},
  signOut: async () => {},
  company: "fictional-north",
  foreground: true,
  policyEpoch: 0,
  attentionEpoch: 0,
  executionEpoch: 0,
  session: {
    user: { id: "fictional-me", name: "Fictional member" },
    companies: [{ id: "fictional-north", name: "Fictional North" }],
  },
  error: "",
  setError: () => {},
  select: () => {},
  refresh: async () => {},
  listMore: false,
  loadMoreConversations: async () => {},
  conversations: empty
    ? []
    : [
        {
          id: "dm",
          kind: "dm",
          peerId: "fictional-peer",
          title: "",
          archived: false,
        },
        {
          id: "group",
          kind: "group",
          title: "Drawing review team",
          public: false,
          archived: false,
        },
        {
          id: "channel",
          kind: "channel",
          title: "Announcements",
          public: true,
          archived: false,
        },
      ],
  inbox: [],
  work: {
    readBasis: "fictional-basis",
    me: { id: "fictional-me", role: "manager", departmentId: "d" },
    company: {
      id: "fictional-north",
      name: "Fictional North",
      timezone: "Asia/Kolkata",
    },
    departments: [{ id: "d", name: "Engineering" }],
    projects: [
      {
        id: "p",
        name: "Fictional Project",
        status: "active",
        ownerId: "fictional-me",
      },
    ],
    activities: [],
    people: [
      {
        id: "fictional-me",
        name: "Fictional member",
        active: true,
        role: "manager",
      },
      {
        id: "fictional-peer",
        name: long
          ? "Fictional colleague with an unusually long display name"
          : "Fictional colleague",
        active: true,
        role: "member",
      },
    ],
    tasks: empty
      ? []
      : [
          {
            id: "t1",
            title: long
              ? "Prepare the engineering handover and verify drawings for the upcoming fictional project review"
              : "Prepare engineering handover",
            status: "in_progress",
            dueDate: "2026-10-20",
            deadlineMode: "timed",
            dueAt: "2026-10-20T10:30:00.000Z",
            dueTimezone: "Asia/Kolkata",
            ownerId: "fictional-me",
            version: 1,
            attachments: [],
          },
          {
            id: "t2",
            title: "Review site inspection evidence",
            status: "in_review",
            dueDate: "2026-10-19",
            ownerId: "fictional-peer",
            version: 1,
            attachments: [],
          },
          {
            id: "t3",
            title: "Confirm office procurement checklist",
            status: "todo",
            dueDate: "2026-10-23",
            ownerId: "fictional-me",
            version: 1,
            attachments: [],
          },
        ],
    expenses: empty
      ? []
      : [
          {
            id: "e1",
            title: long
              ? "Fictional field inspection travel and materials expense with a longer description"
              : "Site inspection travel",
            status: "submitted",
            amountMinor: 130050,
            currency: "INR",
          },
          {
            id: "e2",
            title: "Office supplies",
            status: "draft",
            amountMinor: 9450,
            currency: "INR",
          },
          {
            id: "e3",
            title: "Fictional design reference",
            status: "approved",
            amountMinor: 1999,
            currency: "USD",
          },
        ],
  },
};
export function useWorkspace() {
  return fixture;
}
export const styles = { heading: {}, message: {} };
export function Page({
  children,
  scroll = true,
  safeBottom = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  safeBottom?: boolean;
}) {
  return (
    <WorkspaceFrame
      userName="Fictional member"
      company={fixture.company}
      companies={[
        { id: fixture.company, name: "Fictional North" },
        { id: "fictional-south", name: "Fictional South" },
      ]}
      scopeKey="fixture"
      foreground
      scroll={scroll}
      safeBottom={safeBottom}
      onSwitchCompany={() => {}}
      onDismissError={() => {}}
    >
      {children}
    </WorkspaceFrame>
  );
}
