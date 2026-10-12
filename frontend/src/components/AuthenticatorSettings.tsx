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
      <DeviceSessions />
      <section className="panel">
        <h3>Authenticator protection</h3>
        {loadError ? (
          <div role="alert">
            <p>Authenticator status could not be loaded. {loadError}</p>
            <button onClick={loadStatus}>Retry</button>
          </div>
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
        {status?.configured && (
          <>
            {(!secret || status.enabled) && (
              <label>
                Current password
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
            )}
            {!status.enabled && !secret && (
              <button disabled={busy || !password} onClick={() => void act('setup')}>
                Set up authenticator
              </button>
            )}
            {secret && (
              <>
                <p>
                  Open this setup link on a device with your authenticator app, or enter the secret
                  manually. Keep both private.
                </p>
                {uri && (
                  <p>
                    <code style={{ wordBreak: 'break-all' }}>{uri}</code>{' '}
                    <button type="button" onClick={() => void copy()}>
                      Copy setup link
                    </button>
                    {copied && <span role="status"> {copied}</span>}
                  </p>
                )}
                <p>
                  Secret: <code>{secret}</code>
                </p>
              </>
            )}
            {(secret || status.enabled) && (
              <>
                <label>
                  Current authenticator code
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  />
                </label>
                <button
                  disabled={busy || !validCode || (!secret && !password)}
                  onClick={() => void act(secret ? 'confirm' : 'disable')}
                >
                  {secret ? 'Confirm authenticator' : 'Disable with password and authenticator'}
                </button>
              </>
            )}
          </>
        )}
        {recovery.length > 0 && (
          <div>
            <p>
              Store these recovery codes privately. Each can be used once. Other sessions were
              revoked.
            </p>
            {recovery.map((c) => (
              <div key={c}>
                <code>{c}</code>
              </div>
            ))}
            <button onClick={() => setRecovery([])}>I stored my recovery codes</button>
          </div>
        )}
        {error && <p role="alert">{error}</p>}
      </section>
    </>
  );
}
