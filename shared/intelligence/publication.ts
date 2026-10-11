import type { IntelligenceCandidate, IntelligenceJob } from "./types";
export interface IntelligenceAuthored {
  title: string;
  description: string;
  ownerId: string;
  reviewerId: string;
  dueDate: string;
  departmentId: string;
  categoryId: string;
  amount: string;
  currency: string;
  vendor: string;
  expenseDate: string;
}
export const emptyIntelligenceAuthored: IntelligenceAuthored = {
  title: "",
  description: "",
  ownerId: "",
  reviewerId: "",
  dueDate: "",
  departmentId: "",
  categoryId: "",
  amount: "",
  currency: "",
  vendor: "",
  expenseDate: "",
};
export function intelligenceReviewRequest(
  job: IntelligenceJob,
  candidate: IntelligenceCandidate,
  authored: IntelligenceAuthored,
  reviewHash = "",
) {
  const publication = job.publication;
  if (!publication?.allowed || !job.resultHash || !job.sourceSetHash)
    throw Error("This source combination is read-only.");
  if (!authored.title.trim()) throw Error("Review a title.");
  const intelligenceBasis = {
    jobId: job.jobId,
    resultHash: job.resultHash,
    sourceSetHash: job.sourceSetHash,
    ...(reviewHash ? { reviewHash } : {}),
  };
  const base = `/conversations/${publication.conversationId}`;
  const task = {
    title: authored.title,
    description: authored.description,
    ownerId: authored.ownerId,
    reviewerId: authored.reviewerId,
    dueDate: authored.dueDate,
    departmentId: authored.departmentId,
    projectId: "",
    parentId: "",
    priority: "medium",
    status: "todo",
    startDate: "",
    estimatedHours: 0,
    tags: [],
    checklist: [],
    dependencies: [],
    collaborators: [],
    recurrence: "none",
    requiresApproval: !!authored.reviewerId,
  };
  if (
    candidate.kind === "task" &&
    (!authored.ownerId || !authored.reviewerId || !authored.dueDate)
  )
    throw Error("Choose an owner, independent reviewer and deadline.");
  if (!publication.conversationId) {
    if (candidate.kind !== "task")
      throw Error("Business-only sources support reviewed task creation.");
    return {
      path: "/tasks",
      previewPath: `/intelligence/jobs/${job.jobId}/task-preview`,
      payload: { ...task, intelligenceBasis } as Record<string, unknown>,
      previewPayload: { task, intelligenceBasis } as Record<string, unknown>,
    };
  }
  const source = publication.sources[0];
  if (!source) throw Error("Current publication sources are unavailable.");
  const conversion = {
    anchorMessageId: source.messageId,
    actionId: "primary",
    sources: publication.sources,
    expectedPolicyVersion: publication.policyVersion,
    publication: { excerpt: "", attachmentIds: [] },
    intelligenceBasis,
  };
  if (candidate.kind === "task")
    return {
      path: base + "/task-conversions",
      previewPath: base + "/task-conversions/preview",
      payload: { ...conversion, task } as Record<string, unknown>,
      previewPayload: { ...conversion, task } as Record<string, unknown>,
    };
  if (candidate.kind === "intake") {
    if (!authored.departmentId)
      throw Error("Choose the responsible triage department.");
    const payload = {
      anchorMessageId: source.messageId,
      sourceRevision: source.revision,
      expectedPolicyVersion: publication.policyVersion,
      departmentId: authored.departmentId,
      title: authored.title,
      summary: authored.description,
      intelligenceBasis,
    };
    return {
      path: base + "/requests",
      previewPath: base + "/requests/preview",
      payload: payload as Record<string, unknown>,
      previewPayload: payload as Record<string, unknown>,
    };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(authored.amount))
    throw Error("Enter an exact amount with up to two decimal places.");
  const [whole, cents = ""] = authored.amount.split(".");
  const minor = BigInt(whole) * 100n + BigInt(cents.padEnd(2, "0"));
  if (minor <= 0n || minor > BigInt(Number.MAX_SAFE_INTEGER))
    throw Error("Amount exceeds the supported range.");
  if (!authored.categoryId || !authored.expenseDate || !authored.currency)
    throw Error("Choose an expense category, date and currency.");
  const payload = {
    ...conversion,
    expense: {
      title: authored.title,
      description: authored.description,
      departmentId: authored.departmentId,
      categoryId: authored.categoryId,
      vendor: authored.vendor,
      expenseDate: authored.expenseDate,
      amountMinor: Number(minor),
      currency: authored.currency,
      projectId: "",
      taskId: "",
    },
  };
  return {
    path: base + "/expense-conversions",
    previewPath: base + "/expense-conversions/preview",
    payload: payload as Record<string, unknown>,
    previewPayload: payload as Record<string, unknown>,
  };
}

export function intelligencePublicationOperation(path?: string) {
  if (path === "/tasks") return "task_create";
  if (/^\/conversations\/[^/]+\/task-conversions$/.test(path ?? ""))
    return "task_conversion";
  if (/^\/conversations\/[^/]+\/expense-conversions$/.test(path ?? ""))
    return "expense_conversion";
  if (/^\/conversations\/[^/]+\/requests$/.test(path ?? ""))
    return "request_publish";
  return "";
}
