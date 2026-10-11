import type { IntelligenceSelection, IntelligenceSourceRequest } from './types';
export const selectionIdentity = (s: IntelligenceSourceRequest) => JSON.stringify([s.kind, s.parentId ?? '', s.conversationId ?? '', s.id, s.selectedFieldSet]);
export function canonicalSelection(selection: IntelligenceSelection): IntelligenceSelection {
  if (!selection.sources.length || selection.sources.length > 50) throw Error('Select 1–50 sources.');
  if (selection.operation === 'transcript' && (selection.sources.length !== 1 || selection.sources[0].kind !== 'voice_media')) throw Error('Select exactly one attached audio recording.');
  const seen = new Set<string>();
  const sources = selection.sources.map(source => {
    const key = selectionIdentity(source);
    if (seen.has(key) || !source.id || !source.selectedFieldSet) throw Error('Select unique current sources.');
    seen.add(key); return { ...source };
  }).sort((a,b) => selectionIdentity(a).localeCompare(selectionIdentity(b)));
  return { ...selection, sources };
}
export function toggleIntelligenceSource(sources: IntelligenceSourceRequest[], source: IntelligenceSourceRequest): IntelligenceSourceRequest[] {
  const key = selectionIdentity(source);
  if (sources.some(s => selectionIdentity(s) === key)) return sources.filter(s => selectionIdentity(s) !== key);
  if (sources.length >= 50) throw Error('Select at most 50 sources.');
  return [...sources, source];
}
