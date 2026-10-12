import { useEffect, useState } from 'react';
import { request } from '../data/api';
import { MonitorSmartphone } from 'lucide-react';
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
    <section className="panel settings-section security-panel">
      <div className="section-header">
        <div>
          <h2>Registered devices</h2>
          <p>
            Revoke a lost device to terminate its bound session in every company. Other sessions
            remain active.
          </p>
        </div>
        <MonitorSmartphone size={19} />
      </div>
      <div className="security-body">
        {loadError ? (
          <div className="security-alert" role="alert">
            <p>Registered devices could not be loaded. {loadError}</p>
            <button className="button button-secondary button-small" onClick={load}>
              Retry
            </button>
          </div>
        ) : !devices ? (
          <p className="security-muted" role="status">
            Loading registered devices…
          </p>
        ) : devices.length === 0 ? (
          <p className="security-muted">
            No devices are registered. Devices appear here after you join a call or sign in on
            mobile.
          </p>
        ) : (
          <ul className="device-list">
            {devices.map((d) => (
              <li key={d.id}>
                <div className="device-main">
                  <strong>
                    {d.name} · {d.platform}
                    {d.id === thisBrowser && <span className="pill pill-orange">This browser</span>}
                  </strong>
                  <span>
                    <span className={d.active ? 'pill pill-green' : 'pill pill-slate'}>
                      {d.active ? 'Active' : 'Revoked'}
                    </span>
                    {d.lastSeenAt && <>Last seen {new Date(d.lastSeenAt).toLocaleString()}</>}
                  </span>
                </div>
                {d.active && (
                  <button
                    className="button button-secondary button-small"
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
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
