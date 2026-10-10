import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace, type WorkTask } from "./Workspace";
import { client } from "./client";
import { Action, ui } from "./ConnectUI";
interface Source {
  messageId: string;
  revision: number;
  currentRevision: number;
  outOfDate: boolean;
}
export default function LinkedWork({
  conversation,
  onSource,
}: {
  conversation: string;
  onSource: (id: string) => void;
}) {
  const w = useWorkspace();
  const [rows, setRows] = useState<{ task: WorkTask; sources: Source[] }[]>([]);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const revision = useRef(0);
  async function load() {
    if (!w.foreground) return;
    const current = ++revision.current;
    setRows([]);
    try {
      const root = `/companies/${w.company}/conversations/${conversation}/work-links`;
      const v = await client.request<{ tasks: WorkTask[] }>(root);
      const rows = await Promise.all(
        v.tasks.map(async (task) => {
          const s = await client.request<{ sources: Source[] }>(
            root + "/" + task.id + "/sources",
          );
          return { task, sources: s.sources };
        }),
      );
      if (alive.current && current === revision.current) {
        setRows(rows.filter((row) => row.sources.length > 0));
        setError("");
      }
    } catch (e) {
      if (alive.current && current === revision.current) {
        setRows([]);
        setError((e as Error).message);
      }
    }
  }
  const reload = useEffectEvent(load);
  useEffect(() => {
    alive.current = true;
    const invalidate = () => {
      revision.current++;
    };
    void Promise.resolve().then(() => reload());
    const timer = setInterval(() => void reload(), 15000);
    return () => {
      alive.current = false;
      invalidate();
      clearInterval(timer);
    };
  }, [w.company, conversation, w.foreground, w.recordEpoch]);
  return (
    <View>
      <Text style={ui.title}>Current linked work</Text>
      <Text style={ui.subtitle}>
        Source and task access are checked independently.
      </Text>
      {rows.map(({ task, sources }) => (
        <View key={task.id}>
          <Text>
            {task.title} · {task.status} · {task.dueDate || "No deadline"}
          </Text>
          <Action
            title={"Open task: " + task.title}
            onPress={() =>
              router.push({
                pathname: "/task/[id]",
                params: {
                  id: task.id,
                  company: w.company,
                  conversationId: conversation,
                },
              })
            }
          />
          {sources.map((s) => (
            <View key={s.messageId}>
              <Text>
                {s.outOfDate
                  ? "Source changed; published excerpt remains its reviewed revision."
                  : "Published source is current."}{" "}
                Published {s.revision} · current {s.currentRevision}
              </Text>
              <Action
                title="Open current source"
                onPress={() => onSource(s.messageId)}
              />
            </View>
          ))}
        </View>
      ))}
      {error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
