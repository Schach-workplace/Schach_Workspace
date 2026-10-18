export type KnowledgePilot = "engineering" | "office" | "field" | "all";
export interface KnowledgeFields {
  pilot: KnowledgePilot;
  title: string;
  body: string;
  reviewerId: string;
  audience: "company" | "selected";
  readerIds: string[];
  state: "draft" | "published" | "archived";
  reviewDueDate: string;
}
export interface KnowledgeArticle extends KnowledgeFields {
  id: string;
  ownerId: string;
  version: number;
  reviewedVersion?: number;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
  updatedAt: string;
}
export interface KnowledgeReview {
  id: string;
  articleId: string;
  articleVersion: number;
  reviewerId: string;
  decision: "publish" | "return";
  reason: string;
  createdAt: string;
}
export interface KnowledgeDetail {
  article: KnowledgeArticle;
  reviews: KnowledgeReview[];
  canEdit: boolean;
  canReview: boolean;
}
export interface KnowledgeList {
  articles: KnowledgeArticle[];
  hasMore: boolean;
  cursor: string;
}
export type KnowledgeCreate = Omit<KnowledgeFields, "state"> & {
  retryKey: string;
  state?: "draft" | "archived";
};
export type KnowledgeUpdate = Partial<Omit<KnowledgeFields, "state">> & {
  retryKey: string;
  expectedVersion: number;
  state?: "draft" | "archived";
};
export interface KnowledgeReviewInput {
  retryKey: string;
  expectedVersion: number;
  decision: "publish" | "return";
  reason: string;
}
export interface KnowledgeMutationResult {
  id: string;
  version: number;
  reviewId?: string;
}
export interface KnowledgeAnswerInput {
  articleIds: string[];
  question: string;
}
export interface KnowledgeCitation {
  id: string;
  title: string;
  version: number;
  excerpt: string;
}
export interface KnowledgeAnswer {
  answer: string;
  citations: KnowledgeCitation[];
  abstained: boolean;
  reason?: string;
}
