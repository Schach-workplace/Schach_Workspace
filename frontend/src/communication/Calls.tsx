import { useEffect, useRef, useState } from 'react';
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  ControlBar,
} from '@livekit/components-react';
import { Phone, Video, CircleDot } from 'lucide-react';
import { registerWebDevice, useSignedInUserId } from './webDevice';
import '@livekit/components-styles';
import '../styles/connect-dialogs.css';
interface Call {
  id: string;
  kind: string;
  version: number;
  state: string;
}
export default function Calls({
  conversation,
  command,
}: {
  conversation: string;
  command: <T>(path: string, body: unknown, method?: string) => Promise<T>;
}) {
  const userId = useSignedInUserId();
  const [connection, setConnection] = useState<{ token: string; url: string; call: Call } | null>(
    null,
  );
  const [available, setAvailable] = useState<Call[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ kind: string; retryKey: string; id?: string } | null>(null);
  const alive = useRef(true);
  async function load() {
    const v = await command<{ calls: Call[] }>(
      `/conversations/${conversation}/calls`,
      undefined,
      'GET',
    );
    if (alive.current) setAvailable(v.calls);
  }
  useEffect(() => {
    alive.current = true;
    void load().catch((e) => setError(e.message));
    return () => {
      alive.current = false;
    };
  }, [conversation]);
  async function join(id: string) {
    // Reuses this browser's registration so joins do not pile up duplicate devices.
    const deviceId = await registerWebDevice(userId);
    if (!alive.current) return;
    const result = await command<NonNullable<typeof connection>>(`/calls/${id}/token`, {
      deviceId,
    });
    if (alive.current) setConnection(result);
  }
  async function start(kind: string) {
    setBusy(true);
    setError('');
    try {
      const pending = attempt.current ?? { kind, retryKey: crypto.randomUUID() };
      attempt.current = pending;
      if (!pending.id) {
        const call = await command<{ id: string }>(`/conversations/${conversation}/calls`, {
          kind: pending.kind,
          retryKey: pending.retryKey,
        });
        pending.id = call.id;
      }
      await join(pending.id);
      attempt.current = null;
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Conversation calls" className="connect-calls">
      {connection ? (
        <LiveKitRoom
          token={connection.token}
          serverUrl={connection.url}
          connect
          audio
          video={connection.call.kind === 'video'}
          data-lk-theme="default"
          onDisconnected={() => {
            setConnection(null);
            void load().catch((e) => setError(e.message));
          }}
          onError={(e) => setError(e.message)}
        >
          {connection.call.kind === 'video' ? (
            <VideoConference />
          ) : (
            <>
              <RoomAudioRenderer />
              <ControlBar variation="minimal" />
            </>
          )}
          <p className="connect-call-recording">
            Recording is off. Recordings require a separate declared consent flow.
          </p>
          <button
            className="button button-secondary connect-danger"
            onClick={() =>
              void command(`/calls/${connection.call.id}/end`, {
                expectedVersion: connection.call.version,
              })
                .then(() => setConnection(null))
                .catch((e) => setError(e.message))
            }
          >
            End call for everyone
          </button>
        </LiveKitRoom>
      ) : (
        <div className="connect-call-actions">
          {attempt.current ? (
            <button
              className="button button-secondary button-small"
              disabled={busy}
              onClick={() => void start(attempt.current!.kind)}
            >
              Retry same call
            </button>
          ) : (
            <>
              <button
                className="button button-secondary button-small"
                disabled={busy}
                onClick={() => void start('audio')}
              >
                <Phone size={14} aria-hidden="true" />
                Start audio call
              </button>
              <button
                className="button button-secondary button-small"
                disabled={busy}
                onClick={() => void start('video')}
              >
                <Video size={14} aria-hidden="true" />
                Start video call
              </button>
            </>
          )}
          {available
            .filter((c) => c.state === 'active')
            .map((c) => (
              <button
                className="button button-primary button-small"
                disabled={busy}
                key={c.id}
                onClick={() => void join(c.id).catch((e) => setError(e.message))}
              >
                <CircleDot size={14} aria-hidden="true" />
                Join {c.kind} call
              </button>
            ))}
        </div>
      )}
      {error && (
        <p role="alert" className="connect-error">
          {error}
        </p>
      )}
    </section>
  );
}
