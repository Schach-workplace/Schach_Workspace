import { capacityValid, membershipForSubmission } from "./peopleCapacity";
import { useState } from "react";
import { Text } from "react-native";
import { useWorkspace } from "./Workspace";
import { Action, Sheet } from "./ConnectUI";
import { businessAttemptGeneration } from "./businessAttempts";
import { client } from "./client";
import { useRamInput } from "./ramInput";
import { usePeopleRead, type PeopleContext, type PeoplePerson } from "./people";
import { PeopleMembershipFields, SessionEffect } from "./PeopleControls";
export default function PeopleMembershipEditor({
  person,
  onClose,
}: {
  person: PeoplePerson;
  onClose: () => void;
}) {
  const w = useWorkspace();
  const context = usePeopleRead<PeopleContext>("/people/context");
  const [draft, setDraft, retire] = useRamInput(
    "$people-membership:" + person.id,
    "draft",
    () => ({
      expectedVersion: person.membershipVersion,
      role: person.role,
      departmentId: person.departmentId,
      managerId: person.managerId,
      title: person.title,
      capacityHours: person.capacityHours,
    }),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reactivate, setReactivate] = useState(false);
  async function save() {
    if (!context.ready || busy || !capacityValid(draft)) return;
    setBusy(true);
    const generation = client.generation;
    const authority = businessAttemptGeneration();
    try {
      await client.request(
        "/companies/" + w.company + "/people/" + person.id,
        "PATCH",
        {
          ...membershipForSubmission(draft),
          ...(!person.active && reactivate ? { active: true } : {}),
        },
      );
      if (
        generation !== client.generation ||
        authority !== businessAttemptGeneration()
      )
        return;
      retire(draft);
      onClose();
      await w.refresh();
    } catch (e) {
      if (
        generation === client.generation &&
        authority === businessAttemptGeneration()
      )
        setError((e as Error).message);
    } finally {
      if (
        generation === client.generation &&
        authority === businessAttemptGeneration()
      )
        setBusy(false);
    }
  }
  return (
    <Sheet
      title={"Edit company access for " + person.name}
      onClose={onClose}
      busy={busy}
    >
      <Text>
        Captured membership version {draft.expectedVersion}. A conflict requires
        deliberate inspection of current membership.
      </Text>
      <PeopleMembershipFields
        value={draft}
        context={context.data}
        disabled={!context.ready || busy}
        onChange={(fields) => setDraft({ ...draft, ...fields })}
      />
      {!person.active && (
        <>
          <Text>
            Rejoining starts fresh company access. Historical private
            conversations require an explicit new owner invitation.
          </Text>
          <Action
            title="Reactivate this company membership"
            selected={reactivate}
            disabled={!context.ready || busy}
            onPress={() => setReactivate(!reactivate)}
          />
        </>
      )}
      <SessionEffect
        effect={{
          reauthenticate:
            draft.role !== person.role ||
            draft.departmentId !== person.departmentId ||
            draft.managerId !== person.managerId ||
            reactivate,
          scope: "account_sessions",
          devicesMustReregister: true,
          callsMustRejoin: true,
          otherCompanyMembershipsPreserved: true,
        }}
      />
      <Text accessibilityLiveRegion="polite">{error}</Text>
      <Action
        title="Save reviewed company access"
        primary
        disabled={!context.ready || busy || !capacityValid(draft)}
        onPress={() => void save()}
      />
      <Action
        title="Load current membership and version"
        disabled={!context.ready || busy}
        onPress={() => {
          const p = context.data?.people.find((p) => p.id === person.id);
          if (p) {
            setDraft({
              expectedVersion: p.membershipVersion,
              role: p.role,
              departmentId: p.departmentId,
              managerId: p.managerId,
              title: p.title,
              capacityHours: p.capacityHours,
            });
            setError("");
          }
        }}
      />
    </Sheet>
  );
}
