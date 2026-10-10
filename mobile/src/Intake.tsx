import { workDeadline, DeadlineChoiceError } from "./workDates";
import PersonPicker from "./PersonPicker";
import DeadlinePicker from "./DeadlinePicker";
import { useRamInput } from "./ramInput";
import {
  useEffect,
  useEffectEvent,
  useState,
  useMemo,
  useRef,
  useLayoutEffect,
} from "react";
import { Button, Text, TextInput, View } from "react-native";
import { client } from "./client";
import { styles, useWorkspace } from "./Workspace";
interface Intake {
  id: string;
  title: string;
  summary: string;
  state: string;
  version: number;
  departmentId: string;
}
export default function IntakeQueue() {
  const w = useWorkspace();
  const [items, setItems] = useState<Intake[]>([]);
  const [selectedId, setSelectedId, retireSelected] = useRamInput(
    "$intake",
    "selectedId",
    "",
  );
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const form = "$intake:" + selectedId;
  const current = useRef({
    selectedId,
    generation: client.generation,
    root: "",
  });
  const alive = useRef(true);
  const busy = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [owner, setOwner, retireOwner] = useRamInput(
    form,
    "owner",
    w.session!.user.id,
  );
  const [reviewer, setReviewer, retireReviewer] = useRamInput(
    form,
    "reviewer",
    "",
  );
  const [due, setDue, retireDue] = useRamInput(form, "due", "");
  const [time, setTime, retireTime] = useRamInput(form, "time", "");
  const [instant, setInstant, retireInstant] = useRamInput(form, "instant", "");
  const [reason, setReason, retireReason] = useRamInput(form, "reason", "");
  const [briefing, setBriefing] = useState<{
    visibleTaskCount: number;
    visibleOpenRequestCount: number;
    notice: string;
  } | null>(null);
  const root = `/companies/${w.company}/communication/requests`;
  useLayoutEffect(() => {
    current.current = { selectedId, generation: client.generation, root };
  }, [selectedId, root]);
  const deadline = useMemo(() => {
    try {
      return {
        value: workDeadline(
          due,
          time,
          w.work?.company.timezone ?? "Asia/Kolkata",
          instant,
        ),
        error: "",
        choices: [] as string[],
      };
    } catch (e) {
      return {
        value: null,
        error: (e as Error).message,
        choices: e instanceof DeadlineChoiceError ? e.candidates : [],
      };
    }
  }, [due, time, instant, w.work?.company.timezone]);
  async function refresh() {
    const generation = client.generation;
    const v = await client.request<{ requests: Intake[] }>(root);
    if (
      alive.current &&
      current.current.root === root &&
      generation === client.generation
    )
      setItems(v.requests);
  }
  const load = useEffectEvent(() =>
    refresh().catch((e) => w.setError(e.message)),
  );
  useEffect(() => {
    void Promise.resolve().then(() => load());
  }, [root]);
  async function assign() {
    if (!selected || busy.current || !deadline.value) return;
    busy.current = true;
    const generation = client.generation;
    const target = selected.id;
    try {
      await client.request(root + "/" + selected.id + "/assign", "POST", {
        expectedVersion: selected.version,
        task: {
          title: selected.title,
          description: selected.summary,
          ownerId: owner,
          reviewerId: reviewer,
          requiresApproval: !!reviewer,
          departmentId: selected.departmentId,
          projectId: "",
          parentId: "",
          priority: "medium",
          status: "todo",
          ...deadline.value,
          startDate: "",
          estimatedHours: 0,
          tags: [],
          checklist: [],
          dependencies: [],
          collaborators: [],
          recurrence: "none",
        },
      });
      if (
        !alive.current ||
        generation !== client.generation ||
        current.current.selectedId !== target
      )
        return;
      retireDue();
      retireTime();
      retireInstant();
      retireOwner();
      retireReviewer();
      retireSelected(target);
      await refresh();
      await w.refresh();
    } catch (e) {
      if (alive.current) w.setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  async function close(state: string) {
    if (!selected || busy.current) return;
    busy.current = true;
    const generation = client.generation;
    const target = selected.id;
    const valid = () =>
      alive.current &&
      generation === client.generation &&
      current.current.root === root &&
      current.current.selectedId === target;
    try {
      await client.request(root + "/" + selected.id, "PATCH", {
        expectedVersion: selected.version,
        state,
        reason,
      });
      if (!valid()) return;
      retireReason();
      retireSelected(target);
      await refresh();
    } catch (e) {
      if (valid()) w.setError((e as Error).message);
    } finally {
      busy.current = false;
    }
  }
  return (
    <View>
      <Text style={styles.heading}>Published work and intake</Text>
      <Button
        title="Published work briefing"
        onPress={() =>
          void client
            .request<NonNullable<typeof briefing>>(
              `/companies/${w.company}/communication/briefing`,
            )
            .then(setBriefing)
            .catch((e) => w.setError(e.message))
        }
      />
      {briefing && (
        <Text>
          {briefing.visibleTaskCount} visible tasks ·{" "}
          {briefing.visibleOpenRequestCount} open requests. {briefing.notice}
        </Text>
      )}
      {items.map((item) => (
        <View key={item.id} style={styles.message}>
          <Text>
            {item.title} · {item.state}
          </Text>
          <Text>{item.summary}</Text>
          {!["resolved", "cancelled"].includes(item.state) &&
            w.work?.me.role !== "viewer" && (
              <Button
                title="Review intake action"
                onPress={() => {
                  setSelectedId(item.id);
                }}
              />
            )}
        </View>
      ))}
      {selected && (
        <View style={styles.message}>
          <Text>
            {selected.title} · version {selected.version}
          </Text>
          {selected.state === "open" &&
            (["founder", "ceo", "admin"].includes(w.work?.me.role ?? "") ||
              (w.work?.me.role === "head" &&
                selected.departmentId === w.work.me.departmentId)) && (
              <>
                <PersonPicker
                  departmentNames={Object.fromEntries(
                    (w.work?.departments ?? []).map((d) => [d.id, d.name]),
                  )}
                  label="Accountable owner"
                  people={w.work?.people ?? []}
                  value={owner}
                  onChange={(id) => {
                    setOwner(id);
                    setReviewer("");
                  }}
                />
                <PersonPicker
                  departmentNames={Object.fromEntries(
                    (w.work?.departments ?? []).map((d) => [d.id, d.name]),
                  )}
                  label="Independent reviewer"
                  people={w.work?.people ?? []}
                  value={reviewer}
                  excludeIds={[owner]}
                  allowNone
                  onChange={setReviewer}
                />
                <DeadlinePicker
                  date={due}
                  time={time}
                  timezone={w.work?.company.timezone ?? "Asia/Kolkata"}
                  onChange={(v) => {
                    setDue(v.date);
                    setTime(v.time);
                    setInstant("");
                  }}
                />
                {!!due && !!deadline.error && (
                  <Text accessibilityRole="alert">{deadline.error}</Text>
                )}
                {deadline.choices.map((choice) => (
                  <Button
                    key={choice}
                    title={choice}
                    onPress={() => setInstant(choice)}
                  />
                ))}
                <Button
                  title="Assign through task workflow"
                  disabled={!deadline.value}
                  onPress={() => void assign()}
                />
              </>
            )}
          <TextInput
            accessibilityLabel="Intake outcome reason"
            style={styles.input}
            placeholder="Outcome reason"
            value={reason}
            onChangeText={setReason}
          />
          <Button
            title="Resolve after task acceptance"
            disabled={!reason}
            onPress={() => void close("resolved")}
          />
          <Button
            title="Cancel with reason"
            disabled={!reason}
            onPress={() => void close("cancelled")}
          />
          <Button
            title="Close intake review"
            onPress={() => setSelectedId("")}
          />
        </View>
      )}
    </View>
  );
}
