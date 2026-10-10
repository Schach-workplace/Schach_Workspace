import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useEffectEvent,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AppState,
  Button,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as SecureStore from "expo-secure-store";
import * as Notifications from "expo-notifications";
import {
  readWorkPages,
  nativeEventScope,
  sameNativeReadBasis,
  confirmedNativeWork,
} from "./readScopes";
import { client, type Session } from "./client";
export interface Conversation {
  peerId?: string;
  public: boolean;
  id: string;
  title: string;
  kind: string;
  archived: boolean;
  version: number;
  forwarding: string;
}
export interface Message {
  conversationId: string;
  id: string;
  body: string;
  sequence: number;
  revision: number;
  removed: boolean;
  senderId: string;
  mediaIds: string[];
  replyToId: string;
  createdAt: string;
}
export interface Person {
  id: string;
  name: string;
  role: string;
  active: boolean;
  departmentId: string;
}
export interface NativeExpense {
  id: string;
  title: string;
  description: string;
  status: string;
  version: number;
  amountMinor: number;
  currency: string;
  createdBy: string;
  departmentId: string;
  vendor: string;
  invoiceNumber: string;
  expenseDate: string;
  receiptExceptionReason: string;
  receipts: { id: string; fileName: string }[];
}
export interface WorkTask {
  attachments: { id: string; fileName: string }[];
  description: string;
  id: string;
  title: string;
  status: string;
  version: number;
  ownerId: string;
  reviewerId: string;
  requiresApproval: boolean;
  deadlineMode: string;
  dueDate: string;
  dueAt: string;
  dueTimezone: string;
  originalDueAt: string;
  originalDueDate: string;
}
export interface WorkData {
  readBasis?: string;
  tasks: WorkTask[];
  people: Person[];
  departments: { id: string; name: string }[];
  expenseCategories: { id: string; name: string; active: boolean }[];
  expenses: NativeExpense[];
  me: Person;
  company: { id: string; timezone: string; currency: string };
}
export interface CallConnection {
  token: string;
  url: string;
  call: { id: string; kind: string; version: number };
}
function useController() {
  const [recordEpoch, setRecordEpoch] = useState(0);
  const seenWorkEvents = useRef(new Set<string>());
  const [policyEpoch, setPolicyEpoch] = useState(0);
  const [session, setSession] = useState<Session | null>(null);
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [device, setDevice] = useState("");
  const [listPages, setListPages] = useState(1);
  const [listMore, setListMore] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [work, setWork] = useState<WorkData | null>(null);
  const [inbox, setInbox] = useState<
    { eventId: string; conversationId: string; read: boolean; kind?: string }[]
  >([]);
  const [foreground, setForeground] = useState(
    AppState.currentState === "active",
  );
  const [restoring, setRestoring] = useState(true);
  const [call, setCall] = useState<CallConnection | null>(null);
  const restoreSequence = useRef(0);
  const currentScope = useRef({
    company,
    sessionId: session?.user.id,
    foreground,
  });
  useLayoutEffect(() => {
    currentScope.current = { company, sessionId: session?.user.id, foreground };
  }, [company, session?.user.id, foreground]);
  function clearPrivate() {
    client.clearGeneration();
    setConversations([]);
    setSelected("");
    setWork(null);
    setInbox([]);
    seenWorkEvents.current.clear();
  }
  async function restore() {
    const sequence = ++restoreSequence.current;
    try {
      const value = await client.request<Session>("/auth/session");
      if (sequence !== restoreSequence.current) return;
      const next = value.companies.some(
        (c) => c.id === currentScope.current.company,
      )
        ? currentScope.current.company
        : (value.companies[0]?.id ?? "");
      currentScope.current.sessionId = value.user.id;
      currentScope.current.company = next;
      setSession(value);
      setCompany(next);
    } catch (e) {
      if (sequence !== restoreSequence.current) return;
      setSession(null);
      setCall(null);
      setError((e as Error).message);
      clearPrivate();
    }
  }
  async function conversationPages() {
    let cursor = "";
    let rows: Conversation[] = [];
    let more = false;
    for (let page = 0; page < listPages; page++) {
      const v = await client.request<{
        conversations: Conversation[];
        cursor: string;
        hasMore: boolean;
      }>(
        `/companies/${company}/conversations${cursor ? "?cursor=" + encodeURIComponent(cursor) : ""}`,
      );
      rows = rows.concat(v.conversations);
      cursor = v.cursor;
      more = v.hasMore;
      if (!more) break;
    }
    return { conversations: rows, hasMore: more };
  }
  async function refresh(scope: "all" | "tasks" | "finance" = "all") {
    if (
      !company ||
      !session ||
      !foreground ||
      currentScope.current.company !== company ||
      currentScope.current.sessionId !== session.user.id ||
      !currentScope.current.foreground
    )
      return;
    const generation = client.generation;
    // Reauthorize directory/role before displaying scoped lists. A changed role
    // cannot reuse the previous list projection.
    const bootstrap = await client.request<WorkData>(
      `/companies/${company}/bootstrap`,
    );
    if (
      generation !== client.generation ||
      currentScope.current.company !== company ||
      currentScope.current.sessionId !== session.user.id ||
      !currentScope.current.foreground
    )
      return;
    const sameRole = sameNativeReadBasis(work, bootstrap);
    // Confirmed membership changes take effect before subsequent pages arrive.
    // A transport error before bootstrap confirmation preserves the last work.
    setWork(confirmedNativeWork(work, bootstrap));
    const [chat, tasks, expenses, attention] = await Promise.all([
      conversationPages(),
      scope === "finance" && sameRole
        ? Promise.resolve(work!.tasks)
        : readWorkPages<WorkTask>(
            (path) => client.request(path),
            company,
            "tasks",
          ),
      scope === "tasks" && sameRole
        ? Promise.resolve(work!.expenses)
        : readWorkPages<NativeExpense>(
            (path) => client.request(path),
            company,
            "expenses",
          ),
      client.request<{ events: typeof inbox }>(
        `/companies/${company}/communication/inbox`,
      ),
    ]);
    if (
      generation !== client.generation ||
      currentScope.current.company !== company ||
      currentScope.current.sessionId !== session.user.id ||
      !currentScope.current.foreground
    )
      return;
    setConversations(chat.conversations);
    setListMore(chat.hasMore);
    setWork({ ...bootstrap, tasks, expenses });
    let businessChanged = false,
      otherScope = false;
    for (const event of attention.events) {
      if (seenWorkEvents.current.has(event.eventId)) continue;
      seenWorkEvents.current.add(event.eventId);
      const changed = nativeEventScope(event.kind ?? "");
      if (changed) {
        businessChanged = true;
        if (scope !== "all" && changed !== scope) otherScope = true;
      }
    }
    if (businessChanged) setRecordEpoch((old) => old + 1);
    setInbox(attention.events);
    if (otherScope) await refresh("all");
  }
  async function registerDevice(push = false) {
    let pushProvider = "",
      pushToken = "";
    if (push) {
      if (Platform.OS === "android")
        await Notifications.setNotificationChannelAsync("schach-updates", {
          name: "Company updates",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      const p = await Notifications.requestPermissionsAsync();
      if (!p.granted)
        throw new Error("Notifications are disabled on this device.");
      const token = await Notifications.getDevicePushTokenAsync();
      pushProvider = Platform.OS === "ios" ? "apns" : "fcm";
      pushToken = String(token.data);
    }
    const userId = session?.user.id;
    if (!userId) return;
    const saved = await SecureStore.getItemAsync("schach.device." + userId);
    const result = await client.request<{ id: string }>("/devices", "POST", {
      ...(device || saved ? { deviceId: device || saved } : {}),
      platform: Platform.OS === "ios" ? "ios" : "android",
      name: "Schach native client",
      ...(push ? { pushProvider, pushToken } : {}),
    });
    if (currentScope.current.sessionId !== userId) return;
    await SecureStore.setItemAsync("schach.device." + userId, result.id);
    setDevice(result.id);
  }
  function invalidatePrivateViews() {
    client.clearGeneration();
    setPolicyEpoch((p) => p + 1);
  }
  const restoreEvent = useEffectEvent(restore);
  const refreshEvent = useEffectEvent(refresh);
  const registerEvent = useEffectEvent(registerDevice);
  const clearEvent = useEffectEvent(clearPrivate);
  const sessionId = session?.user.id;
  useEffect(() => {
    client.onPolicyChange = (status) => {
      clearEvent();
      setPolicyEpoch((p) => p + 1);
      if (status === 401) setCall(null);
    };
    void client
      .restore()
      .then(async () => {
        if (client.token) await restoreEvent();
      })
      .finally(() => setRestoring(false));
    const subscription = AppState.addEventListener("change", (state) => {
      currentScope.current.foreground = state === "active";
      setForeground(state === "active");
      if (state !== "active") clearEvent();
      else if (client.token) void restoreEvent();
    });
    const received = Notifications.addNotificationReceivedListener(() => {
      if (client.token) void restoreEvent();
    });
    const response = Notifications.addNotificationResponseReceivedListener(
      () => {
        if (client.token) void restoreEvent();
      },
    );
    return () => {
      client.onPolicyChange = undefined;
      subscription.remove();
      received.remove();
      response.remove();
    };
  }, []);
  useEffect(() => {
    if (sessionId)
      void Promise.resolve()
        .then(() => registerEvent())
        .catch((e) => setError(e.message));
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || !foreground || !company) return;
    void Promise.resolve()
      .then(() => refreshEvent())
      .catch((e) => setError(e.message));
    const timer = setInterval(
      () =>
        void refreshEvent().catch((e) => {
          setError(e.message);
        }),
      15000,
    );
    return () => clearInterval(timer);
  }, [company, sessionId, foreground, listPages]);
  async function signIn(
    endpoint: string,
    email: string,
    password: string,
    code: string,
    recovery: string,
  ) {
    const value = await client.login(endpoint, email, password, code, recovery);
    setSession(value);
    setCompany(value.companies[0]?.id ?? "");
    setError("");
  }
  async function signOut() {
    currentScope.current.sessionId = undefined;
    restoreSequence.current++;
    setCall(null);
    try {
      await client.logout();
    } finally {
      clearPrivate();
      setSession(null);
      setDevice("");
    }
  }
  function select(id: string) {
    client.clearGeneration();
    setSelected(id);
  }
  function switchCompany(id: string) {
    setListPages(1);
    setListMore(false);
    currentScope.current.company = id;
    setCall(null);
    clearPrivate();
    setCompany(id);
  }
  return {
    session,
    company,
    device,
    policyEpoch,
    recordEpoch,
    invalidatePrivateViews,
    conversations,
    listMore,
    loadMoreConversations: () => setListPages((p) => p + 1),
    selected,
    work,
    inbox,
    foreground,
    restoring,
    error,
    setError,
    refresh,
    signIn,
    signOut,
    select,
    switchCompany,
    registerDevice,
    call,
    setCall,
  };
}
const Context = createContext<ReturnType<typeof useController> | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const value = useController();
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace provider is missing");
  return value;
}
export function Page({
  children,
  scroll = true,
}: {
  children: ReactNode;
  scroll?: boolean;
}) {
  const w = useWorkspace();
  return (
    <View style={styles.root}>
      <Text style={styles.heading}>Schach · {w.session?.user.name}</Text>
      <ScrollView horizontal style={{ maxHeight: 48 }}>
        {w.session?.companies.map((c) => (
          <Button
            key={c.id}
            title={c.name + (w.company === c.id ? " ✓" : "")}
            onPress={() => w.switchCompany(c.id)}
          />
        ))}
      </ScrollView>
      {!!w.error && <Text accessibilityRole="alert">{w.error}</Text>}
      {w.foreground ? (
        scroll ? (
          <ScrollView key={w.company + ":" + w.session?.user.id}>
            {children}
          </ScrollView>
        ) : (
          <View style={{ flex: 1 }} key={w.company + ":" + w.session?.user.id}>
            {children}
          </View>
        )
      ) : (
        <Text>Return to the app to check current company access.</Text>
      )}
    </View>
  );
}
export const styles = StyleSheet.create({
  root: { flex: 1, padding: 18, backgroundColor: "#faf9f6" },
  heading: {
    fontSize: 22,
    fontWeight: "700",
    color: "#29251e",
    marginVertical: 14,
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd5c8",
    borderRadius: 8,
    padding: 12,
    marginVertical: 8,
  },
  message: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 8,
    marginVertical: 5,
  },
});
