import { lazy, Suspense } from "react";
import { isRunningInExpoGo } from "expo";
import { Text } from "react-native";

// Expo Go does not contain LiveKit's native WebRTC modules. Never evaluate
// either module there, including when the root active-call host is mounted.
let nativeCalls: Promise<typeof import("./Calls")> | undefined;
function loadNativeCalls() {
  return (nativeCalls ??= (async () => {
    const { registerGlobals } = await import("@livekit/react-native");
    registerGlobals();
    return import("./Calls");
  })());
}
const NativeCalls = lazy(loadNativeCalls);
const NativeActiveCall = lazy(async () => ({
  default: (await loadNativeCalls()).ActiveCall,
}));

export function ActiveCall() {
  if (isRunningInExpoGo()) return null;
  return (
    <Suspense fallback={null}>
      <NativeActiveCall />
    </Suspense>
  );
}

export default function Calls(props: { focused?: boolean }) {
  if (isRunningInExpoGo())
    return (
      <Text>
        Calls are unavailable in Expo Go. You can test tasks, finance and chat
        here. Audio and video calls require a Workspace development or release
        build.
      </Text>
    );
  return (
    <Suspense fallback={<Text>Loading calls…</Text>}>
      <NativeCalls {...props} />
    </Suspense>
  );
}
