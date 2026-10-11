import { useState, type ReactNode } from "react";
import { View } from "react-native";
export default function IntelligenceGeometry({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  return (
    <View
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      style={visible ? undefined : { height }}
      onLayout={(e) => {
        const h = e.nativeEvent.layout.height;
        if (visible && Number.isFinite(h))
          setHeight(Math.min(50000, Math.max(0, h)));
      }}
    >
      {visible ? children : null}
    </View>
  );
}
