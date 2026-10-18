import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  View,
  type KeyboardMetrics,
} from "react-native";
/** Keyboard coordinates are screen-relative; this frame sits below company and
 * route headers. Android navigation can move it after its initial layout. */
export default function KeyboardFrame({
  children,
  enabled = true,
}: {
  children: ReactNode;
  enabled?: boolean;
}) {
  const ref = useRef<View>(null);
  const keyboard = useRef<KeyboardMetrics | null>(null);
  const [offset, setOffset] = useState(0);
  const [bottom, setBottom] = useState(0);
  const measure = useCallback(() => {
    const event = keyboard.current;
    if (Platform.OS === "ios") {
      ref.current?.measureInWindow((_x, y) => setOffset(y));
    } else {
      // Android's edge-to-edge root reports keyboard screenY in root/page
      // coordinates. measureInWindow includes a different viewport offset.
      ref.current?.measure((_x, _y, _width, height, _pageX, pageY) => {
        if (event && keyboard.current === event)
          setBottom(Math.max(pageY + height - event.screenY, 0));
      });
    }
  }, []);
  useEffect(() => {
    if (Platform.OS !== "android") return;
    keyboard.current = Keyboard.metrics() ?? null;
    measure();
    const show = Keyboard.addListener("keyboardDidShow", (event) => {
      keyboard.current = event.endCoordinates;
      measure();
    });
    const hide = Keyboard.addListener("keyboardDidHide", () => {
      keyboard.current = null;
      setBottom(0);
    });
    return () => {
      keyboard.current = null;
      show.remove();
      hide.remove();
    };
  }, [measure]);
  return (
    <View ref={ref} style={{ flex: 1 }} onLayout={measure}>
      {Platform.OS === "ios" ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          enabled={enabled}
          behavior="padding"
          keyboardVerticalOffset={offset}
        >
          {children}
        </KeyboardAvoidingView>
      ) : (
        <View style={{ flex: 1, paddingBottom: enabled ? bottom : 0 }}>
          {children}
        </View>
      )}
    </View>
  );
}
