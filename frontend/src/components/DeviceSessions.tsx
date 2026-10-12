import { useEffect, useState } from 'react';
import { request } from '../data/api';
import { storedWebDevice, useSignedInUserId } from '../communication/webDevice';
interface Device {
  id: string;
  name: string;
  platform: string;
  active: boolean;
  createdAt: string;
  lastSeenAt: string;
}
export default function DeviceSessions() {
  const userId = useSignedInUserId();
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  // GET /devices does not identify the caller's session, so the only device this
  // browser can recognise is the web call device it registered itself.
  const thisBrowser = storedWebDevice(userId);
  async function refresh() {
    const result = await request<{ devices: Device[] }>('/devices');
    setDevices(result.devices);
  }
  function load() {
    setLoadError('');
    setDevices(null);
    void refresh().catch((e) => setLoadError((e as Error).message || 'Unable to load devices.'));
  }
  useEffect(load, []);
  return (
    <section className="panel">
      <h3>Registered devices</h3>
      <p>
        Revoke a lost device to terminate its bound session in every company. Other sessions remain
        active.
      </p>
      {loadError ? (
        <div role="alert">
          <p>Registered devices could not be loaded. {loadError}</p>
          <button onClick={load}>Retry</button>
        </div>
      ) : !devices ? (
        <p role="status">Loading registered devices…</p>
      ) : devices.length === 0 ? (
        <p>
          No devices are registered. Devices appear here after you join a call or sign in on mobile.
        </p>
      ) : (
        <ul>
          {devices.map((d) => (
            <li key={d.id}>
              {d.name} · {d.platform}
              {d.id === thisBrowser && <strong> · This browser</strong>} ·{' '}
              {d.active ? 'Active' : 'Revoked'}
              {d.lastSeenAt && <> · Last seen {new Date(d.lastSeenAt).toLocaleString()}</>}{' '}
              {d.active && (
                <button
                  onClick={() =>
                    void request(`/devices/${d.id}/revoke`, { method: 'POST', body: {} })
                      .then(refresh)
                      .catch((e) => setError(e.message))
                  }
                >
                  Revoke device session
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
