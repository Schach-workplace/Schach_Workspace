// Shared native presentation only; business state and authority live elsewhere.
export const colors = {
  canvas: "#f4f6fa",
  surface: "#ffffff",
  text: "#172235",
  secondary: "#526079",
  border: "#dce2eb",
  accent: "#b64b0b",
  accentSoft: "#fff1e6",
  error: "#923b32",
  errorSurface: "#fff1ee",
} as const;
export const metrics = {
  touch: 48,
  input: 52,
  gutter: 20,
  radius: 12,
} as const;
export const typeScale = {
  heading: 26,
  title: 20,
  body: 16,
  support: 14,
  meta: 13,
} as const;
