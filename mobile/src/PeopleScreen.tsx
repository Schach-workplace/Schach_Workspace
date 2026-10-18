import { ScreenHeading, mobileUI } from "./MobileUI";
import PeopleMembershipEditor from "./PeopleMembershipEditor";
import { useState } from "react";
import { Text, View } from "react-native";
import { router } from "expo-router";
import { useWorkspace } from "./Workspace";
import Page from "./PeoplePage";
import { Action } from "./ConnectUI";
import { PeopleField } from "./PeopleControls";
import { DirectCompanyRevocation } from "./DepartureHandover";
export default function PeopleScreen({ userId }: { userId?: string }) {
  const w = useWorkspace();
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const admin =
    !!w.work && ["founder", "ceo", "admin"].includes(w.work.me.role);
  const person = w.work?.people.find((p) => p.id === userId);
  const current = w.foreground && !!w.work;
  return (
    <Page>
      <ScreenHeading
        title="People"
        description="Company directory and access"
      />
      {current && (
        <>
          {userId ? (
            person ? (
              <>
                <Text style={mobileUI.sectionTitle}>
                  {person.name} · {person.role}
                </Text>
                <Text style={mobileUI.secondary}>
                  {person.email} · {person.title}
                </Text>
                {admin && (
                  <>
                    <Action
                      title="Edit company access"
                      onPress={() => setEditing(true)}
                    />
                    {editing && (
                      <PeopleMembershipEditor
                        person={person}
                        onClose={() => setEditing(false)}
                      />
                    )}
                    <Action
                      title="Review company departure"
                      onPress={() =>
                        router.push({
                          pathname: "/people/departure/[id]",
                          params: { id: userId, company: w.company },
                        })
                      }
                    />
                    <DirectCompanyRevocation userId={userId} />
                  </>
                )}
              </>
            ) : (
              <Text>
                This person is unavailable in your current company scope.
              </Text>
            )
          ) : (
            <>
              <PeopleField
                label="Search people"
                value={search}
                onChange={setSearch}
              />
              {admin && (
                <>
                  <Action
                    title="Add person"
                    onPress={() =>
                      router.push({
                        pathname: "/people/onboard",
                        params: { company: w.company },
                      })
                    }
                  />
                  <Action
                    title="Onboarding presets"
                    onPress={() =>
                      router.push({
                        pathname: "/people/presets",
                        params: { company: w.company },
                      })
                    }
                  />
                  <Action
                    title="Review access"
                    onPress={() =>
                      router.push({
                        pathname: "/people/reviews",
                        params: { company: w.company },
                      })
                    }
                  />
                </>
              )}
              {w
                .work!.people.filter((p) =>
                  (p.name + " " + p.email)
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((p) => (
                  <View key={p.id} style={mobileUI.surface}>
                    <Action
                      title={
                        p.name +
                        " · " +
                        p.role +
                        (p.active ? "" : " · Inactive")
                      }
                      onPress={() =>
                        router.push({
                          pathname: "/people/[id]",
                          params: { id: p.id, company: w.company },
                        })
                      }
                    />
                  </View>
                ))}
            </>
          )}
        </>
      )}
    </Page>
  );
}
