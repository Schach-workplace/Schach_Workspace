import type { MembershipDefaults } from "./people";

// Authored text lives in the existing scoped RAM draft, never a second store.
export type CapacityDraft = { capacityInput?: string };
type CapacityValue = Partial<MembershipDefaults> & CapacityDraft;
export function capacityValid(value: CapacityValue) {
  const text = value.capacityInput;
  if (text !== undefined && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(text))
    return false;
  const number = text === undefined ? value.capacityHours : Number(text);
  return (
    number === undefined ||
    (Number.isFinite(number) && number >= 0 && number <= 168)
  );
}
export function membershipForSubmission<T extends CapacityValue>(value: T) {
  if (!capacityValid(value))
    throw new Error("Enter complete weekly hours from 0 to 168.");
  const { capacityInput, ...fields } = value;
  return {
    ...fields,
    ...(capacityInput === undefined
      ? {}
      : { capacityHours: Number(capacityInput) }),
  };
}
