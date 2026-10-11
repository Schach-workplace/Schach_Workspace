import {
  useState,
  useEffect,
  useEffectEvent,
  useRef,
  useLayoutEffect,
} from "react";
import { Text, TextInput, View } from "react-native";
import { Page, useWorkspace, styles } from "./Workspace";
import { Action } from "./ConnectUI";
import { client } from "./client";
export default function AccountScreen() {
  const w = useWorkspace();
  const scope = [
    client.generation,
    w.session?.user.id,
    w.company,
    w.foreground,
    w.policyEpoch,
  ].join(":");
  const [disclosedScope, setDisclosedScope] = useState(scope);
  const current = useRef(scope);
  useLayoutEffect(() => {
    current.current = scope;
  }, [scope]);
  async function guardedRequest<T>(
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<T> {
    if (!w.foreground || !w.session)
      throw Error("Check current account access.");
    const captured = scope;
    const value = await client.request<T>(path, method, body);
    if (current.current !== captured) throw Error("Account access changed.");
    return value;
  }
  const [devices, setDevices] = useState<
    { id: string; name: string; active: boolean; platform: string }[]
  >([]);
  const [muted, setMuted] = useState(false);
  const [quietStart, setQuietStart] = useState("");
  const [quietEnd, setQuietEnd] = useState("");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState<string[]>([]);
  const scrubFetched = useEffectEvent(() => {
    setDevices([]);
    setSecret("");
    setRecovery([]);
    setPassword("");
    setCode("");
  });
  useEffect(() => {
    void Promise.resolve().then(() => {
      scrubFetched();
      setDisclosedScope(scope);
    });
  }, [scope]);
  if (!w.foreground || disclosedScope !== scope)
    return (
      <Page>
        <Text>Checking current account access.</Text>
      </Page>
    );
  return (
    <Page>
      <Text style={styles.heading}>Account</Text>{" "}
      <Action
        title="Enable private notification hints"
        onPress={() =>
          void w.registerDevice(true).catch((e) => w.setError(e.message))
        }
      />
      <Action
        title={muted ? "Unmute this company" : "Mute this company"}
        onPress={() =>
          void guardedRequest(
            `/companies/${w.company}/devices/${w.device}/preferences`,
            "POST",
            {
              muted: !muted,
              timezone: w.work?.company.timezone ?? "Asia/Kolkata",
              quietStart,
              quietEnd,
            },
          )
            .then(() => setMuted((v) => !v))
            .catch((e) => w.setError(e.message))
        }
      />
      <TextInput
        style={styles.input}
        accessibilityLabel="Quiet hours start"
        placeholder="Quiet hours start HH:MM"
        value={quietStart}
        onChangeText={setQuietStart}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel="Quiet hours end"
        placeholder="Quiet hours end HH:MM"
        value={quietEnd}
        onChangeText={setQuietEnd}
      />
      <Text>
        Private content is fetched after checking current access and is not
        retained for offline use. Exported files are independent copies.
      </Text>
      <Action
        title="List my registered devices"
        onPress={() =>
          void guardedRequest<{ devices: typeof devices }>("/devices")
            .then((v) => setDevices(v.devices))
            .catch((e) => w.setError(e.message))
        }
      />
      {devices.map((d) => (
        <View key={d.id}>
          <Text>
            {d.name} · {d.platform} · {d.active ? "Active" : "Revoked"}
          </Text>
          {d.active && (
            <Action
              title="Revoke this device session in every company"
              onPress={() =>
                void guardedRequest("/devices/" + d.id + "/revoke", "POST", {})
                  .then(() => {
                    if (d.id === w.device) return w.signOut();
                    setDevices((rows) =>
                      rows.map((row) =>
                        row.id === d.id ? { ...row, active: false } : row,
                      ),
                    );
                  })
                  .catch((e) => w.setError(e.message))
              }
            />
          )}
        </View>
      ))}
      <Text>Authenticator protection</Text>
      <TextInput
        style={styles.input}
        accessibilityLabel="Current password for authenticator"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      <Action
        title="Set up authenticator"
        onPress={() =>
          void guardedRequest<{ secret: string }>("/auth/mfa/setup", "POST", {
            password,
          })
            .then((v) => {
              setSecret(v.secret);
              setPassword("");
            })
            .catch((e) => w.setError(e.message))
        }
      />
      {secret && (
        <View>
          <Text selectable>{secret}</Text>
          <Text>
            Add this secret to your authenticator, then enter a current code.
          </Text>
          <TextInput
            style={styles.input}
            accessibilityLabel="Authenticator confirmation code"
            value={code}
            onChangeText={setCode}
          />
          <Action
            title="Confirm authenticator"
            onPress={() =>
              void guardedRequest<{ recoveryCodes: string[] }>(
                "/auth/mfa/confirm",
                "POST",
                { code },
              )
                .then((v) => {
                  setRecovery(v.recoveryCodes);
                  setSecret("");
                  setCode("");
                })
                .catch((e) => w.setError(e.message))
            }
          />
        </View>
      )}
      {recovery.length > 0 && (
        <View>
          <Text>Store these single-use recovery codes privately.</Text>
          {recovery.map((c) => (
            <Text selectable key={c}>
              {c}
            </Text>
          ))}
          <Action
            title="I stored my recovery codes"
            onPress={() => setRecovery([])}
          />
        </View>
      )}
      <Action
        title="Sign out"
        onPress={() => void w.signOut().catch((e) => w.setError(e.message))}
      />
    </Page>
  );
}
