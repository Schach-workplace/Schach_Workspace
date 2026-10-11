import DeadlinePicker from "./DeadlinePicker";
import { companyDate } from "./workDates";
import { useState } from "react";
import { FlatList, Text, TextInput, View } from "react-native";
import { Action, Sheet, ui } from "./ConnectUI";
export function ReportField({
  label,
  value,
  onChange,
  disabled = false,
  pickerDisabled = disabled,
  calendar,
  timezone = "Asia/Kolkata",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  pickerDisabled?: boolean;
  calendar?: "date" | "time";
  timezone?: string;
}) {
  if (calendar) {
    let date = "";
    try {
      date = companyDate(new Date(), timezone);
    } catch {
      date = companyDate(new Date(), "UTC");
    }
    return (
      <DeadlinePicker
        label={label}
        dateLabel={label}
        timeLabel={label}
        date={calendar === "date" ? value : date}
        time={calendar === "time" ? value : ""}
        timezone={timezone}
        disabled={disabled}
        pickerDisabled={pickerDisabled}
        retainWhilePending
        calendarOnly={calendar === "date"}
        timeOnly={calendar === "time"}
        onChange={(next) =>
          onChange(calendar === "date" ? next.date : next.time)
        }
      />
    );
  }
  return (
    <View>
      <Text>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        style={ui.input}
      />
    </View>
  );
}
export function ReportChoice({
  label,
  value,
  options,
  onChange,
  authorized = true,
  disabled = false,
}: {
  label: string;
  value: string;
  options: { id: string; name: string }[];
  onChange: (id: string) => void;
  authorized?: boolean;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <Action
        title={
          label +
          ": " +
          (authorized
            ? (options.find((o) => o.id === value)?.name ?? "Choose")
            : "Checking access")
        }
        disabled={disabled || !authorized}
        onPress={() => setOpen(true)}
      />
      {open && (
        <Sheet title={label} onClose={() => setOpen(false)} scroll={false}>
          <FlatList
            data={authorized ? options : []}
            keyExtractor={(o) => o.id}
            renderItem={({ item }) => (
              <Action
                title={item.name}
                selected={value === item.id}
                disabled={disabled || !authorized}
                onPress={() => {
                  onChange(item.id);
                  setOpen(false);
                }}
              />
            )}
            ListEmptyComponent={<Text>Checking current choices…</Text>}
          />
        </Sheet>
      )}
    </View>
  );
}
