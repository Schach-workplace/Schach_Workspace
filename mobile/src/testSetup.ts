import { vi } from "vitest";

// Existing unit fixtures model a custom native build. Expo Go tests override
// this SDK runtime probe explicitly; no application feature flag is mocked.
vi.mock("expo", () => ({ isRunningInExpoGo: () => false }));
