import { router } from "expo-router";
import { Page, useWorkspace } from "../../Workspace";
import ModuleDirectory from "../../ModuleDirectory";
export default function More() {
  const w = useWorkspace();
  return (
    <Page>
      <ModuleDirectory
        key={w.company + ":" + w.session?.user.id + ":" + w.policyEpoch}
        workReady={w.foreground && !!w.work}
        role={w.work?.me.role}
        onOpen={(path) =>
          router.push({
            pathname: path,
            params:
              path === "/intelligence/[id]"
                ? { company: w.company, id: "history" }
                : { company: w.company },
          })
        }
        onAccount={() => router.push("/account")}
      />
    </Page>
  );
}
