import { fixture } from "./workspace";
const empty = new URLSearchParams(location.search).has("empty");
export class NativeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const client = {
  endpoint: "https://fictional.example.invalid",
  generation: 1,
  async request(path: string, method = "GET") {
    if (path.endsWith("/conversations/group"))
      return {
        conversation: {
          id: "group",
          kind: "group",
          title: "Fictional drawing review",
          public: false,
          archived: false,
          version: 1,
          forwarding: "explicit",
        },
        members: [
          {
            userId: "fictional-me",
            role: "member",
            epoch: 1,
            historyFromSequence: 1,
            readSequence: 0,
          },
          {
            userId: "fictional-peer",
            role: "member",
            epoch: 1,
            historyFromSequence: 1,
            readSequence: 0,
          },
        ],
      };
    if (path.includes("/conversations/group/sync"))
      return { events: [], cursor: "fictional-sync", hasMore: false };
    if (path.endsWith("/conversations/group/messages"))
      return {
        messages: empty
          ? []
          : [
              {
                id: "m1",
                conversationId: "group",
                sequence: 1,
                revision: 1,
                body: "Please review the selected drawings before the handover.",
                removed: false,
                senderId: "fictional-peer",
                createdAt: "2026-10-18T10:00:00Z",
                mediaIds: [],
                mentionIds: [],
                mentionAll: false,
                replyToId: "",
              },
              {
                id: "m2",
                conversationId: "group",
                sequence: 2,
                revision: 1,
                body: "I will check the evidence and update the commitment.",
                removed: false,
                senderId: "fictional-me",
                createdAt: "2026-10-18T10:02:00Z",
                mediaIds: [],
                mentionIds: [],
                mentionAll: false,
                replyToId: "",
              },
            ],
        cursor: "",
        hasMore: false,
      };
    if (method !== "GET")
      throw Error("Fictional read-only preview: writes disabled.");
    if (path.endsWith("/communication/attention"))
      return {
        conversations: empty
          ? []
          : [
              { conversationId: "dm", unread: 3 },
              { conversationId: "group", unread: 1 },
            ],
      };
    if (path.includes("/attention?"))
      return {
        items: empty
          ? []
          : [
              {
                id: "a1",
                title: "Review engineering evidence",
                summary:
                  "Check the selected evidence before making a decision.",
                ownerName: "Fictional colleague",
                state: "open",
                canDecide: true,
                actions: ["resolve", "snooze"],
                sourceKind: "task",
                sourceId: "t2",
                sourceVersion: 1,
                version: 1,
              },
            ],
        hasMore: false,
        cursor: "",
      };
    if (path.includes("/planning/calendar?"))
      return {
        tasks: fixture.work.tasks,
        complete: true,
        timezone: "Asia/Kolkata",
      };
    if (path.includes("/planning/summary?"))
      return {
        method: "visible_remaining_overlap_v1",
        methodDescription: "Visible remaining effort, not an employee rating",
        timezone: "Asia/Kolkata",
        generatedAt: "2026-10-18T12:00:00Z",
        projectionBasis: "fictional",
        filters: { from: "2026-10-19", to: "2026-10-25" },
        coverage: {
          visibleTasks: empty ? 0 : 3,
          uniqueSelectedRemainingHours: empty ? 0 : 12,
          weeklyExposureHours: empty ? 0 : 12,
          undated: 0,
          invalidInterval: 0,
          recordedZeroEstimate: 0,
          missingOwner: 0,
          invalidNumeric: 0,
        },
        weeks: empty
          ? []
          : [
              {
                from: "2026-10-19",
                to: "2026-10-25",
                selectedFrom: "2026-10-19",
                selectedTo: "2026-10-25",
                partial: false,
                remainingHours: 12,
                positiveCapacityHours: 40,
                positiveCapacityEffort: 12,
                utilization: 30,
                excludedCapacityRows: 0,
                drill: { category: "scheduled" },
                people: [
                  {
                    id: "fictional-me",
                    name: "Fictional member",
                    recordedCapacity: 40,
                    capacityState: "recorded_positive",
                    remainingHours: 12,
                    utilization: 30,
                    drill: { category: "scheduled" },
                  },
                ],
              },
            ],
      };
    if (path.includes("/planning/warnings")) return { warnings: [] };
    if (path.endsWith("/goals"))
      return {
        goals: empty
          ? []
          : [
              {
                id: "g",
                name: "Reduce handover defects",
                current: 4.8,
                baseline: 8,
                target: 3,
                unit: "defects",
              },
            ],
        cursor: "",
        hasMore: false,
      };
    if (path.endsWith("/projects/p"))
      return {
        project: {
          id: "p",
          name: "Fictional Project",
          description: "A clearly owned handover initiative.",
          version: 1,
          taskOwnerPolicy: "actor",
        },
        summary: { total: 3, accepted: 1 },
        canEdit: true,
      };
    if (path.includes("/projects/p/milestones"))
      return { milestones: [], cursor: "", hasMore: false };
    if (path.endsWith("/growth/catalog"))
      return {
        pilots: ["engineering", "office", "field"].map((id) => ({
          id,
          label: id,
          careerRoles: ["Practitioner"],
          levels: ["foundation", "practitioner", "advanced"],
          competencies: [{ id: id + ".quality", label: "Quality practice" }],
          suggestedLearning: ["Practice a handover with a mentor"],
        })),
      };
    if (path.endsWith("/growth/plans"))
      return {
        plans: empty
          ? []
          : [
              {
                id: "gp",
                title: "Build a reliable handover practice",
                pilot: "engineering",
                careerRole: "Project engineer",
                careerLevel: "practitioner",
                state: "active",
                version: 1,
              },
            ],
        cursor: "",
        hasMore: false,
      };
    if (path.startsWith("/companies/fictional-north/knowledge?"))
      return {
        articles: empty
          ? []
          : [
              {
                id: "k",
                title: "Engineering handover checklist",
                pilot: "engineering",
                state: "published",
                version: 2,
                reviewDueDate: "2026-12-31",
              },
            ],
        cursor: "",
        hasMore: false,
      };
    if (path.includes("/reports/tasks/summary"))
      return { snapshot: "fictional-report" };
    throw Error("No fictional read fixture for this secondary workflow.");
  },
};
