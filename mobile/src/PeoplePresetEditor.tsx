import { useState } from "react";
import { Text, View } from "react-native";
import Page from "./PeoplePage";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import {
  usePeopleRead,
  usePeopleMutation,
  emptyMembership,
  type PeopleContext,
  type PeoplePreset,
} from "./people";
import {
  DiscardPeopleAttempt,
  PeopleField,
  PeopleMembershipFields,
} from "./PeopleControls";
import type { TaskTemplateView } from "../../shared/business/types";
export default function PeoplePresetEditor() {
  const context = usePeopleRead<PeopleContext>("/people/context");
  const list = usePeopleRead<{ items: PeoplePreset[] }>("/people/presets");
  const templates = usePeopleRead<{ templates: TaskTemplateView[] }>(
    "/task-templates",
  );
  const [draft, setDraft, retire] = useRamInput(
    "$people-preset",
    "draft",
    () => ({
      id: "",
      version: 1,
      name: "",
      description: "",
      archived: false,
      membership: emptyMembership(),
      templateIds: [] as string[],
    }),
  );
  const action = usePeopleMutation("$people-preset");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const ready = context.ready && list.ready;
  const locked = !!action.attempt || !ready;
  function load(p?: PeoplePreset) {
    action.abandon();
    setDraft(
      p
        ? { ...p }
        : {
            id: "",
            version: 1,
            name: "",
            description: "",
            archived: false,
            membership: emptyMembership(),
            templateIds: [],
          },
    );
    setSaved(false);
  }
  async function save() {
    try {
      await action.execute(
        action.attempt?.target?.path ??
          "/people/presets" + (draft.id ? "/" + draft.id : ""),
        action.attempt?.payload ?? {
          name: draft.name,
          description: draft.description,
          membership: draft.membership,
          templateIds: draft.templateIds,
          archived: draft.archived,
          ...(draft.id ? { expectedVersion: draft.version } : {}),
        },
        action.attempt?.target?.method ?? (draft.id ? "PATCH" : "POST"),
        () => {
          retire(draft);
          setSaved(true);
        },
      );
      list.retry();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <Page>
      <Text accessibilityRole="header">Onboarding presets</Text>
      {!ready && <Text>Checking current preset access…</Text>}
      <Text accessibilityLiveRegion="polite">{error || action.error}</Text>
      {saved && ready && (
        <Text>Preset saved. Select it to inspect its current version.</Text>
      )}
      {ready && (
        <>
          <Action
            title="New preset"
            disabled={!!action.attempt}
            onPress={() => load()}
          />
          {list.data?.items.map((p) => (
            <Action
              key={p.id}
              title={p.name + (p.archived ? " · Archived" : "")}
              disabled={!!action.attempt}
              onPress={() => load(p)}
            />
          ))}
        </>
      )}
      <PeopleField
        label="Preset name"
        value={draft.name}
        onChange={(name) => setDraft({ ...draft, name })}
        disabled={locked}
      />
      <PeopleField
        label="Preset description"
        value={draft.description}
        onChange={(description) => setDraft({ ...draft, description })}
        disabled={locked}
        multiline
      />
      <PeopleMembershipFields
        value={draft.membership}
        onChange={(membership) => setDraft({ ...draft, membership })}
        context={context.data}
        disabled={locked}
      />
      <Text>Optional starting task templates</Text>
      {templates.ready &&
        templates.data?.templates
          .filter((t) => t.kind === "task" && !t.archived)
          .map((t) => (
            <Action
              key={t.id}
              title={t.name}
              selected={draft.templateIds.includes(t.id)}
              disabled={locked}
              onPress={() =>
                setDraft({
                  ...draft,
                  templateIds: draft.templateIds.includes(t.id)
                    ? draft.templateIds.filter((id) => id !== t.id)
                    : [...draft.templateIds, t.id],
                })
              }
            />
          ))}
      {draft.id && (
        <Action
          title="Archive this preset"
          selected={draft.archived}
          disabled={locked}
          onPress={() => setDraft({ ...draft, archived: !draft.archived })}
        />
      )}
      <View>
        <Action
          title={
            action.attempt
              ? "Retry the same submission"
              : "Save reviewed preset"
          }
          primary
          disabled={
            !ready || action.busy || (!action.attempt && !draft.name.trim())
          }
          onPress={() => void save()}
        />
        {action.attempt && (
          <DiscardPeopleAttempt
            disabled={action.busy}
            onDiscard={() => {
              action.abandon();
              setError("");
            }}
          />
        )}
      </View>
    </Page>
  );
}
