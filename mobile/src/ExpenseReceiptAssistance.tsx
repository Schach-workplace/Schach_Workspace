import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace, type NativeExpense } from "./Workspace";
import { Action } from "./ConnectUI";
import { useRamInput } from "./ramInput";
import { useExecutionRead, useExecutionMutation } from "./execution";
import FinanceReceiptReview from "./FinanceReceiptReview";
export default function ExpenseReceiptAssistance({
  expenseId,
  receiptId,
}: {
  expenseId: string;
  receiptId: string;
}) {
  const w = useWorkspace();
  const q = useExecutionRead<{ expense: NativeExpense }>(
    "/expenses/" + expenseId,
  );
  const [job, setJob] = useRamInput(
    "$existing-receipt:" + receiptId,
    "job",
    "",
  );
  const [department, setDepartment] = useRamInput(
    "$existing-receipt:" + receiptId,
    "destination",
    "",
  );
  const [optIn, setOptIn] = useRamInput(
    "$existing-receipt:" + receiptId,
    "optIn",
    false,
  );
  const [done, setDone] = useState("");
  const assess = useExecutionMutation("$receipt-assess:" + receiptId, [
    "/expenses/" + expenseId,
  ]);
  const extract = useExecutionMutation("$receipt-extract:" + receiptId, [
    "/expenses/" + expenseId,
  ]);
  const authority = ["founder", "ceo", "admin", "finance"].includes(
    w.work?.me.role ?? "",
  );
  const current = q.data?.expense;
  const exists = current?.receipts.some((r) => r.id === receiptId);
  return (
    <View>
      {q.ready && exists && (
        <>
          <Text>Choose reviewed extraction destination</Text>
          {w.work?.departments
            .filter((d) => authority || d.id === w.work?.me.departmentId)
            .map((d) => (
              <Action
                key={d.id}
                title={d.name}
                disabled={!!extract.attempt || extract.busy}
                selected={department === d.id}
                onPress={() => setDepartment(d.id)}
              />
            ))}
          <Action
            title="Request clean assessment for extraction"
            disabled={assess.busy}
            onPress={() =>
              void assess
                .execute(
                  "/expense-receipts/" + receiptId + "/assessment",
                  assess.attempt?.payload ?? {
                    expectedExpenseVersion: current!.version,
                  },
                )
                .then(() =>
                  setDone(
                    "Clean assessment requested. Check extraction when the scanner completes.",
                  ),
                )
                .catch(() => {})
            }
          />
          <Text>{done}</Text>
          <Action
            title="Use local extraction and review all candidates"
            selected={optIn}
            disabled={!!extract.attempt || extract.busy}
            onPress={() => setOptIn(!optIn)}
          />
          <Action
            title={
              extract.attempt
                ? "Retry same extraction"
                : "Extract assessed receipt"
            }
            disabled={!optIn || !department || extract.busy}
            onPress={() =>
              void extract
                .execute<{ id: string }>(
                  "/finance/receipt-extractions",
                  extract.attempt?.payload ?? {
                    source: {
                      kind: "expense_receipt",
                      id: receiptId,
                      expectedVersion: current!.version,
                    },
                    destinationDepartmentId: department,
                    optIn: true,
                    ...(current!.createdBy === w.work?.me.id &&
                    current!.status === "draft" &&
                    current!.departmentId === department
                      ? {
                          targetExpenseId: expenseId,
                          expectedTargetVersion: current!.version,
                        }
                      : {}),
                  },
                  "POST",
                  (r) => setJob(r.id),
                )
                .catch(() => {})
            }
          />
        </>
      )}
      {job && (
        <FinanceReceiptReview
          jobId={job}
          onClose={() => setJob("")}
          onCreated={(id) => {
            setJob("");
            router.push({
              pathname: "/expense/[id]",
              params: { id, company: w.company },
            });
          }}
        />
      )}
      <Text accessibilityRole="alert">
        {assess.error || extract.error || q.error}
      </Text>
    </View>
  );
}
