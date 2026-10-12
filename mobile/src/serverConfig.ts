// Distribution builds bake in the single company server through
// EXPO_PUBLIC_SERVER_URL (eas.json build profiles). Expo inlines
// process.env.EXPO_PUBLIC_* at bundle time, so keep this literal access.
// Origin validation (HTTPS in release, no credentials or path) stays in the client.
export function configuredServer(): string {
  return (process.env.EXPO_PUBLIC_SERVER_URL ?? "").trim();
}
export function serverHost(server: string): string {
  try {
    return new URL(server).host || server;
  } catch {
    return server;
  }
}
