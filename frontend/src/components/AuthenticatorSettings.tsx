import DeviceSessions from './DeviceSessions';
import { useEffect, useState } from 'react';
import { request } from '../data/api';
interface MFAStatus {
  enabled: boolean;
  configured: boolean;
}
export default function AuthenticatorSettings() {
  const [status, setStatus] = useState<MFAStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [password, setPassword] = useState('');
  const [secret, setSecret] = useState('');
  const [uri, setURI] = useState('');
  const [copied, setCopied] = useState('');
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function loadStatus() {
    setLoadError('');
    setStatus(null);
    void request<MFAStatus>('/auth/mfa')
      .then(setStatus)
      .catch((e) => setLoadError((e as Error).message || 'Unable to load authenticator status.'));
  }
  useEffect(loadStatus, []);
  async function act(path: string) {
    setBusy(true);
    setError('');
    try {
      if (path === 'setup') {
        const result = await request<{ secret: string; uri?: string }>('/auth/mfa/setup', {
          method: 'POST',
          body: { password },
        });
        setSecret(result.secret);
        setURI(result.uri ?? '');
        setCopied('');
        setPassword('');
      } else if (path === 'confirm') {
        const result = await request<{ recoveryCodes: string[] }>('/auth/mfa/confirm', {
          method: 'POST',
          body: { code },
        });
        setRecovery(result.recoveryCodes);
        setSecret('');
        setURI('');
        setCode('');
        setStatus((old) => (old ? { ...old, enabled: true } : old));
      } else {
        await request('/auth/mfa/disable', { method: 'POST', body: { password, code } });
        setStatus((old) => (old ? { ...old, enabled: false } : old));
        setPassword('');
        setCode('');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(uri);
      setCopied('Copied.');
    } catch {
      setCopied('Copy failed. Select the link and copy it manually.');
    }
  }
  const validCode = /^\d{6}$/.test(code);
  return (
    <>
      <section className="panel settings-section security-panel">
        <div className="section-header">
          <div>
            <h2>Authenticator protection</h2>
            {loadError ? (
              <p>Two-step sign-in status is unavailable right now.</p>
            ) : !status ? (
              <p role="status">Loading authenticator status…</p>
            ) : (
              <p>
                {status.enabled
                  ? 'Enabled — sign-in requires your authenticator or a single-use recovery code.'
                  : status.configured
                    ? 'Add an authenticator to protect sign-in.'
                    : 'The operator must configure the authenticator encryption key before enrollment.'}
              </p>
            )}
          </div>
          {status && (
            <span className={status.enabled ? 'pill pill-green' : 'pill pill-slate'}>
              {status.enabled ? 'On' : 'Off'}
            </span>
          )}
        </div>
        <div className="security-body">
          {loadError && (
            <div className="security-alert" role="alert">
              <p>Authenticator status could not be loaded. {loadError}</p>
              <button className="button button-secondary button-small" onClick={loadStatus}>
                Retry
              </button>
            </div>
          )}
          {status?.configured && (
            <>
              {secret && (
                <div className="security-setup">
                  <p>
                    Open this setup link on a device with your authenticator app, or enter the
                    secret manually. Keep both private.
                  </p>
                  {uri && (
                    <div className="security-code-row">
                      <code>{uri}</code>
                      <button
                        type="button"
                        className="button button-secondary button-small"
                        onClick={() => void copy()}
                      >
                        Copy setup link
                      </button>
                      {copied && <span role="status"> {copied}</span>}
                    </div>
                  )}
                  <p>
                    Secret: <code>{secret}</code>
                  </p>
                </div>
              )}
              <div className="security-fields">
                {(!secret || status.enabled) && (
                  <label className="field">
                    <span className="field-label">Current password</span>
                    <input
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </label>
                )}
                {(secret || status.enabled) && (
                  <label className="field">
                    <span className="field-label">Current authenticator code</span>
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    />
                  </label>
                )}
              </div>
              <div className="security-actions">
                {!status.enabled && !secret && (
                  <button
                    className="button button-primary"
                    disabled={busy || !password}
                    onClick={() => void act('setup')}
                  >
                    Set up authenticator
                  </button>
                )}
                {(secret || status.enabled) && (
                  <button
                    className={secret ? 'button button-primary' : 'button button-secondary'}
                    disabled={busy || !validCode || (!secret && !password)}
                    onClick={() => void act(secret ? 'confirm' : 'disable')}
                  >
                    {secret ? 'Confirm authenticator' : 'Disable with password and authenticator'}
                  </button>
                )}
              </div>
            </>
          )}
          {recovery.length > 0 && (
            <div className="security-recovery">
              <p>
                Store these recovery codes privately. Each can be used once. Other sessions were
                revoked.
              </p>
              <div className="security-recovery-codes">
                {recovery.map((c) => (
                  <div key={c}>
                    <code>{c}</code>
                  </div>
                ))}
              </div>
              <button className="button button-secondary" onClick={() => setRecovery([])}>
                I stored my recovery codes
              </button>
            </div>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </section>
      <DeviceSessions />
    </>
  );
}
