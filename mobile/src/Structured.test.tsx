// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import Structured from "./Structured";
vi.mock("./IntelligenceLauncher", () => ({ default: () => null }));
const env = vi.hoisted(() => ({
  epoch: 0,
  record: 0,
  foreground: true,
  generation: 1,
  request: vi.fn(),
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
    work: { readBasis: "basis", me: { role: "member" }, people: [] },
  }),
}));
vi.mock("react-native", () => ({
  Text: ({ children }: any) => createElement("span", {}, children),
  View: ({ children }: any) => createElement("div", {}, children),
  Button: ({ title }: any) => createElement("button", {}, title),
  TextInput: () => null,
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
