import { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Action, ui } from "./ConnectUI";
import { companyDate } from "./workDates";
import { pickerFields, pickerInstant } from "./deadlinePickerModel";
export default function DeadlinePicker({
  date,
  time,
  timezone,
  onChange,
  disabled = false,
}: {
  date: string;
  time: string;
  timezone: string;
  onChange: (v: { date: string; time: string }) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const [error, setError] = useState("");
  let value = new Date();
  try {
    value = pickerInstant(
      date || companyDate(value, timezone),
      mode === "time" ? time : "12:00",
      timezone,
    );
  } catch {
    /* Explicit text/DST fields below remain available for correction. */
  }
  function open(next: "date" | "time") {
    try {
      pickerFields(value, timezone);
      setError("");
      setMode(next);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <View>
      <Text>Company deadline · {timezone}</Text>
      <TextInput
        accessibilityLabel="Due date"
        placeholder="YYYY-MM-DD"
        value={date}
        editable={!disabled}
        onChangeText={(date) => onChange({ date, time })}
        style={ui.input}
      />
      <TextInput
        accessibilityLabel="Deadline time"
        placeholder="HH:mm · leave empty for all day"
        value={time}
        editable={!disabled}
        maxLength={5}
        onChangeText={(time) => onChange({ date, time })}
        style={ui.input}
      />
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        {Platform.OS !== "web" && (
          <>
            <Action
              title="Choose calendar date"
              disabled={disabled}
              onPress={() => open("date")}
            />
            <Action
              title="Choose deadline time"
              disabled={disabled}
              onPress={() => open("time")}
            />
          </>
        )}
        <Action
          title={time ? "Use all-day deadline" : "Use timed deadline"}
          disabled={disabled}
          onPress={() => onChange({ date, time: time ? "" : "16:00" })}
        />
      </View>
      {mode && Platform.OS !== "web" && (
        <DateTimePicker
          value={value}
          mode={mode}
          timeZoneName={timezone}
          onDismiss={() => setMode(null)}
          onValueChange={(_event, value) => {
            try {
              const fields = pickerFields(value, timezone);
              onChange({
                date: mode === "date" ? fields.date : date,
                time: mode === "time" ? fields.time : time,
              });
              if (Platform.OS === "android") setMode(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        />
      )}
      {mode && Platform.OS === "ios" && (
        <Action title="Done with picker" onPress={() => setMode(null)} />
      )}{" "}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
