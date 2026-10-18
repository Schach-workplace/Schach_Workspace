import { Action, ui } from "../ConnectUI";
import { useRef, useState } from "react";
import { Redirect } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { client } from "../client";
import { configuredServer, serverHost } from "../serverConfig";
import { useWorkspace } from "../Workspace";
import LoginFrame from "../LoginFrame";
import { colors, typeScale } from "../mobileTheme";
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
  const [visible, setVisible] = useState(false);
  const [verification, setVerification] = useState(false);
  const pending = useRef(false);
  if (w.session) return <Redirect href="/(tabs)/chats" />;
  return (
    <LoginFrame>
      {custom && <Text style={s.label}>Company server</Text>}
      {custom ? (
        <TextInput
          style={ui.input}
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
      <View>
        <Text style={s.label}>Email</Text>
        <TextInput
          style={ui.input}
          accessibilityLabel="Email"
          placeholder="you@company.com"
          autoComplete="username"
          textContentType="username"
          autoCorrect={false}
          editable={!busy}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
      </View>
      <View>
        <Text style={s.label}>Password</Text>
        <TextInput
          style={ui.input}
          accessibilityLabel="Password"
          placeholder="Your password"
          autoComplete="current-password"
          textContentType="password"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
          secureTextEntry={!visible}
          value={password}
          onChangeText={setPassword}
        />
        <Action
          title={visible ? "Hide password" : "Show password"}
          onPress={() => setVisible(!visible)}
        />
      </View>
      {!verification && (
        <Action
          title="Use authenticator or recovery code"
          onPress={() => setVerification(true)}
        />
      )}
      {verification && (
        <View style={s.security}>
          <Text style={s.label}>Additional verification</Text>
          <Text style={s.hint}>
            If your account uses two-step verification, enter an authenticator
            code or a recovery code.
          </Text>
          <Text style={s.label}>Authenticator code</Text>
          <TextInput
            style={ui.input}
            accessibilityLabel="Authenticator code"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            editable={!busy}
            placeholder="6-digit code"
            keyboardType="number-pad"
            value={code}
            maxLength={6}
            onChangeText={setCode}
          />
          <Text style={s.label}>Recovery code</Text>
          <TextInput
            style={ui.input}
            accessibilityLabel="Recovery code"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            editable={!busy}
            placeholder="Single-use recovery code"
            value={recovery}
            maxLength={32}
            onChangeText={setRecovery}
          />
        </View>
      )}
      <Action
        primary
        disabled={busy}
        title={busy ? "Signing in…" : "Sign in"}
        onPress={() => {
          if (pending.current) return;
          pending.current = true;
          setBusy(true);
          void w
            .signIn(server, email, password, code, recovery)
            .then(() => {
              setPassword("");
              setCode("");
              setRecovery("");
            })
            .catch((e) => w.setError(e.message))
            .finally(() => {
              pending.current = false;
              setBusy(false);
            });
        }}
      />
      {!!w.error && (
        <Text style={ui.error} accessibilityRole="alert">
          {w.error}
        </Text>
      )}
    </LoginFrame>
  );
}
const serverStyle = {
  fontSize: typeScale.support,
  color: colors.secondary,
  marginBottom: 6,
};
const s = StyleSheet.create({
  label: { fontSize: typeScale.support, color: colors.text, fontWeight: "600" },
  hint: {
    fontSize: typeScale.support,
    color: colors.secondary,
    lineHeight: 21,
    marginTop: 6,
  },
  security: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: 4,
  },
});
