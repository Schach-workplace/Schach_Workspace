import type { IntelligenceSourceRequest } from '../data/intelligence';
import {
  selectionIdentity,
  toggleIntelligenceSource,
} from '../../../shared/intelligence/selection';
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
  onChange: (s: IntelligenceSourceRequest[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset disabled={disabled}>
      <legend>Explicit selected sources ({selected.length}/50)</legend>
      {choices.length === 0 && (
        <p>Open a readable task, report or conversation to choose sources.</p>
      )}
      {choices.map(({ label, source }) => (
        <label
          key={selectionIdentity(source)}
          style={{ display: 'flex', alignItems: 'center', minHeight: 44, gap: 8 }}
        >
          <input
            type="checkbox"
            checked={selected.some((s) => selectionIdentity(s) === selectionIdentity(source))}
            onChange={() => onChange(toggleIntelligenceSource(selected, source))}
          />
          {label}
          {source.expectedRevision
            ? ` · revision ${source.expectedRevision}`
            : source.expectedVersion
              ? ` · version ${source.expectedVersion}`
              : ''}
        </label>
      ))}
    </fieldset>
  );
}
