import { Page, useWorkspace } from "../../Workspace";
import AttentionInbox from "../../AttentionInbox";
export default function Inbox() {
  const w = useWorkspace();
  return (
    <Page>
      <AttentionInbox key={w.company + ":" + w.session?.user.id} />
    </Page>
  );
}
