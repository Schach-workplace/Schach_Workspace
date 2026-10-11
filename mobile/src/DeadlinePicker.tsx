import { useState, useRef, useLayoutEffect, useCallback } from "react";
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
  retainWhilePending = false,
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
  retainWhilePending?: boolean;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const [error, setError] = useState("");
  const [pendingChoice, setPendingChoice] = useState<{
    date: string;
    time: string;
  } | null>(null);
  const current = useRef({
    mode,
    date,
    time,
    timezone,
    onChange,
    retainWhilePending,
  });
  useLayoutEffect(() => {
    current.current = {
      mode,
      date,
      time,
      timezone,
      onChange,
      retainWhilePending,
    };
  });
  // Android ignores callback replacements on an already-open dialog. Stable
  // callbacks read the current authored context without reopening/resetting it.
  const dismiss = useCallback(() => setMode(null), []);
  const select = useCallback((_event: unknown, selected: Date) => {
    const context = current.current;
    try {
      const fields = pickerFields(selected, context.timezone);
      const next = {
        date: context.mode === "date" ? fields.date : context.date,
        time: context.mode === "time" ? fields.time : context.time,
      };
      if (context.retainWhilePending) setPendingChoice(next);
      else context.onChange(next);
      if (Platform.OS === "android") setMode(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  let value = new Date();
  try {
    value = pickerInstant(
      pendingChoice?.date || date || companyDate(value, timezone),
      mode === "time" ? (pendingChoice?.time ?? time) : "12:00",
      timezone,
    );
  } catch {
    /* Explicit text/DST fields below remain available for correction. */
  }
  function open(next: "date" | "time") {
    try {
      pickerFields(value, timezone);
      setError("");
      setPendingChoice(null);
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
      {mode &&
        (!pickerDisabled || (retainWhilePending && !disabled)) &&
        Platform.OS !== "web" && (
          <DateTimePicker
            value={value}
            mode={mode}
            timeZoneName={timezone}
            onDismiss={dismiss}
            onValueChange={select}
          />
        )}
      {mode && !retainWhilePending && Platform.OS === "ios" && (
        <Action title="Done with picker" onPress={() => setMode(null)} />
      )}
      {retainWhilePending && pendingChoice && (
        <View>
          <Text>
            Selected {timeOnly ? pendingChoice.time : pendingChoice.date}
          </Text>
          <Action
            title={"Confirm selected " + label}
            disabled={pickerDisabled || disabled}
            onPress={() => {
              if (pickerDisabled || disabled) return;
              onChange(pendingChoice);
              setPendingChoice(null);
              setMode(null);
            }}
          />
          <Action
            title={"Discard selected " + label}
            onPress={() => {
              setPendingChoice(null);
              setMode(null);
            }}
          />
        </View>
      )}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </View>
  );
}
