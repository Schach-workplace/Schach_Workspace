import PeopleProjection from "./PeopleProjection";
import { useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import {
  sessionEffectCopy,
  type MembershipDefaults,
  type PeopleContext,
  type SessionEffect as Effect,
} from "./people";
export function PeopleField({
  label,
  value,
  onChange,
  secret = false,
  disabled = false,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  secret?: boolean;
  disabled?: boolean;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={secret}
        editable={!disabled}
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize={secret ? "none" : "sentences"}
        multiline={multiline}
        style={ui.input}
      />
    </View>
  );
}
export function PeopleChoice({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [triggerHeight, setTriggerHeight] = useState(0);
  return (
    <>
      <View
        onLayout={(e) => {
          if (!disabled) setTriggerHeight(e.nativeEvent.layout.height);
        }}
        style={
          disabled && triggerHeight > 0
            ? { height: triggerHeight, overflow: "hidden" }
            : undefined
        }
      >
        <Action
          title={
            label +
            ": " +
            ((!disabled
              ? options.find((x) => x.id === value)?.name
              : undefined) ??
              (disabled ? "Checking" : "Choose a current option"))
          }
          disabled={disabled}
          onPress={() => {
            setQuery("");
            setOpen(true);
          }}
        />
      </View>
      {open && (
        <Sheet title={label} scroll={false} onClose={() => setOpen(false)}>
          <PeopleField
            label={"Find " + label.toLowerCase()}
            value={query}
            onChange={setQuery}
          />
          <PeopleProjection current={!disabled}>
            <FlatList
              data={options.filter((o) =>
                o.name.toLowerCase().includes(query.toLowerCase()),
              )}
              keyExtractor={(o) => o.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Action
                  disabled={disabled}
                  title={item.name}
                  selected={item.id === value}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                />
              )}
            />
          </PeopleProjection>
        </Sheet>
      )}
    </>
  );
}
export function PeopleMembershipFields({
  value,
  onChange,
  context,
  disabled = false,
  authoredDisabled = false,
}: {
  value: MembershipDefaults;
  onChange: (v: MembershipDefaults) => void;
  context?: PeopleContext;
  disabled?: boolean;
  authoredDisabled?: boolean;
}) {
  const set = (k: keyof MembershipDefaults, v: string | number) =>
    onChange({ ...value, [k]: v });
  return (
    <View>
      <PeopleChoice
        label="Company role"
        value={value.role}
        options={context?.roles.map((r) => ({ id: r, name: r })) ?? []}
        onChange={(v) => set("role", v)}
        disabled={disabled}
      />
      <PeopleChoice
        label="Department"
        value={value.departmentId}
        options={
          context
            ? [{ id: "", name: "No department" }, ...context.departments]
            : []
        }
        onChange={(v) => set("departmentId", v)}
        disabled={disabled}
      />
      <PeopleChoice
        label="Reporting manager"
        value={value.managerId}
        options={
          context
            ? [
                { id: "", name: "No manager" },
                ...context.people.filter((p) => p.active),
              ]
            : []
        }
        onChange={(v) => set("managerId", v)}
        disabled={disabled}
      />
      <PeopleField
        disabled={authoredDisabled}
        label="Title"
        value={value.title}
        onChange={(v) => set("title", v)}
      />
      <PeopleField
        disabled={authoredDisabled}
        label="Weekly capacity"
        value={String(value.capacityHours)}
        onChange={(v) => set("capacityHours", Number(v))}
        numeric
      />
    </View>
  );
}
export function SessionEffect({ effect }: { effect?: Effect }) {
  return (
    <Text>
      {effect?.reauthenticate
        ? sessionEffectCopy
        : "This attestation does not change account sessions."}
    </Text>
  );
}

export function DiscardPeopleAttempt({
  onDiscard,
  disabled = false,
}: {
  onDiscard: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Action
        title="Discard submitted recovery request"
        disabled={disabled}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet
          title="Inspect current records first"
          onClose={() => setOpen(false)}
        >
          <Text>
            The original submission may already have succeeded. Check current
            People records before discarding its exact recovery request.
          </Text>
          <Action
            title="I inspected current records — discard recovery request"
            onPress={() => {
              onDiscard();
              setOpen(false);
            }}
          />
          <Action
            title="Keep recovery request"
            onPress={() => setOpen(false)}
          />
        </Sheet>
      )}
    </>
  );
}
