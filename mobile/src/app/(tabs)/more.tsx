import { router } from "expo-router";
import { Text } from "react-native";
import { Page, useWorkspace, styles } from "../../Workspace";
import { Action } from "../../ConnectUI";
export default function More() {
  const w = useWorkspace();
  return (
    <Page>
      <Text style={styles.heading}>Modules</Text>
      <Action
        title="Local assistance history"
        onPress={() =>
          router.push({
            pathname: "/intelligence/[id]",
            params: { company: w.company, id: "history" },
          })
        }
      />
      {w.foreground && w.work && (
        <>
          {w.work.me.role !== "viewer" && (
            <Action
              title="Finance"
              onPress={() =>
                router.push({
                  pathname: "/finance",
                  params: { company: w.company },
                })
              }
            />
          )}
          <Action
            title="People"
            onPress={() =>
              router.push({
                pathname: "/people",
                params: { company: w.company },
              })
            }
          />
          <Action
            title="Planning"
            onPress={() =>
              router.push({
                pathname: "/planning",
                params: { company: w.company },
              })
            }
          />
          <Action
            title="Goals"
            onPress={() =>
              router.push({
                pathname: "/goals",
                params: { company: w.company },
              })
            }
          />
          <Action
            title="Projects"
            onPress={() =>
              router.push({
                pathname: "/projects",
                params: { company: w.company },
              })
            }
          />
          <Action
            title="Reports"
            onPress={() =>
              router.push({
                pathname: "/reports",
                params: { company: w.company },
              })
            }
          />
          <Action
            title="Requests"
            onPress={() =>
              router.push({
                pathname: "/requests",
                params: { company: w.company },
              })
            }
          />
        </>
      )}
      <Action title="Account" onPress={() => router.push("/account")} />
    </Page>
  );
}
