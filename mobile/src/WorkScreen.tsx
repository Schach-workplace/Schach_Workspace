import { router } from "expo-router";
import DeadlinePicker from "./DeadlinePicker";
import PersonPicker from "./PersonPicker";
import { useRamInput } from "./ramInput";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Page, useWorkspace, type WorkTask } from "./Workspace";
import { Action, Sheet, ui } from "./ConnectUI";
import { client } from "./client";
import {
  companyDate,
  DeadlineChoiceError,
  shiftDate,
  workDeadline,
} from "./workDates";
export default function WorkScreen() {
  const w = useWorkspace();
  // Missing work can mean an outage/background clear, not a confirmed role change.
  const role = w.work?.me.role;
  const [lastRole, setLastRole] = useState(role);
  const [basis, setBasis] = useState(w.work?.readBasis);
  if (w.work?.readBasis && basis !== w.work.readBasis)
    setBasis(w.work.readBasis);
  if (role && role !== lastRole) setLastRole(role);
  return (
    <WorkView
      key={`${w.company}:${w.session?.user.id}:${w.policyEpoch}:${basis}:${lastRole}`}
      w={w}
    />
  );
}
function WorkView({ w }: { w: ReturnType<typeof useWorkspace> }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [creating, setCreating, retireCreating, matchesCreating] = useRamInput(
    "$work",
    "creating",
    false,
  );
  const [title, setTitle, retireTitle, matchesTitle] = useRamInput(
    "$work",
    "title",
    "",
  );
  const [dueDate, setDate, retireDate, matchesDate] = useRamInput(
    "$work",
    "dueDate",
    "",
  );
  const [time, setTime, retireTime, matchesTime] = useRamInput(
    "$work",
    "time",
    "",
  );
  const [instant, setInstant, retireInstant, matchesInstant] = useRamInput(
    "$work",
    "instant",
    "",
  );
  const [reviewer, setReviewer, retireReviewer, matchesReviewer] = useRamInput(
    "$work",
    "reviewer",
    "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const zone = w.work?.company.timezone || "Asia/Kolkata";
  const editable = !!w.work && w.work.me.role !== "viewer";
  const rows = (w.work?.tasks || []).filter(
    (t) =>
      (filter === "all" ||
        (filter === "open"
          ? !["done", "cancelled"].includes(t.status)
          : t.status === "in_review")) &&
      (!query || t.title.toLowerCase().includes(query.toLowerCase())),
  );
  const deadline = useMemo(() => {
    try {
      return {
        value: workDeadline(dueDate, time, zone, instant),
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
  }, [dueDate, time, zone, instant]);
  async function run(action: () => Promise<void>) {
    if (pending.current || !editable) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      if (alive.current) {
        setError((e as Error).message);
        w.setError((e as Error).message);
      }
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function openCreate() {
    if (!dueDate) setDate(companyDate(new Date(), zone));
    setError("");
    setCreating(true);
  }
  function create() {
    if (!title.trim() || !deadline.value || !w.work) return;
    const generation = client.generation;
    void run(async () => {
      await client.request(`/companies/${w.company}/tasks`, "POST", {
        title: title.trim(),
        description: "",
        ownerId: w.session!.user.id,
        departmentId: w.work!.me.departmentId,
        reviewerId: reviewer,
        requiresApproval: !!reviewer,
        ...deadline.value,
        recurrence: "none",
        priority: "medium",
        status: "todo",
        startDate: "",
        estimatedHours: 0,
        tags: [],
        checklist: [],
        dependencies: [],
        collaborators: [],
      });
      if (client.generation !== generation) return;
      if (
        matchesTitle() &&
        matchesDate() &&
        matchesTime() &&
        matchesInstant() &&
        matchesReviewer() &&
        matchesCreating()
      ) {
        retireTitle();
        retireDate();
        retireTime();
        retireInstant();
        retireReviewer();
        retireCreating();
      }
      await w.refresh("tasks");
    });
  }
  function dateLabel(t: WorkTask) {
    return t.deadlineMode === "timed" && t.dueAt
      ? new Intl.DateTimeFormat("en-IN", {
          timeZone: t.dueTimezone || zone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(t.dueAt)) +
          " · " +
          (t.dueTimezone || zone)
      : t.dueDate || "No deadline";
  }
  return (
    <Page scroll={false}>
      <View style={ui.row}>
        <Text style={ui.title}>Work</Text>
        {editable && <Action title="New task" primary onPress={openCreate} />}
      </View>
      <Text style={ui.subtitle}>
        Your commitments and authorized team work · {zone}
      </Text>
      <TextInput
        accessibilityLabel="Search work"
        placeholder="Search work"
        value={query}
        onChangeText={setQuery}
        style={ui.input}
      />
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        {[
          ["all", "All"],
          ["open", "Open"],
          ["review", "Awaiting review"],
        ].map(([id, name]) => (
          <Action
            key={id}
            title={name}
            selected={filter === id}
            onPress={() => setFilter(id)}
          />
        ))}
      </View>
      {!rows.length && (
        <Text style={ui.subtitle}>No work matches these filters.</Text>
      )}
      <FlatList
        data={rows}
        keyExtractor={(t) => t.id}
        renderItem={({ item: t }) => (
          <View
            key={t.id}
            style={{
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: "#e9ebef",
              gap: 8,
            }}
          >
            <Text style={ui.name}>{t.title}</Text>
            <Text style={ui.subtitle}>
              {t.status.replaceAll("_", " ")} · {dateLabel(t)}
            </Text>
            <Action
              title={"Open: " + t.title}
              onPress={() => {
                setError("");
                router.push({
                  pathname: "/task/[id]",
                  params: { id: t.id, company: w.company },
                });
              }}
            />
          </View>
        )}
      />
      {creating && editable && (
        <Sheet
          title="New commitment"
          onClose={() => {
            if (!pending.current) setCreating(false);
          }}
          keyboard
        >
          <Text>
            One owner, a clear deadline and an independent reviewer when
            required.
          </Text>
          <Text>Task title</Text>
          <TextInput
            accessibilityLabel="Task title"
            placeholder="What needs to be delivered?"
            maxLength={240}
            value={title}
            onChangeText={setTitle}
            style={ui.input}
          />
          <DeadlinePicker
            date={dueDate}
            time={time}
            timezone={zone}
            disabled={busy}
            onChange={(v) => {
              setDate(v.date);
              setTime(v.time);
              setInstant("");
            }}
          />
          <View style={[ui.row, { flexWrap: "wrap" }]}>
            {[
              [0, "Today"],
              [1, "Tomorrow"],
              [7, "In a week"],
            ].map(([days, label]) => (
              <Action
                key={label}
                title={String(label)}
                onPress={() => {
                  setDate(
                    shiftDate(companyDate(new Date(), zone), Number(days)),
                  );
                  setInstant("");
                }}
              />
            ))}
          </View>
          {!!deadline.error && (
            <Text accessibilityRole="alert">{deadline.error}</Text>
          )}
          {deadline.choices.map((at) => (
            <Action
              key={at}
              title={
                "Use " +
                new Intl.DateTimeFormat("en", {
                  timeZone: zone,
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZoneName: "shortOffset",
                }).format(new Date(at))
              }
              onPress={() => setInstant(at)}
            />
          ))}
          <PersonPicker
            departmentNames={Object.fromEntries(
              (w.work?.departments ?? []).map((d) => [d.id, d.name]),
            )}
            label="Reviewer"
            people={w.work?.people ?? []}
            value={reviewer}
            excludeIds={[w.session?.user.id ?? ""]}
            allowNone
            onChange={setReviewer}
            disabled={busy}
          />
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
          <Action
            title={busy ? "Creating…" : "Create task"}
            primary
            disabled={busy || !title.trim() || !deadline.value}
            onPress={create}
          />
        </Sheet>
      )}
    </Page>
  );
}
