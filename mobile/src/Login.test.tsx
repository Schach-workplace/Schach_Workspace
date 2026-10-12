// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Login from "./app/login";
const env = vi.hoisted(() => ({
  signIn: vi.fn(async () => {}),
  endpoint: "",
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({
    session: null,
    error: "",
    signIn: env.signIn,
    setError: vi.fn(),
  }),
  styles: {},
}));
vi.mock("./client", () => ({
  client: {
    get endpoint() {
      return env.endpoint;
    },
  },
}));
vi.mock("./ConnectUI", () => ({
  Action: ({ title, onPress }: any) =>
    createElement("button", { onClick: onPress }, title),
}));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: any) => createElement("span", {}, "Redirect " + href),
}));
vi.mock("react-native", () => ({
  View: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, onPress }: any) =>
    createElement("span", { onClick: onPress }, children),
  TextInput: ({ accessibilityLabel, value }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      defaultValue: value,
    }),
}));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.signIn.mockClear();
  env.endpoint = "";
  vi.stubGlobal("__DEV__", false);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
async function render() {
  const c = document.createElement("div");
  const root = createRoot(c);
  await act(async () => root.render(createElement(Login)));
  const press = async (label: string) => {
    const target = [...c.querySelectorAll("button, span")].find(
      (e) => e.textContent === label,
    ) as HTMLElement;
    await act(async () => target.click());
  };
  return { c, press, unmount: () => act(async () => root.unmount()) };
}
const serverField = (c: HTMLElement) =>
  c.querySelector('[aria-label="Company server"]') as HTMLInputElement | null;

it("signs a release build in to the configured server without a server field", async () => {
  vi.stubEnv("EXPO_PUBLIC_SERVER_URL", "https://work.schachengineers.com");
  env.endpoint = "https://retained.example.in";
  const { c, press, unmount } = await render();
  expect(c.textContent).toContain("Workspace");
  expect(c.textContent).not.toContain("Schach Workspace");
  expect(c.textContent).toContain("work.schachengineers.com");
  expect(serverField(c)).toBeNull();
  expect(c.textContent).not.toContain("Use a different server");
  await press("Sign in");
  expect(env.signIn).toHaveBeenCalledWith(
    "https://work.schachengineers.com",
    "",
    "",
    "",
    "",
  );
  await unmount();
});

it("lets only a development build switch away from the configured server", async () => {
  vi.stubEnv("EXPO_PUBLIC_SERVER_URL", "https://work.schachengineers.com");
  vi.stubGlobal("__DEV__", true);
  env.endpoint = "http://localhost:8080";
  const { c, press, unmount } = await render();
  expect(serverField(c)).toBeNull();
  await press("Use a different server");
  expect(serverField(c)?.defaultValue).toBe("http://localhost:8080");
  await press("Sign in");
  expect(env.signIn).toHaveBeenCalledWith(
    "http://localhost:8080",
    "",
    "",
    "",
    "",
  );
  await unmount();
});

it("keeps the server field when no server is configured", async () => {
  vi.stubEnv("EXPO_PUBLIC_SERVER_URL", "");
  const { c, unmount } = await render();
  expect(serverField(c)).not.toBeNull();
  expect(c.textContent).not.toContain("Use a different server");
  await unmount();
});
