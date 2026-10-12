import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import Calls from "../../Calls";
import { Page } from "../../Workspace";
export default function CallScreen() {
  const [focused, setFocused] = useState(false);
  // Active calls refresh on focus and periodically only while this tab is shown.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return (
    <Page>
      <Calls focused={focused} />
    </Page>
  );
}
