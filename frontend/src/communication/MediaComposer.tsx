import { useEffect, useRef, useState } from 'react';
import { communicationRequest } from './api';
interface Pending {
  file: File;
  clientMessageId: string;
  reservation?: string;
  uploaded: boolean;
  clean: boolean;
}
export default function MediaComposer({
  company,
  conversation,
  onSend,
  disabled,
}: {
  company: string;
  conversation: string;
  onSend: (body: string, mediaIds: string[], clientMessageId: string) => Promise<unknown>;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<File | null>(null);
  const [previewURL, setPreviewURL] = useState('');
  const [retry, setRetry] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const pending = useRef<Pending | null>(null);
  const alive = useRef(true);
  const discard = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      discard.current = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (!preview) return;
    const url = URL.createObjectURL(preview);
    setPreviewURL(url);
    return () => URL.revokeObjectURL(url);
  }, [preview]);
  function current() {
    if (!alive.current)
      throw new Error('Conversation changed. Select the file again in the current conversation.');
  }
  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      if (file.size < 1 || file.size > 25 * 1024 * 1024)
        throw new Error('Choose media up to 25 MiB.');
      const attempt = pending.current ?? {
        file,
        clientMessageId: crypto.randomUUID(),
        uploaded: false,
        clean: false,
      };
      pending.current = attempt;
      setRetry(true);
      const root = `/conversations/${conversation}/media`;
      if (!attempt.reservation) {
        const hash = Array.from(
          new Uint8Array(await crypto.subtle.digest('SHA-256', await attempt.file.arrayBuffer())),
        )
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
        current();
        const reserved = await communicationRequest<{ id: string }>(company, root, {
          method: 'POST',
          body: {
            clientUploadId: attempt.clientMessageId,
            fileName: attempt.file.name,
            size: attempt.file.size,
            sha256: hash,
          },
        });
        current();
        attempt.reservation = reserved.id;
      }
      if (!attempt.uploaded) {
        const response = await fetch(
          `${(import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')}/api/companies/${company}${root}/${attempt.reservation}/upload`,
          { method: 'POST', credentials: 'include', body: attempt.file },
        );
        current();
        if (!response.ok) throw new Error('Upload failed. Keep the file and retry.');
        attempt.uploaded = true;
      }
      if (!attempt.clean) {
        await communicationRequest(company, `${root}/${attempt.reservation}/finalize`, {
          method: 'POST',
          body: {},
        });
        current();
        attempt.clean = true;
      }
      await onSend(attempt.file.name, [attempt.reservation], attempt.clientMessageId);
      current();
      pending.current = null;
      setRetry(false);
      setPreview(null);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function record() {
    try {
      discard.current = false;
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      current();
      chunks.current = [];
      const type = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
      recorder.current = new MediaRecorder(stream.current, { mimeType: type });
      recorder.current.ondataavailable = (e) => {
        if (e.data.size) chunks.current.push(e.data);
      };
      recorder.current.onstop = () => {
        stream.current?.getTracks().forEach((t) => t.stop());
        if (!alive.current) return;
        setRecording(false);
        if (!discard.current)
          setPreview(
            new File(chunks.current, `Voice note.${type === 'audio/webm' ? 'webm' : 'mp4'}`, {
              type,
            }),
          );
      };
      recorder.current.start();
      setRecording(true);
    } catch (e) {
      stream.current?.getTracks().forEach((t) => t.stop());
      if (alive.current) setError((e as Error).message);
    }
  }
  return (
    <div className="connect-media">
      <label className="connect-attach">
        Attach media
        <input
          type="file"
          disabled={disabled || busy || retry || recording}
          accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.csv,.webm,.mp4,.m4a,.wav,.ogg,.mp3"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) {
              if (file.size > 25 * 1024 * 1024) setError('Choose media up to 25 MiB.');
              else setPreview(file);
            }
          }}
        />
      </label>
      <button
        disabled={disabled || busy || retry}
        onClick={() => (recording ? recorder.current?.stop() : void record())}
      >
        {recording ? 'Stop recording' : 'Record voice note'}
      </button>
      {recording && (
        <button
          onClick={() => {
            discard.current = true;
            recorder.current?.stop();
          }}
        >
          Discard recording
        </button>
      )}
      {preview && (
        <div>
          <p>
            {preview.name} · {preview.size} bytes
          </p>
          {preview.type.startsWith('audio/') && previewURL && (
            <audio aria-label="Voice note preview" controls src={previewURL} />
          )}
          <button disabled={busy || disabled} onClick={() => void upload(preview)}>
            {busy
              ? 'Uploading and scanning…'
              : retry
                ? 'Retry same media message'
                : 'Send selected media'}
          </button>
          <button disabled={busy || retry} onClick={() => setPreview(null)}>
            Cancel
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
