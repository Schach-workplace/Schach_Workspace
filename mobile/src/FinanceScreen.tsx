import FinanceExport from "./FinanceExport";
import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace } from "./Workspace";
import {
  ScreenHeading,
  FilterBar,
  RecordCard,
  EmptyState,
  mobileUI,
} from "./MobileUI";
import { Action } from "./ConnectUI";
import FinanceDraftForm from "./FinanceDraftForm";
import { formatExactMoney } from "../../shared/finance/money";
export default function FinanceScreen() {
  const w = useWorkspace();
  const [exporting, setExporting] = useState(false);
  const [create, setCreate] = useState(false);
  const [status, setStatus] = useState("all");
  const ready = w.foreground && !!w.work;
  const allowed = ready && w.work?.me.role !== "viewer";
  const rows = (w.work?.expenses ?? []).filter(
    (e) => status === "all" || e.status === status,
  );
  return (
    <Page scroll={false} safeBottom>
      {!allowed ? (
        <Text>
          {ready
            ? "Your current role cannot access finance."
            : "Checking current finance access…"}
        </Text>
      ) : (
        <>
          <FlatList
            data={rows}
            keyExtractor={(e) => e.id}
            contentContainerStyle={mobileUI.listContent}
            ListHeaderComponent={
              <View>
                <ScreenHeading
                  title="Finance"
                  description="Track expenses from draft to payment."
                  action={
                    <Action
                      title="Create expense draft"
                      primary
                      onPress={() => setCreate(true)}
                    />
                  }
                />
                <Action
                  title="Receipt extraction, duplicates and statements"
                  onPress={() =>
                    router.push({
                      pathname: "/finance/assistance",
                      params: { company: w.company },
                    })
                  }
                />
                <FilterBar
                  label="Expense status"
                  value={status}
                  options={[
                    "all",
                    "draft",
                    "submitted",
                    "approved",
                    "paid",
                    "rejected",
                    "void",
                  ].map((s) => ({
                    value: s,
                    label: s === "all" ? "All authorized expenses" : s,
                  }))}
                  onChange={setStatus}
                />
                <Action
                  title="Export reviewed expense CSV"
                  disabled={!rows.length}
                  onPress={() => setExporting(true)}
                />
                <Text style={mobileUI.secondary}>
                  {rows.length} matching authorized expenses
                </Text>
              </View>
            }
            ListEmptyComponent={
              <EmptyState
                title="No expenses in this view"
                description="Choose another status, or create a draft for a new expense."
              />
            }
            renderItem={({ item: e }) => (
              <RecordCard
                title={e.title}
                label={"Inspect " + e.title}
                status={e.status}
                trailing={formatExactMoney(e.amountMinor, e.currency)}
                onPress={() =>
                  router.push({
                    pathname: "/expense/[id]",
                    params: { id: e.id, company: w.company },
                  })
                }
              />
            )}
          />
        </>
      )}
      {exporting && ready && allowed && (
        <FinanceExport
          key={w.company + ":" + w.session?.user.id + ":" + w.policyEpoch}
          expenses={rows}
          onClose={() => setExporting(false)}
        />
      )}
      {create && ready && allowed && (
        <FinanceDraftForm
          onClose={() => setCreate(false)}
          onCreated={(id) => {
            setCreate(false);
            router.push({
              pathname: "/expense/[id]",
              params: { id, company: w.company },
            });
          }}
        />
      )}
    </Page>
  );
}
