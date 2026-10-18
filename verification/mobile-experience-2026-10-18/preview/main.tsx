import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text, View } from "react-native";
import Login from "../../../mobile/src/app/login";
import ModuleDirectory from "../../../mobile/src/ModuleDirectory";
import WorkspaceFrame from "../../../mobile/src/WorkspaceFrame";
import { ui } from "../../../mobile/src/ConnectUI";
const params = new URLSearchParams(location.search);
const view = params.get("view") || "login";
const company = params.has("long")
  ? "Fictional Northern Engineering and Employee Development Company"
  : "Fictional North";
createRoot(document.getElementById("root")!).render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }}
  >
    {view === "login" ? (
      <Login />
    ) : (
      <WorkspaceFrame
        userName={
          params.has("long")
            ? "Fictional Member With A Longer Display Name"
            : "Fictional member"
        }
        companies={[
          { id: "a", name: company },
          { id: "b", name: "Fictional South" },
        ]}
        company="a"
        scopeKey="fictional"
        foreground
        onSwitchCompany={() => {}}
        onDismissError={() => {}}
      >
        {view === "modules" ? (
          <ModuleDirectory
            workReady
            role="manager"
            onOpen={() => {}}
            onAccount={() => {}}
          />
        ) : (
          <View style={ui.section}>
            <Text style={ui.title}>Your current work</Text>
            <Text style={ui.body}>
              This read-only layout fixture uses fictional content. No business
              data is fetched.
            </Text>
          </View>
        )}
      </WorkspaceFrame>
    )}
  </SafeAreaProvider>,
);
