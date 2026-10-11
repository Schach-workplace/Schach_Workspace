import { sessionEffectCopy, type SessionEffect as Effect } from '../data/people';
export default function SessionEffect({ effect }: { effect?: Effect }) {
  return effect?.reauthenticate ? (
    <p role="note">{sessionEffectCopy}</p>
  ) : (
    <p role="note">This attestation does not change account sessions.</p>
  );
}
