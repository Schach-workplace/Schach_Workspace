import { Text, View } from "react-native";
import { Action } from "./ConnectUI";
import type { IntelligenceSourceRequest } from "./intelligenceClient";
import {
  selectionIdentity,
  toggleIntelligenceSource,
} from "../../shared/intelligence/selection";
export interface IntelligenceChoice {
  label: string;
  source: IntelligenceSourceRequest;
}
export default function IntelligenceSelection({
  choices,
  selected,
  onChange,
  disabled = false,
}: {
  choices: IntelligenceChoice[];
  selected: IntelligenceSourceRequest[];
  onChange: (sources: IntelligenceSourceRequest[]) => void;
  disabled?: boolean;
}) {
  return (
    <View>
      <Text>Explicit selected sources ({selected.length}/50)</Text>
      {choices.length === 0 && (
        <Text>
          Choose sources from a readable conversation, task or report.
        </Text>
      )}
      {choices.map((choice) => (
        <Action
          key={selectionIdentity(choice.source)}
          title={
            choice.label +
            (choice.source.expectedRevision
              ? " · revision " + choice.source.expectedRevision
              : choice.source.expectedVersion
                ? " · version " + choice.source.expectedVersion
                : "")
          }
          selected={selected.some(
            (s) => selectionIdentity(s) === selectionIdentity(choice.source),
          )}
          disabled={disabled}
          onPress={() =>
            onChange(toggleIntelligenceSource(selected, choice.source))
          }
        />
      ))}
    </View>
  );
}
