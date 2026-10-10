import * as SecureStore from "expo-secure-store";
import { authorizedSource } from "../../shared/communication/history";
export interface Session {
  user: { id: string; name: string };
  companies: { id: string; name: string }[];
}
export class NativeApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "NativeApiError";
  }
}
const key = "schach.session";
const endpointKey = "schach.endpoint";
export class NativeClient {
  endpoint = "";
  token = "";
  userId = "";
  generation = 0;
  onPolicyChange: ((status: number) => void) | undefined;
  private requests = new Set<AbortController>();
  private privateCancellations = new Set<() => void>();
  registerCancellation(cancel: () => void) {
    this.privateCancellations.add(cancel);
    return () => {
      this.privateCancellations.delete(cancel);
    };
  }
  private vault: Promise<void> = Promise.resolve();
  private address(endpoint: string) {
    const u = new URL(endpoint);
    if (
      u.protocol !== "https:" &&
      !(typeof __DEV__ !== "undefined" && __DEV__ && u.protocol === "http:")
    )
      throw new Error("A secure company server is required.");
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/")
      throw new Error(
        "Use the company server origin without credentials or a path.",
      );
    return u.origin;
  }
  private persist(generation: number, token: string, endpoint: string) {
    this.vault = this.vault
      .catch(() => {})
      .then(async () => {
        if (generation !== this.generation) return;
        await SecureStore.setItemAsync(key, token);
        await SecureStore.setItemAsync(endpointKey, endpoint);
      });
    return this.vault;
  }
  async restore() {
    const current = this.generation;
    const [endpoint, token] = await Promise.all([
      SecureStore.getItemAsync(endpointKey),
      SecureStore.getItemAsync(key),
    ]);
    if (current !== this.generation) return;
    try {
      this.endpoint = endpoint ? this.address(endpoint) : "";
      this.token = this.endpoint ? (token ?? "") : "";
    } catch {
      this.token = "";
      this.endpoint = "";
      await SecureStore.deleteItemAsync(key);
    }
  }
  async login(
    endpoint: string,
    email: string,
    password: string,
    code = "",
    recoveryCode = "",
  ) {
    this.clearGeneration();
    const current = this.generation;
    this.token = "";
    this.endpoint = this.address(endpoint);
    const result = await this.request<{ session: Session; token: string }>(
      "/auth/mobile-login",
      "POST",
      { email, password, code, recoveryCode },
    );
    if (current !== this.generation)
      throw new Error("Account changed during sign in.");
    this.token = result.token;
    this.userId = result.session.user.id;
    await this.persist(current, result.token, this.endpoint);
    if (current !== this.generation)
      throw new Error("Account changed during sign in.");
    return result.session;
  }
  clearGeneration() {
    this.generation++;
    for (const cancel of this.privateCancellations) cancel();
    for (const request of this.requests) request.abort();
    this.requests.clear();
  }
  async logout() {
    try {
      if (this.token) await this.request("/auth/logout", "POST", {});
    } finally {
      this.token = "";
      this.userId = "";
      this.clearGeneration();
      this.vault = this.vault
        .catch(() => {})
        .then(() => SecureStore.deleteItemAsync(key));
      await this.vault;
    }
  }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return this.send<T>(path, method, body);
  }
  async requestThread<T>(path: string): Promise<T> {
    if (
      !/^\/companies\/[^/]+\/conversations\/[^/]+\/messages\/[^/]+\/thread$/.test(
        path,
      )
    )
      throw Error("Choose a conversation message source.");
    return authorizedSource<T>(
      (p) => this.send<T>(p, "GET", undefined, p === path),
      path,
      path.split("/messages/")[0],
    );
  }
  private async send<T>(
    path: string,
    method: string,
    body?: unknown,
    contextual = false,
  ): Promise<T> {
    const current = this.generation;
    const abort = new AbortController();
    this.requests.add(abort);
    try {
      const response = await fetch(this.endpoint + "/api" + path, {
        method,
        signal: abort.signal,
        headers: {
          Accept: "application/json",
          ...(this.token ? { Authorization: "Bearer " + this.token } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const value = await response.json().catch(() => ({}));
      if (current !== this.generation)
        throw new Error("Account or company changed. Refresh current access.");
      if (!response.ok) {
        if (
          [401, 403, 404].includes(response.status) &&
          !(contextual && response.status === 404)
        ) {
          this.clearGeneration();
          this.onPolicyChange?.(response.status);
        }
        throw new NativeApiError(
          response.status,
          value.error?.code ?? "",
          value.error?.message ?? "Company access is unavailable.",
        );
      }
      return value as T;
    } finally {
      this.requests.delete(abort);
    }
  }
  async appendFile(path: string, file: Blob, name: string) {
    const current = this.generation;
    const abort = new AbortController();
    this.requests.add(abort);
    try {
      const { fetch: send } = await import("expo/fetch");
      const form = new FormData();
      form.append("file", file, name);
      const response = await send(this.endpoint + "/api" + path, {
        method: "POST",
        signal: abort.signal,
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + this.token,
        },
        body: form,
      });
      const value = (await response.json().catch(() => ({}))) as {
        error?: { code?: string; message?: string };
      };
      if (current !== this.generation)
        throw Error("Company changed during evidence upload.");
      if (!response.ok) {
        if ([401, 403, 404].includes(response.status)) {
          this.clearGeneration();
          this.onPolicyChange?.(response.status);
        }
        throw new NativeApiError(
          response.status,
          value.error?.code ?? "",
          value.error?.message ?? "Evidence upload failed.",
        );
      }
      return value;
    } finally {
      this.requests.delete(abort);
    }
  }
  async upload(company: string, conversation: string, id: string, file: Blob) {
    const current = this.generation;
    const abort = new AbortController();
    this.requests.add(abort);
    try {
      const { fetch: uploadFetch } = await import("expo/fetch");
      const response = await uploadFetch(
        this.endpoint +
          `/api/companies/${company}/conversations/${conversation}/media/${id}/upload`,
        {
          method: "POST",
          signal: abort.signal,
          headers: { Authorization: "Bearer " + this.token },
          body: file,
        },
      );
      if (current !== this.generation)
        throw new Error("Company changed during upload.");
      if (!response.ok)
        throw new Error("Media upload failed. Keep the original and retry.");
    } finally {
      this.requests.delete(abort);
    }
  }
}
export const client = new NativeClient();
