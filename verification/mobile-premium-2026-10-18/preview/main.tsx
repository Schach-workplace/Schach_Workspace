import GrowthScreen from "../../../mobile/src/GrowthScreen";
import KnowledgeScreen from "../../../mobile/src/KnowledgeScreen";
import NativeConversation from "../../../mobile/src/NativeConversation";
import OverviewScreen from "../../../mobile/src/OverviewScreen";
import WorkloadScreen from "../../../mobile/src/WorkloadScreen";
import PlanningScreen from "../../../mobile/src/PlanningScreen";
import DeadlineAgenda from "../../../mobile/src/DeadlineAgenda";
import GoalsScreen from "../../../mobile/src/GoalsScreen";
import PeopleScreen from "../../../mobile/src/PeopleScreen";
import AccountScreen from "../../../mobile/src/AccountScreen";
import ProjectScreen from "../../../mobile/src/ProjectScreen";
import { createRoot } from "react-dom/client";
import { SafeAreaProvider } from "react-native-safe-area-context";
import WorkScreen from "../../../mobile/src/WorkScreen";
import FinanceScreen from "../../../mobile/src/FinanceScreen";
import ReportScreen from "../../../mobile/src/ReportScreen";
import ConnectList from "../../../mobile/src/ConnectList";
import AttentionInbox from "../../../mobile/src/AttentionInbox";
import { Page } from "./workspace";
const view = new URLSearchParams(location.search).get("view") || "work";
createRoot(document.getElementById("root")!).render(
  <SafeAreaProvider
    initialMetrics={{
      frame: { x: 0, y: 0, width: 390, height: 844 },
      insets: { top: 0, bottom: 0, left: 0, right: 0 },
    }}
  >
    {view === "growth" ? (
      <GrowthScreen />
    ) : view === "knowledge" ? (
      <KnowledgeScreen />
    ) : view === "chat" ? (
      <NativeConversation />
    ) : view === "overview" ? (
      <OverviewScreen />
    ) : view === "workload" ? (
      <WorkloadScreen />
    ) : view === "planning" ? (
      <PlanningScreen />
    ) : view === "agenda" ? (
      <DeadlineAgenda />
    ) : view === "goals" ? (
      <GoalsScreen />
    ) : view === "people" ? (
      <PeopleScreen />
    ) : view === "account" ? (
      <AccountScreen />
    ) : view === "project" ? (
      <ProjectScreen id="p" />
    ) : view === "work" ? (
      <WorkScreen />
    ) : view === "finance" ? (
      <FinanceScreen />
    ) : view === "reports" ? (
      <ReportScreen />
    ) : view === "inbox" ? (
      <Page>
        <AttentionInbox />
      </Page>
    ) : (
      <ConnectList />
    )}
  </SafeAreaProvider>,
);
