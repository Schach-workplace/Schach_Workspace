import { useState, type ReactNode } from "react";
import { View } from "react-native";
// Retain actual measured layout, never fetched strings or descendants, while pending.
export default function PeopleProjection({
  current,
  children,
}: {
  current: boolean;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  return (
    <View
      onLayout={(event) => {
        if (current) setHeight(event.nativeEvent.layout.height);
      }}
      accessibilityElementsHidden={!current}
      importantForAccessibility={current ? "auto" : "no-hide-descendants"}
      style={{ minHeight: current ? undefined : height }}
    >
      {current ? children : null}
    </View>
  );
}
