// @vitest-environment happy-dom
import { act, createElement, useLayoutEffect } from "react";
import { createRoot } from "react-dom/client";
import { it, expect, vi, afterEach } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./Workspace";
import { client } from "./client";
import SavedReports, { DefinitionForm } from "./SavedReports";
import { clearAllBusinessAttempts } from "../../shared/business/attempts";
import { clearAllDrafts, readDraft } from "./conversationDrafts";
const env = vi.hoisted(() => ({
  state: (_state: string) => {},
  held: false,
  finish: (_value: Response) => {},
  denied: false,
  submitted: [] as any[],
  picker: {} as any,
  confirm: () => {},
  size: (_width: number, _height: number) => {},
}));
vi.mock("@react-native-community/datetimepicker", () => ({
  default: (props: any) => {
    env.picker = props;
    return createElement(
      "span",
      { "data-native-calendar": true },
      "Native calendar",
    );
  },
}));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
vi.mock("./capture", () => ({
  setCaptureContext: () => {},
  clearCaptures: () => {},
  recoverCamera: async () => null,
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock("expo-router", () => ({ router: { push: vi.fn() } }));
vi.mock("expo-notifications", () => ({
  getLastNotificationResponseAsync: async () => null,
  addNotificationReceivedListener: () => ({ remove() {} }),
  addNotificationResponseReceivedListener: () => ({ remove() {} }),
  addPushTokenListener: () => ({ remove() {} }),
  setNotificationHandler: () => {},
  getPermissionsAsync: async () => ({ granted: false }),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("./ConnectUI", () => ({
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  Sheet: ({ children }: any) => createElement("div", {}, children),
}));
vi.mock("react-native", () => ({
  Alert: {
    alert: (_title: string, _text: string, buttons: any[]) => {
      env.confirm =
        buttons.find((b) => b.text === "Replace")?.onPress ?? (() => {});
    },
  },
  AppState: {
    currentState: "active",
    addEventListener: (_event: string, fn: any) => {
      env.state = fn;
      return { remove() {} };
    },
  },
  Platform: { OS: "android" },
  StyleSheet: { create: (value: any) => value },
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children }: any) => createElement("span", {}, children),
  Button: () => null,
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  FlatList: ({
    data,
    renderItem,
    ListHeaderComponent,
    ListFooterComponent,
    onContentSizeChange,
    contentContainerStyle,
  }: any) => {
    env.size = onContentSizeChange ?? (() => {});
    return createElement(
      "div",
      { style: contentContainerStyle, "data-saved-list": true },
      ListHeaderComponent,
      ...data.map((item: any) => renderItem({ item })),
      ListFooterComponent,
    );
  },
  TextInput: ({ value, onChangeText, accessibilityLabel, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onInput: (e: any) => onChangeText(e.target.value),
    }),
}));
let w: ReturnType<typeof useWorkspace>;
function Probe() {
  const current = useWorkspace();
  useLayoutEffect(() => {
    w = current;
  });
  return current.foreground && current.work ? (
    <SavedReports onOpen={() => {}} />
  ) : null;
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAllDrafts();
  clearAllBusinessAttempts();
  client.token = "";
  client.clearGeneration();
});
it("real Workspace ordinary refresh retains the authored input element/focus while fresh recipient choices and submit are withheld", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.held = false;
  env.denied = false;
  client.endpoint = "https://owned.test";
  client.token = "token";
  vi.spyOn(client, "restore").mockResolvedValue();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = new URL(url).pathname;
      if (path.endsWith("/auth/session"))
        return new Response(
          JSON.stringify({
            user: { id: "user", name: "User" },
            companies: [{ id: "co", name: "Company" }],
          }),
        );
      if (path.endsWith("/bootstrap"))
        return new Response(
          JSON.stringify({
            readBasis: "fixed",
            me: { id: "user", role: "founder" },
            people: [],
            departments: [],
            company: { id: "co", timezone: "Asia/Kolkata" },
            tasks: [],
            expenses: [],
          }),
        );
      if (path.endsWith("/recipients")) {
        if (env.denied)
          return new Response(
            JSON.stringify({
              error: { code: "not_found", message: "Access removed" },
            }),
            { status: 404 },
          );
        if (env.held)
          return new Promise<Response>((resolve) => {
            env.finish = resolve;
          });
        return new Response(
          JSON.stringify({
            recipients: [{ id: "user", name: "Fresh recipient" }],
          }),
        );
      }
      return new Response(
        JSON.stringify({
          id: "device",
          tasks: [],
          expenses: [],
          conversations: [],
          events: [],
          definitions: [],
          orphans: [],
          projects: [],
          hasMore: false,
          cursor: "",
        }),
      );
    }),
  );
  const c = document.createElement("div");
  document.body.append(c);
  const root = createRoot(c);
  try {
    await act(async () => {
      root.render(
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>,
      );
      await new Promise((r) => setTimeout(r, 30));
    });
    const input = c.querySelector<HTMLInputElement>(
      'input[aria-label="Report name"]',
    )!;
    expect(input).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Authored monthly review");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    input.focus();
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find(
          (b) => b.textContent === "Saved period: Previous completed month",
        )!
        .click(),
    );
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find((b) => b.textContent === "Fixed dates")!
        .click(),
    );
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find((b) => b.textContent === "Choose Saved start date YYYY-MM-DD")!
        .click(),
    );
    const calendar = c.querySelector("[data-native-calendar]");
    const select = env.picker.onValueChange;
    expect(calendar).toBeTruthy();
    env.held = true;
    await act(async () => {
      await w.refresh();
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(c.querySelector('input[aria-label="Report name"]')).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Authored monthly review");
    expect(input.disabled).toBe(false);
    expect(c.querySelector("[data-native-calendar]")).toBe(calendar);
    expect(env.picker.onValueChange).toBe(select);
    await act(async () => select({}, new Date("2026-09-03T06:30:00Z")));
    const startInput = c.querySelector<HTMLInputElement>(
      'input[aria-label="Saved start date YYYY-MM-DD"]',
    )!;
    expect(startInput.value).toBe("");
    expect(
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === "Confirm selected Saved start date YYYY-MM-DD",
      )!.disabled,
    ).toBe(true);
    expect(c.textContent).not.toContain("Fresh recipient");
    expect(
      Array.from(c.querySelectorAll("button")).find(
        (e) => e.textContent === "Review definition",
      )?.disabled,
    ).toBe(true);
    await act(async () => {
      env.finish(new Response(JSON.stringify({ recipients: [] })));
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(input.value).toBe("Authored monthly review");
    await act(async () =>
      Array.from(c.querySelectorAll("button"))
        .find(
          (b) =>
            b.textContent === "Confirm selected Saved start date YYYY-MM-DD",
        )!
        .click(),
    );
    expect(startInput.value).toBe("2026-09-03");
    const remove = Array.from(c.querySelectorAll("button")).find(
      (b) => b.textContent === "Remove unavailable recipients",
    )!;
    expect(remove).toBeTruthy();
    await act(() => remove.click());
    expect(
      Array.from(c.querySelectorAll("button")).find(
        (b) => b.textContent === "Review definition",
      )?.disabled,
    ).toBe(true);
    env.held = false;
    env.denied = true;
    await act(async () => {
      await w.refresh();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(c.querySelector('input[aria-label="Report name"]')).toBeNull();
    expect(
      readDraft({
        serverOrigin: client.endpoint,
        companyId: "co",
        userId: "user",
        conversationId: "$report-definition:new",
        threadRootId: "input:configuration",
      }).body,
    ).toBe("");
  } finally {
    await act(() => root.unmount());
    c.remove();
  }
});

it.each(["creation", "definition", "schedule"])(
  "real provider preserves canonical %s replay basis and replaces inspected schedule fields with its version",
  async (kind) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    clearAllDrafts();
    clearAllBusinessAttempts();
    client.endpoint = "https://owned.test";
    client.token = "token";
    vi.spyOn(client, "restore").mockResolvedValue();
    const configuration = {
      name: "Initial",
      basis: "task_history_v1",
      filters: { ownerId: "", departmentId: "", projectId: "" },
      periodRule: "fixed",
      from: "2026-09-01",
      to: "2026-09-30",
      timezonePolicy: "explicit",
      reportZone: "UTC",
      recipientIds: ["user"],
    };
    const initial = {
      id: "definition",
      companyId: "co",
      ownerId: "user",
      version: 2,
      state: "active",
      schemaVersion: 1,
      basis: "task_history_v1",
      configuration,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:00Z",
    };
    const initialSchedule = {
      id: "schedule",
      version: 1,
      definitionRevision: 2,
      weekdays: [1],
      localMinute: "09:00",
      scheduleZone: "UTC",
      nextOccurrenceUTC: "2026-11-01T00:00:00Z",
      state: "active",
    };
    let current = { definition: initial, schedule: initialSchedule };
    const sent: any[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options: any) => {
        const path = new URL(url).pathname;
        if (
          (options.method === "PATCH" &&
            path.includes("/reports/definitions/definition")) ||
          (options.method === "POST" && path.endsWith("/reports/definitions"))
        ) {
          sent.push(JSON.parse(options.body));
          if (sent.length === 1) {
            current = {
              definition: {
                ...initial,
                version: kind === "creation" ? 3 : 4,
                configuration: { ...configuration, name: "Intervening" },
              },
              schedule: {
                ...initialSchedule,
                version: kind === "creation" ? 1 : kind === "schedule" ? 3 : 2,
                definitionRevision: 4,
                weekdays: [2],
                localMinute: "14:00",
                scheduleZone: "Asia/Kolkata",
              },
            };
            throw Error("Lost ACK");
          }
          return new Response(
            JSON.stringify({
              definition: {
                ...initial,
                version: kind === "creation" ? 1 : 3,
                configuration:
                  kind === "creation"
                    ? sent[0].configuration
                    : initial.configuration,
              },
              schedule: {
                ...initialSchedule,
                version: kind === "schedule" ? 2 : 1,
                definitionRevision: 3,
              },
            }),
          );
        }
        return new Response(
          JSON.stringify(
            path.endsWith("/auth/session")
              ? {
                  user: { id: "user", name: "User" },
                  companies: [{ id: "co", name: "Company" }],
                }
              : path.endsWith("/bootstrap")
                ? {
                    readBasis: "fixed",
                    me: { id: "user", role: "founder" },
                    people: [],
                    departments: [],
                    company: { id: "co", timezone: "UTC" },
                    tasks: [],
                    expenses: [],
                  }
                : path.endsWith("/recipients")
                  ? { recipients: [{ id: "user", name: "Recipient" }] }
                  : path.endsWith("/definitions/definition")
                    ? current
                    : {
                        id: "device",
                        tasks: [],
                        expenses: [],
                        conversations: [],
                        events: [],
                        definitions: [],
                        orphans: [],
                        projects: [],
                        hasMore: false,
                        cursor: "",
                      },
          ),
        );
      }),
    );
    function Form() {
      const current = useWorkspace();
      return current.work && current.foreground ? (
        kind === "creation" ? (
          <SavedReports onOpen={() => {}} />
        ) : (
          <DefinitionForm
            id="definition"
            onCreated={() => {}}
            onOpen={() => {}}
          />
        )
      ) : null;
    }
    const c = document.createElement("div");
    document.body.append(c);
    const root = createRoot(c);
    const settle = async () =>
      act(async () => {
        await new Promise((r) => setTimeout(r, 15));
      });
    const press = async (title: string) =>
      act(async () => {
        Array.from(c.querySelectorAll("button"))
          .find((b) => b.textContent === title)!
          .click();
        await new Promise((r) => setTimeout(r, 15));
      });
    const edit = async (label: string, value: string) =>
      act(async () => {
        const input = c.querySelector<HTMLInputElement>(
          `input[aria-label="${label}"]`,
        )!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    try {
      await act(async () => {
        root.render(
          <WorkspaceProvider>
            <Form />
          </WorkspaceProvider>,
        );
        await new Promise((r) => setTimeout(r, 30));
      });
      await settle();
      if (kind !== "schedule") {
        await edit("Report name", "Authored");
        await press("Review definition");
        await press("Confirm saved report");
      } else {
        await edit("Schedule local time HH:MM", "10:00");
        await press("Confirm delivery schedule");
      }
      expect(sent).toHaveLength(1);
      await press(
        kind === "schedule"
          ? "Retry same schedule save"
          : "Retry same definition save",
      );
      await settle();
      expect(sent[1]).toEqual(sent[0]);
      if (kind === "creation")
        expect(
          c.querySelector<HTMLInputElement>('input[aria-label="Report name"]')!
            .value,
        ).toBe("Authored");
      expect(c.textContent).toContain("Reconcile current definition");
      expect(
        c.querySelector<HTMLInputElement>(
          'input[aria-label="Schedule local time HH:MM"]',
        )!.value,
      ).toBe(kind === "schedule" ? "10:00" : "09:00");
      await press("Reconcile current definition");
      await act(async () => env.confirm());
      expect(
        c.querySelector<HTMLInputElement>(
          'input[aria-label="Schedule local time HH:MM"]',
        )!.value,
      ).toBe("14:00");
      expect(
        c.querySelector<HTMLInputElement>(
          'input[aria-label="Schedule timezone"]',
        )!.value,
      ).toBe("Asia/Kolkata");
      await press("Confirm delivery schedule");
      expect(sent[2]).toMatchObject({
        expectedDefinitionVersion: kind === "creation" ? 3 : 4,
        expectedScheduleVersion:
          kind === "creation" ? 1 : kind === "schedule" ? 3 : 2,
        localMinute: "14:00",
        scheduleZone: "Asia/Kolkata",
        weekdays: [2],
      });
    } finally {
      await act(() => root.unmount());
      c.remove();
    }
  },
);

it.each(["denied", "background", "company", "principal", "orphan"])(
  "real provider retains tall Saved viewport through independently pending recipients and releases it on %s",
  async (barrier) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    let held = false;
    let denied = false;
    let principal = "user";
    let finish: (value: Response) => void = () => {};
    client.endpoint = "https://owned.test";
    client.token = "token";
    vi.spyOn(client, "restore").mockResolvedValue();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        if (path.endsWith("/auth/session"))
          return new Response(
            JSON.stringify({
              user: { id: principal, name: "User" },
              companies: [
                { id: "co", name: "Company" },
                { id: "co2", name: "Other company" },
              ],
            }),
          );
        if (path.endsWith("/bootstrap"))
          return new Response(
            JSON.stringify({
              readBasis: "fixed",
              me: { id: principal, role: "founder" },
              people: [],
              departments: [],
              company: {
                id: path.includes("/co2/") ? "co2" : "co",
                timezone: "Asia/Kolkata",
              },
              tasks: [],
              expenses: [],
            }),
          );
        if (path.endsWith("/recipients")) {
          if (denied)
            return new Response(
              JSON.stringify({
                error: {
                  code: "not_found",
                  message: "Recipient access removed",
                },
              }),
              { status: 404 },
            );
          if (held && barrier !== "orphan")
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          return new Response(
            JSON.stringify({
              recipients: Array.from({ length: 80 }, (_, i) => ({
                id: i ? "recipient-" + i : principal,
                name: "Tall recipient " + i,
              })),
            }),
          );
        }
        if (path.endsWith("/orphans") && held && barrier === "orphan")
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return new Response(
          JSON.stringify({
            id: "device",
            tasks: [],
            expenses: [],
            conversations: [],
            events: [],
            definitions: Array.from({ length: 12 }, (_, i) => ({
              id: "definition-" + i,
              configuration: { name: "Fresh definition " + i },
              state: "active",
            })),
            orphans: [{ id: "orphan", version: 1, state: "active" }],
            projects: [],
            hasMore: false,
            cursor: "",
          }),
        );
      }),
    );
    const c = document.createElement("div");
    document.body.append(c);
    const root = createRoot(c);
    const extent = () =>
      (c.querySelector("[data-saved-list]") as HTMLElement | null)?.style
        .minHeight ?? "";
    try {
      await act(async () => {
        root.render(
          <WorkspaceProvider>
            <Probe />
          </WorkspaceProvider>,
        );
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(c.textContent).toContain("Tall recipient 79");
      const input = c.querySelector<HTMLInputElement>(
        'input[aria-label="Report name"]',
      )!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, "Retained tall report");
        input.dispatchEvent(new Event("input", { bubbles: true }));
        env.size(400, 12000);
      });
      held = true;
      await act(async () => {
        await w.refresh();
        await new Promise((r) => setTimeout(r, 5));
      });
      // Other reads finish independently; that must not let their shorter
      // content measurement overwrite the last fully authorized extent.
      expect(c.textContent).toContain("Fresh definition 11");
      if (barrier === "orphan") {
        expect(c.textContent).not.toContain("Definition orphan");
        expect(c.textContent).toContain("Tall recipient 79");
      } else expect(c.textContent).not.toContain("Tall recipient");
      expect(c.querySelector('input[aria-label="Report name"]')).toBe(input);
      expect(input.value).toBe("Retained tall report");
      expect(
        Array.from(c.querySelectorAll("button")).find(
          (b) => b.textContent === "Review definition",
        )!.disabled,
      ).toBe(barrier !== "orphan");
      await act(() => env.size(400, 900));
      expect(extent()).toBe("12000px");
      if (barrier === "orphan") {
        await act(async () => {
          finish(new Response(JSON.stringify({ orphans: [] })));
          await new Promise((r) => setTimeout(r, 5));
        });
        expect(extent()).toBe("");
        expect(input.value).toBe("Retained tall report");
        // Freshly authorized content can establish a new extent. Invalid native
        // measurements must never replace the finite value.
        await act(() => {
          env.size(400, 700);
          env.size(400, Number.NaN);
        });
        await act(async () => {
          await w.refresh();
          await new Promise((r) => setTimeout(r, 5));
        });
        expect(extent()).toBe("700px");
        return;
      }
      if (barrier === "denied") {
        denied = true;
        await act(async () => {
          finish(
            new Response(
              JSON.stringify({
                error: {
                  code: "not_found",
                  message: "Recipient access removed",
                },
              }),
              { status: 404 },
            ),
          );
          await new Promise((r) => setTimeout(r, 5));
        });
        expect(c.querySelector('input[aria-label="Report name"]')).toBeNull();
      } else if (barrier === "company") {
        held = false;
        await act(async () => {
          w.switchCompany("co2");
          await new Promise((r) => setTimeout(r, 20));
        });
        expect(w.company).toBe("co2");
      } else {
        await act(() => env.state("background"));
        expect(c.querySelector("[data-saved-list]")).toBeNull();
        held = false;
        if (barrier === "principal") principal = "other-user";
        await act(async () => {
          env.state("active");
          await new Promise((r) => setTimeout(r, 20));
        });
        expect(w.session?.user.id).toBe(principal);
      }
      expect(extent()).toBe("");
      const authored = readDraft({
        serverOrigin: client.endpoint,
        companyId: "co",
        userId: "user",
        conversationId: "$report-definition:new",
        threadRootId: "input:configuration",
      }).body;
      if (barrier === "background")
        expect(authored).toContain("Retained tall report");
      else expect(authored).toBe("");
      // An old pending response cannot revive geometry or authored state.
      if (barrier !== "denied") {
        await act(async () => {
          finish(new Response(JSON.stringify({ recipients: [] })));
          await new Promise((r) => setTimeout(r, 5));
        });
        expect(extent()).toBe("");
        const nextName = (
          c.querySelector('input[aria-label="Report name"]') as HTMLInputElement
        )?.value;
        if (barrier === "background")
          expect(nextName).toBe("Retained tall report");
        else expect(nextName).not.toBe("Retained tall report");
      }
    } finally {
      await act(() => root.unmount());
      c.remove();
    }
  },
);
