import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { Action } from "./ConnectUI";
import { useWorkspace } from "./Workspace";
import {
  intelligenceRequest,
  type IntelligenceJob,
} from "./intelligenceClient";
import { intelligenceSourcePath } from "../../shared/intelligence/resultLifecycle";
export default function IntelligenceResult({
  job,
  onReview,
  onTranscript,
}: {
  job: IntelligenceJob;
  onReview: (index: number, kind: "task" | "expense" | "intake") => void;
  onTranscript: () => void;
}) {
  const w = useWorkspace();
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const result = job.result;
  if (!result) return null;
  async function open(key: string) {
    const s = job.sources?.find((s) => s.sourceKey === key);
    if (!s) return;
    try {
      await intelligenceRequest(
        w.company,
        s.kind === "report_current"
          ? "/intelligence/selection-preview"
          : intelligenceSourcePath(s),
        s.kind === "report_current"
          ? {
              operation: "report_explanation",
              sources: [
                { kind: s.kind, id: s.id, selectedFieldSet: "metrics" },
              ],
            }
          : undefined,
      );
      if (s.conversationId)
        router.push({
          pathname: "/chat/[id]",
          params: {
            company: w.company,
            id: s.conversationId,
            messageId: s.kind === "message" ? s.id : s.parentId,
            ...(s.kind === "record" ? { recordId: s.id } : {}),
          },
        });
      else if (s.kind === "task_fields" || s.kind === "task_comment")
        router.push({
          pathname: "/task/[id]",
          params: {
            company: w.company,
            id: s.kind === "task_fields" ? s.id : (s.parentId ?? ""),
          },
        });
      else if (s.kind === "goal_fields" || s.kind === "goal_measurement")
        router.push({
          pathname: "/goals/[id]",
          params: {
            company: w.company,
            id: s.kind === "goal_fields" ? s.id : (s.parentId ?? ""),
          },
        });
      else if (s.kind === "expense_fields")
        router.push({
          pathname: "/expense/[id]",
          params: { id: s.id, company: w.company },
        });
      else if (s.kind === "transcript")
        router.push({
          pathname: "/intelligence/[id]",
          params: { id: s.id, company: w.company },
        });
      else if (s.kind === "planning_projection")
        router.push({ pathname: "/planning", params: { company: w.company } });
      else if (s.kind === "report_current")
        router.push({ pathname: "/reports", params: { company: w.company } });
      else if (s.kind === "report_snapshot")
        router.push({
          pathname: "/report/[id]",
          params: { company: w.company, id: s.id },
        });
    } catch {
      setError("This source is unavailable. Reselect current sources.");
    }
  }
  const citations = (keys: string[]) =>
    keys.map((key) => (
      <Action
        key={key}
        title={
          "Open " +
          (job.sources?.find((s) => s.sourceKey === key)?.label ||
            "selected source")
        }
        onPress={() => void open(key)}
      />
    ));
  return (
    <View>
      {result.limitations.map((text, i) => (
        <Text key={i}>{text}</Text>
      ))}
      {error !== "" && <Text accessibilityRole="alert">{error}</Text>}
      {result.operation === "transcript" && (
        <>
          {result.segments.slice(page * 40, (page + 1) * 40).map((s, i) => (
            <View key={i}>
              <Text>
                {(s.startMs / 1000).toFixed(1)}–{(s.endMs / 1000).toFixed(1)}s:{" "}
                {s.text}
              </Text>
              {citations([s.sourceKey])}
            </View>
          ))}
          <Action
            title="Previous segments"
            disabled={page === 0}
            onPress={() => setPage(page - 1)}
          />
          <Action
            title="Next segments"
            disabled={(page + 1) * 40 >= result.segments.length}
            onPress={() => setPage(page + 1)}
          />
          <Action
            title="Select this transcript for a new summary"
            onPress={onTranscript}
          />
        </>
      )}
      {result.operation === "summary" &&
        result.claims.map((c, i) => (
          <View key={i}>
            <Text>
              {c.text} · {c.confidence}
            </Text>
            {citations(c.sourceKeys)}
          </View>
        ))}
      {result.operation === "report_explanation" &&
        result.items.map((item, i) => (
          <View key={i}>
            <Text>{item.text}</Text>
            {citations(item.sourceKeys)}
          </View>
        ))}
      {result.operation === "action_draft" &&
        result.candidates.map((candidate, i) => (
          <View key={i}>
            <Text>{candidate.title}</Text>
            <Text>{candidate.description}</Text>
            <Text>Resolve: {candidate.unresolved.join(", ")}</Text>
            {citations(candidate.sourceKeys)}
            <Action
              title={"Review " + candidate.kind + " draft"}
              disabled={
                !job.publication?.allowed ||
                (candidate.kind !== "task" && !job.publication?.conversationId)
              }
              onPress={() => onReview(i, candidate.kind)}
            />
          </View>
        ))}
      {job.publication?.allowed === false && (
        <Text>
          This selection combines private conversations and is read-only.
        </Text>
      )}
    </View>
  );
}
