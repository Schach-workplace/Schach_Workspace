import { useState } from 'react';
import { request } from '../data/api';
import { useWorkspace } from '../store';
import { ErrorMessage } from './UI';

const phrase = 'OFFBOARD';

// Platform-operator-only global offboarding: suspends the account and revokes
// access in every company. The server enforces IsPlatformAdmin; this only hides
// the control from everyone else.
export default function GlobalOffboarding({ userId }: { userId: string }) {
  const w = useWorkspace();
  const user = w.session?.user;
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  if (w.mode !== 'api' || !user?.isPlatformAdmin || user.id === userId) return null;
  async function offboard() {
    setBusy(true);
    setError('');
    try {
      const result = await request<{ ok: boolean; id: string; handoverStatus?: string }>(
        `/admin/users/${encodeURIComponent(userId)}/offboard`,
        { method: 'POST', body: {} },
      );
      setTyped('');
      setDone(
        'Account suspended and access revoked in every company. ' +
          (result.handoverStatus === 'not_performed'
            ? 'Handover was not performed.'
            : 'Handover status: ' + (result.handoverStatus ?? 'unknown') + '.'),
      );
    } catch (e) {
      setError((e as Error).message || 'Global offboarding failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section>
      <h3>Global offboarding (platform operator)</h3>
      <p>
        Suspends this account, signs out every session and revokes access in every company. Company
        ownership and owned conversations must be transferred first. Handover is not performed.
      </p>
      {done && <p role="status">{done}</p>}
      <ErrorMessage error={error} />
      {!done && (
        <>
          <label>
            Type {phrase} to confirm
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </label>
          <button
            className="button button-danger"
            disabled={busy || typed !== phrase}
            onClick={() => void offboard()}
          >
            Offboard from every company
          </button>
        </>
      )}
    </section>
  );
}
