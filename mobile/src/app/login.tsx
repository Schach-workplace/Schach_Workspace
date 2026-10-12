import { Action } from "../ConnectUI";
import { useState } from "react";
import { Redirect } from "expo-router";
import { Text, TextInput, View } from "react-native";
import { client } from "../client";
import { configuredServer, serverHost } from "../serverConfig";
import { useWorkspace, styles } from "../Workspace";
export default function Login() {
  const w = useWorkspace();
  // Distribution builds sign in to the configured server; only development
  // builds may type a server (or override the configured one).
  const configured = configuredServer();
  const dev = typeof __DEV__ !== "undefined" && __DEV__;
  const [custom, setCustom] = useState(!configured);
  const [endpoint, setEndpoint] = useState(client.endpoint || configured);
  const server = custom ? endpoint : configured;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState(false);
  if (w.session) return <Redirect href="/(tabs)/chats" />;
  return (
    <View style={[styles.root, { paddingTop: 55 }]}>
      <Text style={styles.heading}>Workspace</Text>
      {custom ? (
        <TextInput
          style={styles.input}
          accessibilityLabel="Company server"
          placeholder="https://workspace.example.in"
          autoCapitalize="none"
          value={endpoint}
          onChangeText={setEndpoint}
        />
      ) : (
        <Text style={serverStyle}>{serverHost(configured)}</Text>
      )}
      {!custom && dev && (
        <Text
          accessibilityRole="link"
          style={[serverStyle, { color: "#c2410c" }]}
          onPress={() => setCustom(true)}
        >
          Use a different server
        </Text>
      )}
      <TextInput
        style={styles.input}
        accessibilityLabel="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel="Authenticator code"
        placeholder="Authenticator code, if enabled"
        keyboardType="number-pad"
        value={code}
        maxLength={6}
        onChangeText={setCode}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel="Recovery code"
        placeholder="Or a single-use recovery code"
        value={recovery}
        maxLength={32}
        onChangeText={setRecovery}
      />
      <Action
        primary
        disabled={busy}
        title={busy ? "Signing in…" : "Sign in"}
        onPress={() => {
          setBusy(true);
          void w
            .signIn(server, email, password, code, recovery)
            .then(() => {
              setPassword("");
              setCode("");
              setRecovery("");
            })
            .catch((e) => w.setError(e.message))
            .finally(() => setBusy(false));
        }}
      />
      {!!w.error && <Text accessibilityRole="alert">{w.error}</Text>}
    </View>
  );
}
const serverStyle = { fontSize: 13, color: "#6b6357", marginBottom: 6 };
