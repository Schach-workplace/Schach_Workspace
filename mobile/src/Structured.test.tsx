// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import Structured from "./Structured";
const mounted: ReturnType<typeof createRoot>[] = [];
afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((root) => root.unmount());
  });
});
function mount() {
  const host = document.createElement("div");
  const root = createRoot(host);
  mounted.push(root);
  return {
    host,
    render: (props: any) =>
      act(async () => root.render(<Structured {...props} />)),
  };
}
function button(host: HTMLElement, title: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent === title,
  )!;
}
function field(host: HTMLElement, label: string) {
  return host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
}
async function change(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
vi.mock("./IntelligenceLauncher", () => ({ default: () => null }));
const env = vi.hoisted(() => ({
  epoch: 0,
  record: 0,
  foreground: true,
  generation: 1,
  request: vi.fn(),
  people: [] as any[],
}));
vi.mock("./client", () => ({
  client: {
    get generation() {
      return env.generation;
    },
    request: env.request,
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => "key" }));
vi.mock("./Workspace", () => ({
  styles: {},
  useWorkspace: () => ({
    company: "c",
    selected: "private",
    foreground: env.foreground,
    attentionEpoch: env.epoch,
    recordEpoch: env.record,
    session: { user: { id: "u" } },
    work: {
      readBasis: "basis",
      me: { role: "member" },
      people: env.people,
      company: { timezone: "Asia/Kolkata" },
    },
  }),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  Button: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  TextInput: ({ accessibilityLabel, value, onChangeText, editable }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      disabled: editable === false,
      onChange: (e: any) => onChangeText(e.target.value),
    }),
  FlatList: ({ data, renderItem }: any) =>
    createElement(
      "div",
      {},
      data.map((item: any) =>
        createElement("div", { key: item.id }, renderItem({ item })),
      ),
    ),
}));
it("restores a same-source record after successful refresh and hides revoked/background/old-generation responses", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.epoch = 0;
  env.record = 0;
  env.foreground = true;
  env.generation = 1;
  const record = {
    id: "exact",
    title: "Current private decision",
    body: "Current body",
    revision: 1,
    kind: "decision",
    options: [],
    state: "open",
    createdBy: "other",
    dueAt: "",
  };
  env.request.mockReset().mockResolvedValueOnce({ record, responses: [] });
  const host = document.createElement("div");
  const root = createRoot(host);
  const render = () =>
    root.render(
      <Structured source={null} recordId="exact" onClose={() => {}} />,
    );
  await act(async () => render());
  expect(host.textContent).toContain(record.title);
  let release: (v: any) => void = () => {};
  env.request.mockImplementationOnce(() => new Promise((r) => (release = r)));
  env.epoch++;
  await act(async () => render());
  expect(host.textContent).not.toContain(record.title);
  await act(async () => release({ record, responses: [] }));
  expect(host.textContent).toContain(record.title);
  env.request.mockRejectedValueOnce(
    Object.assign(Error("Current access revoked"), { status: 403 }),
  );
  env.record++;
  await act(async () => render());
  expect(host.textContent).not.toContain(record.title);
  expect(host.textContent).toContain("Current access revoked");
  env.request.mockImplementationOnce(() => new Promise((r) => (release = r)));
  env.epoch++;
  await act(async () => render());
  env.foreground = false;
  await act(async () => render());
  await act(async () => release({ record, responses: [] }));
  expect(host.textContent).not.toContain(record.title);
  env.foreground = true;
  env.request.mockImplementationOnce(() => new Promise((r) => (release = r)));
  env.epoch++;
  await act(async () => render());
  env.generation++;
  await act(async () => release({ record, responses: [] }));
  expect(host.textContent).not.toContain(record.title);
  await act(async () => root.unmount());
});

vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
  ui: {},
}));
vi.mock("./DeadlinePicker", () => ({
  default: ({ date, time, onChange, disabled }: any) => (
    <div>
      <input
        aria-label="Response deadline date"
        value={date}
        disabled={disabled}
        onChange={(e) => onChange({ date: e.target.value, time })}
      />
      <input
        aria-label="Response deadline time"
        value={time}
        disabled={disabled}
        onChange={(e) => onChange({ date, time: e.target.value })}
      />
    </div>
  ),
}));
const members = [
  { userId: "u", active: true, role: "member", historyFromSequence: 1 },
  { userId: "eligible", active: true, role: "member", historyFromSequence: 1 },
  { userId: "later", active: true, role: "member", historyFromSequence: 10 },
  { userId: "viewer", active: true, role: "viewer", historyFromSequence: 1 },
];
function creation(publicChannel = false): any {
  env.foreground = true;
  env.people = [
    { id: "u", name: "Actor", active: true, role: "member" },
    { id: "eligible", name: "Eligible", active: true, role: "member" },
    { id: "later", name: "Joined later", active: true, role: "member" },
    {
      id: "outside",
      name: "Outside conversation",
      active: true,
      role: "member",
    },
    { id: "viewer", name: "Conversation viewer", active: true, role: "member" },
  ];
  return {
    source: {
      id: "source",
      conversationId: "private",
      revision: 2,
      sequence: 5,
    },
    conversation: { id: "private", public: publicChannel },
    members,
    sourceReady: true,
    onClose: vi.fn(),
  };
}
it("uses current private source history and a searchable public reader list", async () => {
  env.request.mockReset().mockResolvedValue({ records: [], responses: [] });
  const p = creation();
  const view = mount();
  await view.render(p);
  expect(button(view.host, "Outside conversation")).toBeUndefined();
  expect(button(view.host, "Joined later")).toBeUndefined();
  await act(async () => button(view.host, "decision").click());
  expect(button(view.host, "Actor")).toBeUndefined();
  expect(button(view.host, "Conversation viewer")).toBeUndefined();
  expect(button(view.host, "Eligible")).toBeTruthy();
  await view.render({ ...p, conversation: { id: "private", public: true } });
  expect(button(view.host, "Outside conversation")).toBeTruthy();
  expect(button(view.host, "Joined later")).toBeTruthy();
  await change(field(view.host, "Search eligible people"), "Eligible");
  expect(button(view.host, "Outside conversation")).toBeUndefined();
});
it("freezes native company-zone deadline and exact unknown request while withholding an unverified source", async () => {
  env.request
    .mockReset()
    .mockImplementation((_path, method) =>
      method === "POST"
        ? Promise.reject(Error("Result unknown"))
        : Promise.resolve({ records: [], responses: [] }),
    );
  const p = creation();
  const view = mount();
  await view.render(p);
  await change(field(view.host, "Record title"), "Frozen record");
  await act(async () => button(view.host, "Eligible").click());
  await change(field(view.host, "Response deadline date"), "2030-01-02");
  await change(field(view.host, "Response deadline time"), "10:00");
  await view.render({ ...p, sourceReady: false });
  expect(button(view.host, "Create structured record").disabled).toBe(true);
  await view.render(p);
  await act(async () => button(view.host, "Create structured record").click());
  expect(view.host.textContent).toContain("Result unknown");
  const original = env.request.mock.calls.find((c) => c[1] === "POST")![2];
  expect(original.dueAt).toBe("2030-01-02T04:30:00.000Z");
  expect(field(view.host, "Record title").disabled).toBe(true);
  await act(async () =>
    button(view.host, "Retry same structured record").click(),
  );
  expect(env.request.mock.calls.filter((c) => c[1] === "POST")).toHaveLength(2);
  expect(env.request.mock.calls.filter((c) => c[1] === "POST")[1][2]).toEqual(
    original,
  );
});

it("submits an omitted native deadline as empty and closes only after successful creation", async () => {
  env.request.mockReset().mockResolvedValue({ records: [], responses: [] });
  const p = creation();
  const view = mount();
  await view.render(p);
  await change(field(view.host, "Record title"), "No deadline");
  await act(async () => button(view.host, "Eligible").click());
  await act(async () => button(view.host, "Create structured record").click());
  expect(env.request.mock.calls.find((c) => c[1] === "POST")![2].dueAt).toBe(
    "",
  );
  expect(p.onClose).toHaveBeenCalledOnce();
});
