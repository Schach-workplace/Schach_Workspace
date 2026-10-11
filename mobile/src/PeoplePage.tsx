import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { Page } from "./Workspace";
import KeyboardFrame from "./KeyboardFrame";
export default function PeoplePage({ children }: { children: ReactNode }) {
  return (
    <Page scroll={false} preserveMounted>
      <KeyboardFrame>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={{ gap: 12, paddingBottom: 32 }}
        >
          {children}
        </ScrollView>
      </KeyboardFrame>
    </Page>
  );
}
