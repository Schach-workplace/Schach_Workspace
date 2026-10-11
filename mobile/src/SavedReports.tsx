import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useState,
} from "react";
import OrphanReports from "./OrphanReports";
import { Alert, FlatList, Text, View } from "react-native";
import { useWorkspace } from "./Workspace";
import { client } from "./client";
import { Action, ui } from "./ConnectUI";
import { ReportField, ReportChoice } from "./ReportControls";
import { useRamInput } from "./ramInput";
import { clearConversationDrafts } from "./conversationDrafts";
import { useExecutionRead, useExecutionMutation } from "./execution";
import type {
  SavedConfiguration,
  SavedDefinition,
  ReportSchedule,
  ReportScheduleCommit,
} from "../../shared/reports/types";
export default function SavedReports({
  onOpen,
}: {
  onOpen: (id: string) => void;
}) {
  const workspace = useWorkspace();
  const scope = [workspace.company, workspace.session?.user.id].join(":");
  const [created, setCreated] = useState<{
    scope: string;
    definition: SavedDefinition;
  } | null>(null);
  const q = useExecutionRead<{ definitions: SavedDefinition[] }>(
    "/reports/definitions",
  );
  const [selected, setSelected] = useRamInput("$saved-reports", "selected", "");
  const geometryKey = [
    client.endpoint,
    client.generation,
    scope,
    workspace.work?.readBasis,
    workspace.foreground,
    selected,
  ].join(":");
  const [geometry, setGeometry] = useState({ key: "", height: 0 });
  const [formRead, setFormRead] = useState({
    key: "",
    ready: false,
    denied: false,
  });
  const [orphanRead, setOrphanRead] = useState({
    key: "",
    ready: false,
    denied: false,
  });
  const formReadChanged = useCallback(
    (ready: boolean, denied: boolean) => {
      setFormRead({ key: geometryKey, ready, denied });
    },
    [geometryKey],
  );
  const orphanReadChanged = useCallback(
    (ready: boolean, denied: boolean) => {
      setOrphanRead({ key: geometryKey, ready, denied });
    },
    [geometryKey],
  );
  const denied =
    !!q.denied ||
    (formRead.key === geometryKey && formRead.denied) ||
    (orphanRead.key === geometryKey && orphanRead.denied);
  const measuredReady =
    q.ready &&
    formRead.key === geometryKey &&
    formRead.ready &&
    orphanRead.key === geometryKey &&
    orphanRead.ready;
  const holdGeometry =
    !measuredReady &&
    !denied &&
    workspace.foreground &&
    !!workspace.work &&
    geometry.key === geometryKey &&
    geometry.height > 0;
  if (
    geometry.height &&
    (denied ||
      !workspace.foreground ||
      !workspace.work ||
      geometry.key !== geometryKey)
  )
    setGeometry({ key: "", height: 0 });

  // A deliberate drag ends editing even after Android's keyboard is closed,
  // so a later source check cannot scroll back to the obsolete editor focus.
  return (
    <FlatList
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      contentContainerStyle={
        holdGeometry ? { minHeight: geometry.height } : undefined
      }
      onContentSizeChange={(_width, height) => {
        // Independent report reads can finish in different orders. Measure only
        // the fully current structure, never its temporarily hidden disclosures.
        if (measuredReady && !denied && Number.isFinite(height) && height > 0)
          setGeometry((previous) =>
            previous.key === geometryKey && previous.height === height
              ? previous
              : { key: geometryKey, height },
          );
      }}
      data={q.ready ? (q.data?.definitions ?? []) : []}
      keyExtractor={(d) => d.id}
      renderItem={({ item }) => (
        <Action
          title={item.configuration.name + " · " + item.state}
          onPress={() => {
            setCreated(null);
            setSelected(item.id);
          }}
        />
      )}
      ListHeaderComponent={
        <View>
          <Text style={ui.title}>Saved reports</Text>
          <Text>
            Fixed dates or previous completed week/month. Each recipient
            receives independently scoped output.
          </Text>
          <Action
            title="New saved report"
            onPress={() => {
              setCreated(null);
              setSelected("");
            }}
          />
          {q.loading && <Text>Checking definitions…</Text>}
          {q.error && <Text>{q.error}</Text>}
          <OrphanReports onReadState={orphanReadChanged} />
          <DefinitionForm
            key={selected || "new"}
            id={selected}
            onReadState={formReadChanged}
            committed={
              created?.scope === scope && created.definition.id === selected
                ? created.definition
                : undefined
            }
            onCreated={(definition, authored) => {
              setCreated({
                scope,
                definition: { ...definition, configuration: authored },
              });
              setSelected(definition.id);
            }}
            onOpen={onOpen}
          />
        </View>
      }
    />
  );
}
export function DefinitionForm({
  id,
  onCreated,
  onOpen,
  committed,
  onReadState,
}: {
  id: string;
  committed?: SavedDefinition;
  onReadState?: (ready: boolean, denied: boolean) => void;
  onCreated: (
    definition: SavedDefinition,
    authored: SavedConfiguration,
  ) => void;
  onOpen: (id: string) => void;
}) {
  const w = useWorkspace();
  const projects = useExecutionRead<{
    projects: { id: string; name: string }[];
  }>("/projects");
  const form = "$report-definition:" + (id || "new");
  const q = useExecutionRead<{
    definition: SavedDefinition;
    schedule: ReportSchedule | null;
  }>(`/reports/definitions/${encodeURIComponent(id || "none")}`, !!id);
  const people = useExecutionRead<{
    recipients: { id: string; name: string }[];
  }>("/reports/definitions/recipients");
  const [initialized, setInitialized] = useState(!id || !!committed);
  const [config, setConfig, , , prefill] = useRamInput<SavedConfiguration>(
    form,
    "configuration",
    committed?.configuration ?? {
      name: "",
      basis: "task_history_v1",
      filters: { ownerId: "", departmentId: "", projectId: "" },
      periodRule: "previous_month",
      from: "",
      to: "",
      timezonePolicy: "company_at_resolution",
      reportZone: "",
      recipientIds: [w.session?.user.id ?? ""],
    },
  );
  const [basis, setBasis, , , basisPrefill] = useRamInput(form, "basis", {
    definitionVersion: committed?.version ?? 0,
    scheduleVersion: 0,
  });
  const [schedule, setSchedule, , , schedulePrefill] = useRamInput(
    form,
    "schedule",
    {
      weekdays: [1],
      localMinute: "09:00",
      scheduleZone: w.work?.company.timezone ?? "Asia/Kolkata",
    },
  );
  const save = useExecutionMutation(
      form,
      id ? [`/reports/definitions/${id}`] : [],
    ),
    scheduling = useExecutionMutation(
      form + ":schedule",
      id ? [`/reports/definitions/${id}`] : [],
    ),
    generate = useExecutionMutation(
      form + ":generate",
      id ? [`/reports/definitions/${id}`] : [],
    );
  const [review, setReview] = useState(false),
    [error, setError] = useState("");
  const initialize = useEffectEvent(() => {
    if (!initialized && q.ready && q.data) {
      prefill(q.data.definition.configuration);
      basisPrefill({
        definitionVersion: q.data.definition.version,
        scheduleVersion: q.data.schedule?.id ? q.data.schedule.version : 0,
      });
      if (q.data.schedule?.id)
        schedulePrefill({
          weekdays: q.data.schedule.weekdays,
          localMinute: q.data.schedule.localMinute,
          scheduleZone: q.data.schedule.scheduleZone,
        });
      setInitialized(true);
    }
  });
  useEffect(() => {
    if (!initialized && q.ready)
      void Promise.resolve().then(() => initialize());
  }, [initialized, q.ready, q.data]);
  const denied = q.denied || people.denied || projects.denied;
  const purge = useEffectEvent(() => {
    clearConversationDrafts(w.company, w.session?.user.id ?? "", form);
    save.abandon();
    scheduling.abandon();
    generate.abandon();
  });
  useEffect(() => {
    if (denied) void Promise.resolve().then(() => purge());
  }, [denied]);
  const ready =
    initialized && w.foreground && !!w.work && people.ready && (!id || q.ready);
  useLayoutEffect(() => {
    onReadState?.(!!ready && !!projects.ready, !!denied);
  }, [onReadState, ready, projects.ready, denied]);
  const locked = !ready || save.busy || scheduling.busy || generate.busy;
  const authoredDisabled =
    !w.foreground || !w.work || save.busy || scheduling.busy || generate.busy;
  const edit = (patch: Partial<SavedConfiguration>) => {
    setBasis(basis);
    setConfig({ ...config, ...patch });
    setReview(false);
  };
  async function submit(state = "active") {
    try {
      setBasis(basis);
      await save.execute<{ definition: SavedDefinition }>(
        `/reports/definitions${id ? "/" + encodeURIComponent(id) : ""}`,
        save.attempt?.payload ??
          (id
            ? {
                expectedVersion: basis.definitionVersion,
                configuration: config,
                state,
              }
            : { configuration: config }),
        id ? "PATCH" : "POST",
        (r) => {
          setBasis({ ...basis, definitionVersion: r.definition.version });
          if (!id) onCreated(r.definition, config);
          else q.retry();
          setReview(false);
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveSchedule(state = "active") {
    try {
      setBasis(basis);
      await scheduling.execute<{
        definition: SavedDefinition;
        schedule: ReportScheduleCommit;
      }>(
        `/reports/definitions/${encodeURIComponent(id)}/schedule`,
        scheduling.attempt?.payload ?? {
          ...schedule,
          expectedDefinitionVersion: basis.definitionVersion,
          expectedScheduleVersion: basis.scheduleVersion,
          state,
        },
        "PATCH",
        (r) => {
          setBasis({
            definitionVersion: r.definition.version,
            scheduleVersion: r.schedule.version,
          });
          q.retry();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const confirmState = (state: string) =>
    Alert.alert(
      state === "deleted" ? "Delete definition?" : "Pause definition?",
      "Queued, running and ready exports and delivery for this version are cancelled.",
      [
        { text: "Keep", style: "cancel" },
        { text: "Confirm", onPress: () => void submit(state) },
      ],
    );
  if (denied)
    return (
      <Text>
        Definition access changed. Start a new definition using current choices.
      </Text>
    );
  return (
    <View>
      <Text style={ui.title}>
        {id ? "Manage saved report" : "Create saved report"}
      </Text>
      {!ready && <Text>Checking current definition and eligible people…</Text>}
      <ReportField
        label="Report name"
        value={config.name}
        disabled={authoredDisabled}
        onChange={(name) => edit({ name })}
      />
      <ReportChoice
        label="Saved period"
        value={config.periodRule}
        options={[
          { id: "fixed", name: "Fixed dates" },
          { id: "previous_week", name: "Previous completed week" },
          { id: "previous_month", name: "Previous completed month" },
        ]}
        disabled={locked}
        onChange={(periodRule) =>
          edit({
            periodRule: periodRule as SavedConfiguration["periodRule"],
            from: "",
            to: "",
          })
        }
      />
      {config.periodRule === "fixed" && (
        <>
          <ReportField
            label="Saved start date YYYY-MM-DD"
            calendar="date"
            timezone={
              config.timezonePolicy === "explicit"
                ? config.reportZone
                : w.work?.company.timezone
            }
            pickerDisabled={locked}
            value={config.from}
            disabled={authoredDisabled}
            onChange={(from) => edit({ from })}
          />
          <ReportField
            label="Saved end date YYYY-MM-DD"
            calendar="date"
            timezone={
              config.timezonePolicy === "explicit"
                ? config.reportZone
                : w.work?.company.timezone
            }
            pickerDisabled={locked}
            value={config.to}
            disabled={authoredDisabled}
            onChange={(to) => edit({ to })}
          />
        </>
      )}
      <ReportChoice
        label="Saved timezone policy"
        value={config.timezonePolicy}
        options={[
          { id: "company_at_resolution", name: "Company zone at resolution" },
          { id: "explicit", name: "Explicit IANA zone" },
        ]}
        disabled={locked}
        onChange={(timezonePolicy) =>
          edit({
            timezonePolicy:
              timezonePolicy as SavedConfiguration["timezonePolicy"],
            reportZone:
              timezonePolicy === "explicit"
                ? (w.work?.company.timezone ?? "")
                : "",
          })
        }
      />
      {config.timezonePolicy === "explicit" && (
        <ReportField
          label="Saved report timezone"
          value={config.reportZone}
          disabled={authoredDisabled}
          onChange={(reportZone) => edit({ reportZone })}
        />
      )}
      {(["ownerId", "departmentId", "projectId"] as const).map(
        (field, index) => (
          <ReportChoice
            key={field}
            label={["Saved owner", "Saved department", "Saved project"][index]}
            value={config.filters[field]}
            authorized={ready && (index !== 2 || projects.ready)}
            disabled={locked}
            options={[
              { id: "", name: "All authorized sources" },
              ...((index === 0
                ? w.work?.people.filter((p) => p.active)
                : index === 1
                  ? w.work?.departments
                  : projects.data?.projects) ?? []),
            ]}
            onChange={(value) =>
              edit({ filters: { ...config.filters, [field]: value } })
            }
          />
        ),
      )}
      {ready &&
        config.recipientIds.some(
          (id) => !people.data?.recipients.some((p) => p.id === id),
        ) && (
          <Action
            title="Remove unavailable recipients"
            disabled={locked}
            onPress={() =>
              edit({
                recipientIds: config.recipientIds.filter((id) =>
                  people.data?.recipients.some((p) => p.id === id),
                ),
              })
            }
          />
        )}
      {ready &&
        people.data?.recipients.map((p) => (
          <Action
            key={p.id}
            title={"Recipient: " + p.name}
            selected={config.recipientIds.includes(p.id)}
            disabled={locked}
            onPress={() =>
              edit({
                recipientIds: config.recipientIds.includes(p.id)
                  ? config.recipientIds.filter((id) => id !== p.id)
                  : [...config.recipientIds, p.id],
              })
            }
          />
        ))}
      <Action
        title="Review definition"
        disabled={locked || !config.name || !config.recipientIds.length}
        onPress={() => setReview(true)}
      />
      {review && (
        <>
          <Text>
            {config.name} · {config.periodRule.replaceAll("_", " ")} ·{" "}
            {config.recipientIds.length} recipients · expected version{" "}
            {basis.definitionVersion}
          </Text>
          <Action
            title="Confirm saved report"
            primary
            disabled={locked}
            onPress={() => void submit()}
          />
        </>
      )}
      {save.attempt && (
        <Action
          title="Retry same definition save"
          disabled={locked}
          onPress={() => void submit()}
        />
      )}
      {id && (
        <>
          <Action
            title={
              generate.attempt
                ? "Retry same saved generation"
                : "Generate saved report now"
            }
            disabled={locked}
            onPress={() => {
              void generate
                .execute<{ snapshotId: string }>(
                  `/reports/definitions/${encodeURIComponent(id)}/generate`,
                  generate.attempt?.payload ?? {
                    expectedVersion: basis.definitionVersion,
                  },
                  "POST",
                  (r) => onOpen(r.snapshotId),
                )
                .catch((e) => setError(e.message));
            }}
          />
          <Action
            title={
              q.data?.definition.state === "paused"
                ? "Resume definition"
                : "Pause definition"
            }
            disabled={locked}
            onPress={() =>
              q.data?.definition.state === "paused"
                ? void submit("active")
                : confirmState("paused")
            }
          />
          <Action
            title="Delete definition"
            disabled={locked}
            onPress={() => confirmState("deleted")}
          />
          <Text style={ui.title}>In-app delivery schedule</Text>
          <Text>
            Only the latest missed occurrence is delivered. Schedule changes
            cancel outputs from earlier versions.
          </Text>
          {[
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ].map((day, index) => (
            <Action
              key={day}
              title={day}
              selected={schedule.weekdays.includes(index)}
              disabled={locked}
              onPress={() => {
                setBasis(basis);
                setSchedule({
                  ...schedule,
                  weekdays: schedule.weekdays.includes(index)
                    ? schedule.weekdays.filter((x) => x !== index)
                    : [...schedule.weekdays, index].sort(),
                });
              }}
            />
          ))}
          <ReportField
            label="Schedule local time HH:MM"
            calendar="time"
            timezone={schedule.scheduleZone}
            pickerDisabled={locked}
            value={schedule.localMinute}
            disabled={authoredDisabled}
            onChange={(localMinute) => {
              setBasis(basis);
              setSchedule({ ...schedule, localMinute });
            }}
          />
          <ReportField
            label="Schedule timezone"
            value={schedule.scheduleZone}
            disabled={authoredDisabled}
            onChange={(scheduleZone) => {
              setBasis(basis);
              setSchedule({ ...schedule, scheduleZone });
            }}
          />
          <Action
            title={
              scheduling.attempt
                ? "Retry same schedule save"
                : "Confirm delivery schedule"
            }
            primary
            disabled={locked || !schedule.weekdays.length}
            onPress={() => void saveSchedule()}
          />
          <Action
            title="Pause schedule"
            disabled={locked}
            onPress={() => void saveSchedule("paused")}
          />
          {q.ready && q.data?.schedule?.id && (
            <Text>
              Next occurrence{" "}
              {new Date(q.data.schedule.nextOccurrenceUTC).toLocaleString()}
            </Text>
          )}
        </>
      )}
      {(error ||
        save.error ||
        scheduling.error ||
        generate.error ||
        q.error ||
        people.error) && (
        <Text accessibilityRole="alert">
          {error ||
            save.error ||
            scheduling.error ||
            generate.error ||
            q.error ||
            people.error}
        </Text>
      )}
      {q.ready && q.data?.schedule?.failureCode && (
        <Text>
          Delivery needs attention:{" "}
          {q.data.schedule.failureCode.replaceAll("_", " ")} ·{" "}
          {q.data.schedule.failureCount ?? 0} affected recipients · retry
          attempt {q.data.schedule.attemptCount ?? 0}.
        </Text>
      )}
      {id &&
        q.ready &&
        q.data &&
        q.data.definition.version !== basis.definitionVersion && (
          <>
            <Text>
              Definition changed. Authored input remains. Reconcile explicitly
              before a new save.
            </Text>
            <Action
              title="Reconcile current definition"
              onPress={() =>
                Alert.alert(
                  "Replace authored input?",
                  "Use the current definition and version for a new deliberate save.",
                  [
                    { text: "Keep input", style: "cancel" },
                    {
                      text: "Replace",
                      onPress: () => {
                        setConfig(q.data!.definition.configuration);
                        setSchedule(
                          q.data!.schedule?.id
                            ? {
                                weekdays: q.data!.schedule.weekdays,
                                localMinute: q.data!.schedule.localMinute,
                                scheduleZone: q.data!.schedule.scheduleZone,
                              }
                            : {
                                weekdays: [1],
                                localMinute: "09:00",
                                scheduleZone:
                                  w.work?.company.timezone ?? "Asia/Kolkata",
                              },
                        );
                        setBasis({
                          definitionVersion: q.data!.definition.version,
                          scheduleVersion: q.data!.schedule?.id
                            ? q.data!.schedule.version
                            : 0,
                        });
                        save.abandon();
                        scheduling.abandon();
                      },
                    },
                  ],
                )
              }
            />
          </>
        )}
      {(save.attempt || scheduling.attempt) && (
        <Action
          title="Abandon save retry"
          onPress={() =>
            Alert.alert(
              "Abandon unresolved save?",
              "It may already have committed. Recheck before a new save.",
              [
                { text: "Keep retry", style: "cancel" },
                {
                  text: "Abandon",
                  onPress: () => {
                    save.abandon();
                    scheduling.abandon();
                    q.retry();
                  },
                },
              ],
            )
          }
        />
      )}
    </View>
  );
}
