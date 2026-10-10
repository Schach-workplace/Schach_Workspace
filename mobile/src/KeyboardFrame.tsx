import { useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
/** RN keyboard coordinates are screen-relative, but the nested layout is local.
 * Measuring the parent origin includes company headers and safe area insets.
 */
export default function KeyboardFrame({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const ref = useRef<View>(null);
  const [offset, setOffset] = useState(0);
  return (
    <View
      ref={ref}
      style={{ flex: 1 }}
      onLayout={() => ref.current?.measureInWindow((_x, y) => setOffset(y))}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        enabled={enabled}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={offset}
      >
        {children}
      </KeyboardAvoidingView>
    </View>
  );
}
