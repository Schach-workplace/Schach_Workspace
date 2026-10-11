/** Entity recovery wording; authority denial and transport errors retain their meaning. */
export function entityRecoveryError(error: unknown, entity: "goal" | "preset") {
  const e = error as { status?: number; code?: string; message?: string };
  if (e?.status === 409 && e.code === "version_conflict") {
    return entity === "goal"
      ? "This goal changed. Discard the submitted intent, then load the latest goal and version before editing again."
      : "This preset changed. Discard the submitted intent, then select the current preset and review its version before editing again.";
  }
  return (
    e?.message ??
    "The result is unknown. Retry the same submission when connected."
  );
}
