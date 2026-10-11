import { useState } from "react";
import { client } from "./client";
import { Redirect, useLocalSearchParams } from "expo-router";
import { Text } from "react-native";
import { useWorkspace } from "./Workspace";
import PeopleScreen from "./PeopleScreen";
import PeopleOnboarding from "./PeopleOnboarding";
import PeoplePresetEditor from "./PeoplePresetEditor";
import AccessReview from "./AccessReview";
import DepartureHandover from "./DepartureHandover";
export default function PeopleRoute({
  flow,
}: {
  flow:
    "directory" | "person" | "onboard" | "presets" | "reviews" | "departure";
}) {
  const w = useWorkspace();
  const [actor, setActor] = useState("");
  const m = w.work?.me;
  const currentActor = m
    ? JSON.stringify([m.memberAccessEpoch, m.role, m.departmentId, m.managerId])
    : actor;
  if (currentActor !== actor) setActor(currentActor);
  const p = useLocalSearchParams<{ id: string; company: string }>();
  if (w.restoring && !w.session) return <Text>Checking session…</Text>;
  if (!w.session) return <Redirect href="/login" />;
  if (p.company && p.company !== w.company)
    return <Redirect href="/(tabs)/work" />;
  const key =
    w.company +
    ":" +
    w.session.user.id +
    ":" +
    client.generation +
    ":" +
    currentActor +
    ":" +
    (p.id ?? "");
  switch (flow) {
    case "onboard":
      return <PeopleOnboarding key={key} />;
    case "presets":
      return <PeoplePresetEditor key={key} />;
    case "reviews":
      return <AccessReview key={key} />;
    case "departure":
      return <DepartureHandover key={key} userId={p.id} />;
    default:
      return (
        <PeopleScreen key={key} userId={flow === "person" ? p.id : undefined} />
      );
  }
}
