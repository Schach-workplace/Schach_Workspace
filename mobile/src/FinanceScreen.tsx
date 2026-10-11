import { useState } from "react";
import { FlatList, Text, View } from "react-native";
import { router } from "expo-router";
import { Page, useWorkspace, styles } from "./Workspace";
import { Action } from "./ConnectUI";
import FinanceDraftForm from "./FinanceDraftForm";
import { formatExactMoney } from "../../shared/finance/money";
export default function FinanceScreen() {
  const w = useWorkspace();
  const [create, setCreate] = useState(false);
  const [status, setStatus] = useState("all");
  const ready = w.foreground && !!w.work;
  const allowed = ready && w.work?.me.role !== "viewer";
  return (
    <Page scroll={false} safeBottom>
      <Text style={styles.heading}>Finance</Text>
      {!allowed ? (
        <Text>
          {ready
            ? "Your current role cannot access finance."
            : "Checking current finance access…"}
        </Text>
      ) : (
        <>
          <View>
            <Action
              title="Create expense draft"
              onPress={() => setCreate(true)}
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
            {[
              "all",
              "draft",
              "submitted",
              "approved",
              "paid",
              "rejected",
              "void",
            ].map((s) => (
              <Action
                key={s}
                title={s === "all" ? "All authorized expenses" : s}
                selected={s === status}
                onPress={() => setStatus(s)}
              />
            ))}
          </View>
          <FlatList
            data={(w.work?.expenses ?? []).filter(
              (e) => status === "all" || e.status === status,
            )}
            keyExtractor={(e) => e.id}
            renderItem={({ item: e }) => (
              <View style={styles.message}>
                <Text>
                  {e.title} · {e.status} ·{" "}
                  {formatExactMoney(e.amountMinor, e.currency)}
                </Text>
                <Action
                  title={"Inspect " + e.title}
                  onPress={() =>
                    router.push({
                      pathname: "/expense/[id]",
                      params: { id: e.id, company: w.company },
                    })
                  }
                />
              </View>
            )}
          />
        </>
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
