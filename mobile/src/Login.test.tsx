// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Login from "./app/login";
const env = vi.hoisted(() => ({
  signIn: vi.fn(async () => {}),
  endpoint: "",
  error: "",
  setError: vi.fn(),
}));
vi.mock("./Workspace", () => ({
  useWorkspace: () => ({
    session: null,
    error: env.error,
    signIn: env.signIn,
    setError: env.setError,
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
  ui: {},
  Action: ({ title, onPress, disabled }: any) =>
    createElement("button", { onClick: onPress, disabled }, title),
}));
vi.mock("react-native-safe-area-context", () => ({
  SafeAreaView: ({ children }: any) => createElement("main", {}, children),
}));
vi.mock("./KeyboardFrame", () => ({
  default: ({ children }: any) => children,
}));
vi.mock("expo-router", () => ({
  Redirect: ({ href }: any) => createElement("span", {}, "Redirect " + href),
}));
vi.mock("react-native", () => ({
  StyleSheet: { create: <T,>(s: T) => s },
  View: ({ children }: any) => createElement("div", {}, children),
  ScrollView: ({ children }: any) => createElement("div", {}, children),
  Text: ({ children, onPress }: any) =>
    createElement("span", { onClick: onPress }, children),
  TextInput: ({
    accessibilityLabel,
    value,
    onChangeText,
    secureTextEntry,
    autoComplete,
    textContentType,
    editable,
  }: any) =>
    createElement("input", {
      "aria-label": accessibilityLabel,
      value,
      onInput: (e: any) => onChangeText(e.target.value),
      type: secureTextEntry ? "password" : "text",
      autoComplete,
      "data-content-type": textContentType,
      disabled: editable === false,
    }),
}));
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  env.signIn.mockReset().mockResolvedValue(undefined);
  env.setError.mockReset();
  env.error = "";
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
  expect(serverField(c)?.value).toBe("http://localhost:8080");
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

async function fill(c: HTMLElement, label: string, value: string) {
  const input = c.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it("has visible credential labels and password-manager hints with an explicit visibility toggle", async () => {
  const { c, press, unmount } = await render();
  await press("Use authenticator or recovery code");
  for (const label of [
    "Email",
    "Password",
    "Authenticator code",
    "Recovery code",
  ]) {
    expect(
      [...c.querySelectorAll("span")].some((e) => e.textContent === label),
    ).toBe(true);
  }
  const password = c.querySelector(
    '[aria-label="Password"]',
  ) as HTMLInputElement;
  expect(password.type).toBe("password");
  expect(password.autocomplete).toBe("current-password");
  expect(
    c.querySelector('[aria-label="Email"]')?.getAttribute("autocomplete"),
  ).toBe("username");
  expect(
    c
      .querySelector('[aria-label="Authenticator code"]')
      ?.getAttribute("autocomplete"),
  ).toBe("one-time-code");
  await press("Show password");
  expect(password.type).toBe("text");
  await press("Hide password");
  expect(password.type).toBe("password");
  await unmount();
});
it("keeps one pending sign-in and clears secrets after the original MFA/recovery request succeeds", async () => {
  vi.stubEnv("EXPO_PUBLIC_SERVER_URL", "https://work.schachengineers.com");
  let resolve!: () => void;
  env.signIn.mockImplementationOnce(
    () =>
      new Promise<void>((r) => {
        resolve = r;
      }),
  );
  const { c, press, unmount } = await render();
  await press("Use authenticator or recovery code");
  for (const [label, value] of [
    ["Email", "fictional@example.invalid"],
    ["Password", "Fictional secret"],
    ["Authenticator code", "123456"],
    ["Recovery code", "fictional-recovery"],
  ])
    await fill(c, label, value);
  await press("Sign in");
  expect(env.signIn).toHaveBeenCalledWith(
    "https://work.schachengineers.com",
    "fictional@example.invalid",
    "Fictional secret",
    "123456",
    "fictional-recovery",
  );
  expect(
    [...c.querySelectorAll("button")].find(
      (b) => b.textContent === "Signing in…",
    )?.disabled,
  ).toBe(true);
  await press("Signing in…");
  expect(env.signIn).toHaveBeenCalledOnce();
  await act(async () => resolve());
  for (const label of ["Password", "Authenticator code", "Recovery code"])
    expect(
      (c.querySelector(`[aria-label="${label}"]`) as HTMLInputElement).value,
    ).toBe("");
  await unmount();
});
it("allows retry after an error without discarding the entered credentials", async () => {
  env.signIn.mockRejectedValueOnce(Error("Fictional network failure"));
  const { c, press, unmount } = await render();
  await fill(c, "Password", "Fictional secret");
  await press("Sign in");
  expect(env.setError).toHaveBeenCalledWith("Fictional network failure");
  expect(
    (c.querySelector('[aria-label="Password"]') as HTMLInputElement).value,
  ).toBe("Fictional secret");
  await press("Sign in");
  expect(env.signIn).toHaveBeenCalledTimes(2);
  await unmount();
});

it("keeps optional verification out of the initial form and reveals both alternatives explicitly", async () => {
  const { c, press, unmount } = await render();
  expect(c.querySelector('[aria-label="Authenticator code"]')).toBeNull();
  expect(c.querySelector('[aria-label="Recovery code"]')).toBeNull();
  await press("Use authenticator or recovery code");
  expect(c.querySelector('[aria-label="Authenticator code"]')).not.toBeNull();
  expect(c.querySelector('[aria-label="Recovery code"]')).not.toBeNull();
  await unmount();
});
