import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../store';
import { executionRead, useExecutionRead } from '../data/execution';
import { Modal, downloadText } from './UI';
import { calendarExport, type CalendarDeadline } from '../../../shared/integrations/calendar';
interface CalendarData {
  tasks: CalendarDeadline[];
  complete: boolean;
  timezone: string;
}
export default function CalendarExportButton({
  path,
  from,
  to,
}: {
  path: string;
  from: string;
  to: string;
}) {
  const w = useWorkspace(),
    [open, setOpen] = useState(false);
  const scope = [w.companyId, w.session?.user.id, w.data?.readBasis, path].join(':');
  return (
    <>
      <button
        className="button button-secondary"
        disabled={w.mode === 'demo' || w.authorizing}
        onClick={() => setOpen(true)}
      >
        Export calendar
      </button>
      {open && (
        <Export key={scope} path={path} from={from} to={to} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
function Export({
  path,
  from,
  to,
  onClose,
}: {
  path: string;
  from: string;
  to: string;
  onClose: () => void;
}) {
  const w = useWorkspace(),
    q = useExecutionRead<CalendarData>(path);
  const [reviewed, setReviewed] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const owner = [w.companyId, w.session?.user.id, w.data?.readBasis, path].join(':'),
    current = useRef(owner),
    alive = useRef(true),
    pending = useRef(false),
    generation = useRef(0);
  current.current = owner;
  useEffect(() => {
    alive.current = true;
    const hidden = () => {
      if (document.visibilityState === 'hidden') {
        generation.current++;
        setReviewed('');
        setBusy(false);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      alive.current = false;
      generation.current++;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  useEffect(() => {
    generation.current++;
    setReviewed('');
  }, [w.authorizing, owner]);
  const authorizing = useRef(w.authorizing);
  authorizing.current = w.authorizing;
  const ready = !w.authorizing && q.ready && q.data?.complete === true,
    basis = ready ? JSON.stringify(q.data!.tasks) : '';
  useEffect(() => {
    setReviewed('');
  }, [basis]);
  async function download() {
    if (
      pending.current ||
      !ready ||
      !basis ||
      reviewed !== basis ||
      !w.data ||
      document.visibilityState === 'hidden'
    )
      return;
    pending.current = true;
    setBusy(true);
    setError('');
    const captured = owner,
      epoch = generation.current;
    const valid = () =>
      alive.current &&
      !authorizing.current &&
      generation.current === epoch &&
      current.current === captured &&
      document.visibilityState !== 'hidden';
    try {
      const fresh = await executionRead<CalendarData>(
        'api',
        w.companyId ?? w.data.company.id,
        w.session?.user.id ?? w.data.me.id,
        path,
      );
      if (!valid()) return;
      if (!fresh.complete || JSON.stringify(fresh.tasks) !== basis) {
        setReviewed('');
        void q.retry();
        throw Error('Calendar changed. Review the refreshed export before downloading.');
      }
      downloadText(
        `workspace-deadlines-${from}.ics`,
        calendarExport(w.companyId ?? w.data.company.id, fresh.tasks),
        'text/calendar;charset=utf-8',
      );
      onClose();
    } catch (e) {
      if (valid()) setError((e as Error).message);
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  }
  return (
    <Modal
      open
      title="Calendar export"
      description="Review the fields and audience before exporting."
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="development-form">
        <h3>
          {from} – {to}
        </h3>
        <p>
          Export titles and deadlines for currently authorized work. Calendar copies can be shared
          outside Workspace and cannot be revoked after export. No messages, evidence, attendees or
          financial details are included.
        </p>
        {!ready ? (
          <p role="status">{q.error?.message || 'Checking complete current calendar…'}</p>
        ) : (
          <>
            <p>
              {q.data!.tasks.length} deadlines · {q.data!.timezone}
            </p>
            <ul>
              {q.data!.tasks.slice(0, 20).map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
            {q.data!.tasks.length > 20 && (
              <p>Plus {q.data!.tasks.length - 20} more deadlines in this range.</p>
            )}
            <label className="development-check">
              <input
                type="checkbox"
                checked={!!basis && reviewed === basis}
                disabled={busy}
                onChange={(e) => setReviewed(e.target.checked ? basis : '')}
              />
              I reviewed the export fields and external audience
            </label>
            <button
              className="button button-primary"
              disabled={busy || !basis || reviewed !== basis}
              onClick={() => void download()}
            >
              Download calendar file
            </button>
          </>
        )}
        {error && <p role="alert">{error}</p>}
      </div>
    </Modal>
  );
}
