import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { request } from '../data/api';
import { demoAttentionPreferences } from '../data/demo';
import { ErrorMessage, Field } from './UI';
import type { AttentionPreference } from '../types';
export default function AttentionPreferences() {
  const store = useWorkspace();
  const [pref, setPref] = useState<AttentionPreference | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const company = store.companyId;
  const user = store.session?.user.id ?? '';
  useEffect(() => {
    const abort = new AbortController();
    setPref(null);
    setError('');
    const load =
      store.mode === 'demo'
        ? demoAttentionPreferences(company, user)
        : request<{ preferences: AttentionPreference }>(
            `/companies/${encodeURIComponent(company)}/attention/preferences`,
            { signal: abort.signal },
          ).then((r) => r.preferences);
    load
      .then((p) => {
        if (!abort.signal.aborted) setPref(p);
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(e.message);
      });
    return () => abort.abort();
  }, [company, user, store.mode]);
  const update = (patch: Partial<AttentionPreference>) =>
    setPref((p) => (p ? { ...p, ...patch } : p));
  async function save() {
    if (submitting.current || !pref) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await store.mutate('/attention/preferences', pref, 'PATCH');
      setPref((p) => (p ? { ...p, version: p.version + 1 } : p));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="panel attention-inbox">
      <h2>Attention delivery preferences</h2>
      <p>All clocks use {store.data?.company.timezone}. Snooze changes Inbox timing only.</p>
      <ErrorMessage error={error} />
      {!pref && !error && <p role="status">Loading preferences…</p>}
      {pref && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <input
              type="checkbox"
              checked={pref.workingHoursEnabled}
              disabled={busy}
              onChange={(e) => update({ workingHoursEnabled: e.target.checked })}
            />
            Enable working hours
          </label>
          {pref.workingHoursEnabled && (
            <>
              <fieldset>
                <legend>Working weekdays</legend>
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(
                  (day, i) => (
                    <label key={day}>
                      <input
                        type="checkbox"
                        checked={pref.workingDays.includes(i + 1)}
                        disabled={busy}
                        onChange={(e) =>
                          update({
                            workingDays: e.target.checked
                              ? [...pref.workingDays, i + 1]
                              : pref.workingDays.filter((d) => d !== i + 1),
                          })
                        }
                      />
                      {day}
                    </label>
                  ),
                )}
              </fieldset>
              <Field label="Working hours start">
                <input
                  aria-label="Working hours start"
                  type="time"
                  value={pref.workingStart}
                  disabled={busy}
                  onChange={(e) => update({ workingStart: e.target.value })}
                />
              </Field>
              <Field label="Working hours end">
                <input
                  aria-label="Working hours end"
                  type="time"
                  value={pref.workingEnd}
                  disabled={busy}
                  onChange={(e) => update({ workingEnd: e.target.value })}
                />
              </Field>
            </>
          )}
          <Field label="Quiet hours start">
            <input
              aria-label="Quiet hours start"
              type="time"
              value={pref.quietStart}
              disabled={busy}
              onChange={(e) => update({ quietStart: e.target.value })}
            />
          </Field>
          <Field label="Quiet hours end">
            <input
              aria-label="Quiet hours end"
              type="time"
              value={pref.quietEnd}
              disabled={busy}
              onChange={(e) => update({ quietEnd: e.target.value })}
            />
          </Field>
          <button
            type="button"
            className="button button-secondary"
            disabled={busy}
            onClick={() => update({ quietStart: '', quietEnd: '' })}
          >
            Disable quiet hours
          </button>
          <label className="field">
            <input
              type="checkbox"
              checked={pref.escalationEnabled}
              disabled={busy}
              onChange={(e) => update({ escalationEnabled: e.target.checked })}
            />
            Enable escalation
          </label>
          {pref.escalationEnabled && (
            <>
              <Field label="Escalation after minutes">
                <input
                  aria-label="Escalation after minutes"
                  type="number"
                  min={1}
                  max={129600}
                  value={pref.escalationAfterMinutes}
                  disabled={busy}
                  onChange={(e) => update({ escalationAfterMinutes: Number(e.target.value) })}
                />
              </Field>
              <Field label="Escalation recipient">
                <select
                  aria-label="Escalation recipient"
                  value={pref.escalationUserId}
                  disabled={busy}
                  onChange={(e) => update({ escalationUserId: e.target.value })}
                >
                  <option value="">Choose a person</option>
                  {store.data?.people
                    .filter((p) => p.active && p.id !== user)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <p>The recipient must also have current authority for each source.</p>
            </>
          )}
          <button className="button button-primary" disabled={busy} type="submit">
            {busy ? 'Saving…' : 'Save attention preferences'}
          </button>
        </form>
      )}
    </section>
  );
}
