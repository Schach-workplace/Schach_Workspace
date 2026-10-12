import {
  clearAllBusinessAttempts,
  filterBusinessAttemptsForGraph,
  sameBusinessActorBasis,
  type BusinessActorBasis,
} from "../../shared/business/attempts";
import { router } from "expo-router";
import {
  AuthorizedNotificationTarget,
  type AttentionTarget,
} from "./notificationTarget";
import { SafeAreaView } from "react-native-safe-area-context";
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
import { clearCaptures, setCaptureContext, recoverCamera } from "./capture";
import { clearAllDrafts } from "./conversationDrafts";
import { client, NativeApiError, type Session } from "./client";
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
  clientMessageId?: string;
  mentionIds?: string[];
  mentionAll?: boolean;
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
  membershipId: string;
  email: string;
  title: string;
  capacityHours: number;
  membershipVersion: number;
  memberAccessEpoch: number;
  companyPermissionEpoch: number;
  managerId: string;
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
  comments?: { id: string; body: string }[];
  departmentId?: string;
  code?: string;
  projectId?: string;
  startDate?: string;
  originalDeadlineMode?: string;
  originalDueTimezone?: string;
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
  const [attentionEpoch, setAttentionEpoch] = useState(0);
  const [executionEpoch, setExecutionEpoch] = useState(0);
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
  const [authorized, setAuthorized] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [call, setCall] = useState<CallConnection | null>(null);
  const restoreSequence = useRef(0);
  // User id that explicitly enabled push on this device during this session.
  // The device registration response only returns the id, so this is the only
  // trustworthy opt-in signal; rotated tokens are re-sent only for that user.
  const pushOptIn = useRef<string | null>(null);
  const pollFailure = useRef("");
  const sessionAuthorized = useRef(false);
  // Content-free authorization fingerprint survives fetched-history background clearing.
  const confirmedBasis = useRef<string | null>(null);
  const confirmedActor = useRef<BusinessActorBasis | null>(null);
  const currentScope = useRef({
    company,
    sessionId: session?.user.id,
    foreground,
  });
  useLayoutEffect(() => {
    currentScope.current = { company, sessionId: session?.user.id, foreground };
    setCaptureContext({
      serverOrigin: client.endpoint,
      companyId: company,
      userId: session?.user.id ?? "",
      ready: foreground && authorized,
      policyEpoch,
    });
  }, [company, session?.user.id, foreground, authorized, policyEpoch]);
  function clearPrivate() {
    clearAllDrafts();
    clearAllBusinessAttempts();
    clearCaptures();
    confirmedBasis.current = null;
    confirmedActor.current = null;
    sessionAuthorized.current = false;
    setAuthorized(false);
    client.clearGeneration();
    setConversations([]);
    setSelected("");
    setWork(null);
    setInbox([]);
    seenWorkEvents.current.clear();
  }
  async function restore() {
    const sequence = ++restoreSequence.current;
    const generation = client.generation;
    try {
      const value = await client.request<Session>("/auth/session");
      if (
        sequence !== restoreSequence.current ||
        generation !== client.generation ||
        !currentScope.current.foreground
      )
        return;
      const next = value.companies.some(
        (c) => c.id === currentScope.current.company,
      )
        ? currentScope.current.company
        : (value.companies[0]?.id ?? "");
      if (
        (currentScope.current.sessionId &&
          currentScope.current.sessionId !== value.user.id) ||
        (currentScope.current.company && currentScope.current.company !== next)
      )
        clearPrivate();
      currentScope.current.sessionId = value.user.id;
      client.userId = value.user.id;
      currentScope.current.company = next;
      sessionAuthorized.current = true;
      setSession(value);
      setCompany(next);
    } catch (e) {
      if (
        sequence !== restoreSequence.current ||
        generation !== client.generation
      )
        return;
      setAuthorized(false);
      setError((e as Error).message);
      if (e instanceof NativeApiError && [401, 403, 404].includes(e.status)) {
        setSession(null);
        setCall(null);
        clearPrivate();
      }
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
  async function refresh(
    scope: "all" | "tasks" | "finance" | "attention" = "all",
  ) {
    if (
      !company ||
      !sessionAuthorized.current ||
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
    const nextBasis = JSON.stringify([
      client.endpoint,
      company,
      session.user.id,
      bootstrap.readBasis,
      bootstrap.me.role,
      bootstrap.me.departmentId,
      bootstrap.me.managerId,
      bootstrap.me.memberAccessEpoch,
    ]);
    if (confirmedBasis.current && confirmedBasis.current !== nextBasis) {
      clearAllDrafts();
      if (sameBusinessActorBasis(confirmedActor.current, bootstrap.me))
        filterBusinessAttemptsForGraph(
          client.endpoint,
          company,
          session.user.id,
          bootstrap.me,
        );
      else clearAllBusinessAttempts();
      clearCaptures();
      setPolicyEpoch((p) => p + 1);
    }
    confirmedBasis.current = nextBasis;
    confirmedActor.current = bootstrap.me;
    // Confirmed membership changes take effect before subsequent pages arrive.
    // A transport error before bootstrap confirmation preserves the last work.
    setWork(confirmedNativeWork(work, bootstrap));
    const [chat, tasks, expenses, attention] = await Promise.all([
      conversationPages(),
      (scope === "finance" || scope === "attention") && sameRole
        ? Promise.resolve(work!.tasks)
        : readWorkPages<WorkTask>(
            (path) => client.request(path),
            company,
            "tasks",
          ),
      (scope === "tasks" || scope === "attention") && sameRole
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
    setAuthorized(true);
    setAttentionEpoch((old) => old + 1);
    setExecutionEpoch((old) => old + 1);
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
  /**
   * Registers this device session. `push`:
   * - `true`: the user explicitly asked for notification hints (Account action),
   *   so permission may be requested and the token is attached;
   * - `false`: register without touching the stored push token. Sign-in uses
   *   this, so a shared phone never attaches push for a user who did not opt in.
   * `rotated` carries a token delivered by the push token change listener; it
   * is only passed for the user who opted in during this session.
   */
  async function registerDevice(
    push = false,
    rotated?: Notifications.DevicePushToken,
  ) {
    let pushProvider = "",
      pushToken = "",
      withPush = false;
    if (rotated) {
      withPush = true;
      pushToken = String(rotated.data);
    } else if (push) {
      const p = await Notifications.requestPermissionsAsync();
      if (p.granted) {
        if (Platform.OS === "android")
          await Notifications.setNotificationChannelAsync("schach-updates", {
            name: "Company updates",
            importance: Notifications.AndroidImportance.DEFAULT,
          });
        const token = await Notifications.getDevicePushTokenAsync();
        pushToken = String(token.data);
        withPush = true;
      } else
        throw new Error(
          p.canAskAgain === false
            ? "Notifications are disabled for Schach Workspace. Enable them in device Settings."
            : "Notifications are disabled on this device.",
        );
    }
    if (withPush) pushProvider = Platform.OS === "ios" ? "apns" : "fcm";
    const userId = session?.user.id;
    if (!userId) return;
    const saved = await SecureStore.getItemAsync("schach.device." + userId);
    const result = await client.request<{ id: string }>("/devices", "POST", {
      ...(device || saved ? { deviceId: device || saved } : {}),
      platform: Platform.OS === "ios" ? "ios" : "android",
      name: "Schach native client",
      ...(withPush ? { pushProvider, pushToken } : {}),
    });
    if (currentScope.current.sessionId !== userId) return;
    if (push && withPush) pushOptIn.current = userId;
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
  const enterCompanyEvent = useEffectEvent(enterCompany);
  const sessionId = session?.user.id;
  useEffect(() => {
    client.onPolicyChange = (status) => {
      clearEvent();
      setPolicyEpoch((p) => p + 1);
      if (status === 401) {
        setCall(null);
        setSession(null);
      }
    };
    const restored = client
      .restore()
      .then(async () => {
        if (client.token) await restoreEvent();
      })
      .finally(() => setRestoring(false));
    const subscription = AppState.addEventListener("change", (state) => {
      currentScope.current.foreground = state === "active";
      setForeground(state === "active");
      if (state !== "active") {
        restoreSequence.current++;
        sessionAuthorized.current = false;
        client.clearGeneration();
        setAuthorized(false);
        setConversations([]);
        setWork(null);
        setInbox([]);
      } else if (client.token) {
        void restoreEvent()
          .then(() => refreshEvent())
          .then(() => {
            if (Platform.OS === "android" && currentScope.current.foreground)
              return recoverCamera();
          })
          .catch((e) => setError(e.message));
      }
    });
    // Foreground hints are body-free ("A company update is available."), so
    // they may be presented while the app is open.
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
    const received = Notifications.addNotificationReceivedListener(() => {
      if (client.token) void restoreEvent();
    });
    const tokenChange = Notifications.addPushTokenListener((token) => {
      const user = currentScope.current.sessionId;
      if (client.token && user && pushOptIn.current === user)
        void registerEvent(false, token).catch((e) => setError(e.message));
    });
    const notificationTarget = new AuthorizedNotificationTarget(
      () => client.request<Session>("/auth/session"),
      (company, id) =>
        client.request(`/companies/${company}/conversations/${id}`),
      (target) => {
        if (
          target.companyId &&
          currentScope.current.company !== target.companyId
        ) {
          // Same path as a manual switch: ends any call from the old company.
          enterCompanyEvent(target.companyId);
        }
        if ("inbox" in target) {
          router.push("/(tabs)/inbox");
          return;
        }
        if ("taskId" in target) {
          router.push({
            pathname: "/task/[id]",
            params: { id: target.taskId, company: target.companyId },
          });
          return;
        }
        if ("expenseId" in target) {
          router.push({
            pathname: "/expense/[id]",
            params: { id: target.expenseId, company: target.companyId },
          });
          return;
        }
        setSelected(target.conversationId);
        router.push({
          pathname: "/chat/[id]",
          params: { id: target.conversationId, company: target.companyId },
        });
      },
      () => client.generation,
      // Single-item endpoint re-authorizes the item for the current session.
      (company, id) =>
        client
          .request<{ item: AttentionTarget }>(
            `/companies/${company}/attention/${encodeURIComponent(id)}`,
          )
          .then((r) => r.item),
    );
    const openResponse = (
      response: Notifications.NotificationResponse | null,
    ) => {
      if (response && client.token)
        void notificationTarget
          .open(
            response.notification.request.content.data,
            response.notification.request.identifier,
          )
          .catch((e) => setError(e.message));
    };
    const response =
      Notifications.addNotificationResponseReceivedListener(openResponse);
    void restored
      .then(() => Notifications.getLastNotificationResponseAsync())
      .then(openResponse)
      .catch((e) => setError(e.message));
    return () => {
      client.onPolicyChange = undefined;
      subscription.remove();
      received.remove();
      tokenChange.remove();
      response.remove();
      Notifications.setNotificationHandler(null);
    };
  }, []);
  useEffect(() => {
    if (pushOptIn.current !== sessionId) pushOptIn.current = null;
    if (sessionId)
      void Promise.resolve()
        .then(() => registerEvent())
        .catch((e) => setError(e.message));
  }, [sessionId]);
  useEffect(() => {
    if (!sessionId || !foreground || !company) return;
    // Errors raised by the background poll are cleared by the next successful
    // poll; errors from user actions stay until dismissed or the company changes.
    const succeeded = () => {
      const stale = pollFailure.current;
      pollFailure.current = "";
      if (stale) setError((current) => (current === stale ? "" : current));
    };
    const failed = (e: Error) => {
      pollFailure.current = e.message;
      setError(e.message);
    };
    void Promise.resolve()
      .then(() => refreshEvent())
      .then(succeeded, failed);
    const timer = setInterval(
      () =>
        void (
          sessionAuthorized.current
            ? refreshEvent()
            : restoreEvent().then(() => refreshEvent())
        ).then(succeeded, failed),
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
    clearAllDrafts();
    clearAllBusinessAttempts();
    clearCaptures();
    const value = await client.login(endpoint, email, password, code, recovery);
    sessionAuthorized.current = true;
    setSession(value);
    setCompany(value.companies[0]?.id ?? "");
    setError("");
  }
  async function signOut() {
    currentScope.current.sessionId = undefined;
    restoreSequence.current++;
    setCall(null);
    pushOptIn.current = null;
    try {
      await client.logout();
    } finally {
      clearPrivate();
      setSession(null);
      setDevice("");
    }
  }
  function select(id: string) {
    if (id === selected) return;
    client.clearGeneration();
    setSelected(id);
  }
  function switchCompany(id: string) {
    if (!session?.companies.some((c) => c.id === id)) {
      setError("Company unavailable.");
      return;
    }
    enterCompany(id);
  }
  /** Leaves the current company (ending its call) and enters an authorized one. */
  function enterCompany(id: string) {
    setListPages(1);
    setListMore(false);
    currentScope.current.company = id;
    setCall(null);
    clearPrivate();
    setError("");
    sessionAuthorized.current = true;
    setCompany(id);
  }
  return {
    session,
    company,
    device,
    policyEpoch,
    recordEpoch,
    attentionEpoch,
    executionEpoch,
    invalidatePrivateViews,
    conversations,
    listMore,
    loadMoreConversations: () => setListPages((p) => p + 1),
    selected,
    work,
    inbox,
    foreground: foreground && authorized,
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
  safeBottom = false,
  preserveMounted = false,
}: {
  children: ReactNode;
  scroll?: boolean;
  safeBottom?: boolean;
  preserveMounted?: boolean;
}) {
  const w = useWorkspace();
  return (
    <SafeAreaView
      edges={
        safeBottom
          ? ["top", "left", "right", "bottom"]
          : ["top", "left", "right"]
      }
      style={styles.root}
    >
      <Text style={styles.heading}>Schach · {w.session?.user.name}</Text>
      <ScrollView horizontal style={{ maxHeight: 48 }}>
        {w.session?.companies.map((c) => (
          <Button
            key={c.id}
            title={c.name + (w.company === c.id ? " ✓" : "")}
            accessibilityLabel={c.name}
            accessibilityState={{ selected: w.company === c.id }}
            onPress={() => w.switchCompany(c.id)}
          />
        ))}
      </ScrollView>
      {!!w.error && (
        <View style={styles.error}>
          <Text accessibilityRole="alert" style={{ flex: 1 }}>
            {w.error}
          </Text>
          <Button
            title="Dismiss"
            accessibilityLabel="Dismiss error"
            onPress={() => w.setError("")}
          />
        </View>
      )}
      {w.foreground || preserveMounted ? (
        scroll ? (
          <ScrollView key={w.company + ":" + w.session?.user.id}>
            {children}
          </ScrollView>
        ) : (
          <View
            style={{ flex: 1, opacity: w.foreground ? 1 : 0 }}
            pointerEvents={w.foreground ? "auto" : "none"}
            accessibilityElementsHidden={!w.foreground}
            importantForAccessibility={
              w.foreground ? "auto" : "no-hide-descendants"
            }
            key={w.company + ":" + w.session?.user.id}
          >
            {children}
          </View>
        )
      ) : (
        <Text>Return to the app to check current company access.</Text>
      )}
    </SafeAreaView>
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
  error: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fdecea",
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
  },
  message: {
    backgroundColor: "#fff",
    padding: 14,
    borderRadius: 8,
    marginVertical: 5,
  },
});
