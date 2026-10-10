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
  pickerDisabled = disabled,
  label = "Company deadline",
  dateLabel = "Due date",
  timeLabel = "Deadline time",
  calendarOnly = false,
  timeOnly = false,
}: {
  date: string;
  time: string;
  timezone: string;
  onChange: (v: { date: string; time: string }) => void;
  disabled?: boolean;
  pickerDisabled?: boolean;
  label?: string;
  dateLabel?: string;
  timeLabel?: string;
  calendarOnly?: boolean;
  timeOnly?: boolean;
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
      <Text>
        {label} · {timezone}
      </Text>
      {!timeOnly && (
        <TextInput
          accessibilityLabel={dateLabel}
          placeholder="YYYY-MM-DD"
          value={date}
          editable={!disabled}
          onChangeText={(date) => onChange({ date, time })}
          style={ui.input}
        />
      )}
      {!calendarOnly && (
        <TextInput
          accessibilityLabel={timeLabel}
          placeholder="HH:mm · leave empty for all day"
          value={time}
          editable={!disabled}
          maxLength={5}
          onChangeText={(time) => onChange({ date, time })}
          style={ui.input}
        />
      )}
      <View style={[ui.row, { flexWrap: "wrap" }]}>
        {Platform.OS !== "web" && (
          <>
            {!timeOnly && (
              <Action
                title={
                  dateLabel === "Due date"
                    ? "Choose calendar date"
                    : "Choose " + dateLabel
                }
                disabled={pickerDisabled}
                onPress={() => open("date")}
              />
            )}
            {!calendarOnly && (
              <Action
                title={
                  timeLabel === "Deadline time"
                    ? "Choose deadline time"
                    : "Choose " + timeLabel
                }
                disabled={pickerDisabled}
                onPress={() => open("time")}
              />
            )}
          </>
        )}
        {!calendarOnly && !timeOnly && (
          <Action
            title={time ? "Use all-day deadline" : "Use timed deadline"}
            disabled={disabled}
            onPress={() => onChange({ date, time: time ? "" : "16:00" })}
          />
        )}
      </View>
      {mode && !pickerDisabled && Platform.OS !== "web" && (
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
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
