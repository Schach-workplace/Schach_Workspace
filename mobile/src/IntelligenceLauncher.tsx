import { useState } from "react";
import { Action, Sheet } from "./ConnectUI";
import { useWorkspace } from "./Workspace";
import IntelligenceScreen from "./IntelligenceScreen";
import type { IntelligenceChoice } from "./IntelligenceSelection";
import type { IntelligenceOperation } from "./intelligenceClient";
export default function IntelligenceLauncher({
  choices = [],
  operation = "summary",
  label = "Local assistance",
}: {
  choices?: IntelligenceChoice[];
  operation?: IntelligenceOperation;
  label?: string;
}) {
  const w = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Action title={label} onPress={() => setOpen(true)} />
      {open && (
        <Sheet title="Local assistance" onClose={() => setOpen(false)}>
          <IntelligenceScreen
            key={w.company + ":" + w.session?.user.id + ":" + w.policyEpoch}
            choices={choices}
            initialOperation={operation}
          />
        </Sheet>
      )}
    </>
  );
}
