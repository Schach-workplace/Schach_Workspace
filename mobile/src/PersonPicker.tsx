import { useEffect, useEffectEvent, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import { selectablePeople, type SelectablePerson } from "./personSelection";
export default function PersonPicker({
  people,
  value,
  excludeIds = [],
  allowNone = false,
  includeViewers = false,
  onChange,
  label = "Person",
  disabled = false,
  authorized = true,
  departmentNames = {},
}: {
  people: SelectablePerson[];
  value: string;
  excludeIds?: string[];
  allowNone?: boolean;
  includeViewers?: boolean;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  authorized?: boolean;
  departmentNames?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = authorized
    ? selectablePeople(people, excludeIds, "", includeViewers)
    : [];
  const selected = available.find((p) => p.id === value);
  const valid = !!selected;
  const invalidate = useEffectEvent(() => onChange(""));
  useEffect(() => {
    if (authorized && value && !valid) invalidate();
  }, [value, valid, authorized]);
  return (
    <View>
      <Action
        title={label + ": " + (selected?.name ?? "Choose person")}
        disabled={disabled || !authorized}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
      />
      {open && (
        <Sheet
          keyboard
          scroll={false}
          title={"Choose " + label.toLowerCase()}
          onClose={() => setOpen(false)}
        >
          <TextInput
            autoFocus
            accessibilityLabel={"Find " + label.toLowerCase()}
            value={query}
            onChangeText={setQuery}
            placeholder="Search authorized people"
            style={ui.input}
          />
          {authorized && allowNone && (
            <Action
              title="No reviewer"
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
            />
          )}
          <FlatList
            data={
              authorized
                ? selectablePeople(people, excludeIds, query, includeViewers)
                : []
            }
            keyExtractor={(p) => p.id}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={<Text>No authorized people match.</Text>}
            renderItem={({ item: p }) => (
              <Action
                title={
                  p.name +
                  " · " +
                  p.role +
                  (p.departmentId && departmentNames[p.departmentId]
                    ? " · " + departmentNames[p.departmentId]
                    : "")
                }
                selected={p.id === value}
                onPress={() => {
                  onChange(p.id);
                  setOpen(false);
                }}
              />
            )}
          />
        </Sheet>
      )}
    </View>
  );
}
