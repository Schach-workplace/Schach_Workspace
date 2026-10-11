import { Redirect, useLocalSearchParams } from "expo-router";
import { useWorkspace } from "../../Workspace";
import FinanceAssistanceScreen from "../../FinanceAssistanceScreen";
export default function Route() {
  const w = useWorkspace();
  const p = useLocalSearchParams<{
    company?: string;
    extraction?: string;
    intake?: string;
    tool?: string;
    candidate?: string;
    row?: string;
    import?: string;
  }>();
  if (!w.session && !w.restoring) return <Redirect href="/login" />;
  if (p.company && p.company !== w.company)
    return <Redirect href="/(tabs)/more" />;
  return (
    <FinanceAssistanceScreen
      initialJob={p.extraction}
      initialIntake={p.intake}
      initialTool={p.tool}
      initialCandidate={p.candidate}
      initialRow={p.row}
      initialImport={p.import}
    />
  );
}
