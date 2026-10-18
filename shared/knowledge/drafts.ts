import type { KnowledgeArticle, KnowledgeFields } from "./types";
export function knowledgeDraft(article?: KnowledgeArticle): KnowledgeFields {
  return article
    ? {
        pilot: article.pilot,
        title: article.title,
        body: article.body,
        reviewerId: article.reviewerId,
        audience: article.audience,
        readerIds: [...article.readerIds],
        state: "draft",
        reviewDueDate: article.reviewDueDate,
      }
    : {
        pilot: "engineering",
        title: "",
        body: "",
        reviewerId: "",
        audience: "selected",
        readerIds: [],
        state: "draft",
        reviewDueDate: "",
      };
}
export function knowledgeSubmission(
  draft: KnowledgeFields,
  attempt?: { payload: Record<string, unknown> } | null,
): KnowledgeFields {
  return attempt
    ? ({ ...draft, ...attempt.payload } as KnowledgeFields)
    : draft;
}
export function knowledgeMarkdown(article: KnowledgeArticle) {
  // Text document, never executable HTML. Export is an independently held copy.
  return `# ${article.title.replace(/[\r\n]/g, " ")}\n\nVersion ${article.version} · ${article.state} · Review due ${article.reviewDueDate}\n\n${article.body}\n`;
}
