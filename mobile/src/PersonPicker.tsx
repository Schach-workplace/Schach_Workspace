import { useEffect, useEffectEvent, useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
import { selectablePeople, type SelectablePerson } from "./personSelection";
export default function PersonPicker({
  people,
  value,
  excludeIds = [],
  allowNone = false,
  onChange,
  label = "Person",
  disabled = false,
  departmentNames = {},
}: {
  people: SelectablePerson[];
  value: string;
  excludeIds?: string[];
  allowNone?: boolean;
  onChange: (id: string) => void;
  label?: string;
  disabled?: boolean;
  departmentNames?: Record<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = selectablePeople(people, excludeIds);
  const selected = available.find((p) => p.id === value);
  const valid = !!selected;
  const invalidate = useEffectEvent(() => onChange(""));
  useEffect(() => {
    if (value && !valid) invalidate();
  }, [value, valid]);
  return (
    <View>
      <Action
        title={label + ": " + (selected?.name ?? "Choose person")}
        disabled={disabled}
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
          {allowNone && (
            <Action
              title="No reviewer"
              onPress={() => {
                onChange("");
                setOpen(false);
              }}
            />
          )}
          <FlatList
            data={selectablePeople(people, excludeIds, query)}
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
