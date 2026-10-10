import { useEffect, useState } from 'react';
import { useWorkspace } from '../store';
import { useExecutionRead, useExecutionMutation } from '../data/execution';
import { useExecutionInput, clearExecutionForm } from '../data/executionInput';
import {
  type SavedConfiguration,
  type SavedDefinition,
  type ReportSchedule,
} from '../data/historicalReports';
export default function SavedReports({ onOpen }: { onOpen: (id: string) => void }) {
  const w = useWorkspace();
  const list = useExecutionRead<{ definitions: SavedDefinition[] }>('/reports/definitions');
  const [selected, setSelected] = useState('');
  if (w.mode === 'demo')
    return (
      <p className="panel">
        Saved reports require a connected company server. Scheduled delivery uses each recipient’s
        current authorized scope.
      </p>
    );
  return (
    <div>
      <section className="panel">
        <h2>Saved report definitions</h2>
        <p>
          Fixed periods preserve dates. Previous week or month resolves the completed period at
          generation. Recipients receive independently authorized reports.
        </p>
        <button className="button button-primary" onClick={() => setSelected('')}>
          New saved report
        </button>
        {list.loading && <p role="status">Checking definitions…</p>}
        {list.error && <p role="alert">{list.error.message}</p>}
        {list.ready &&
          list.data?.definitions.map((d) => (
            <button
              className="button button-secondary"
              key={d.id}
              onClick={() => setSelected(d.id)}
            >
              {d.configuration.name} · {d.state}
            </button>
          ))}
      </section>
      <DefinitionForm
        key={selected || 'new'}
        id={selected}
        onCreated={setSelected}
        onOpen={onOpen}
      />
    </div>
  );
}
function DefinitionForm({
  id,
  onCreated,
  onOpen,
}: {
  id: string;
  onCreated: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const w = useWorkspace();
  const data = w.data!;
  const form = '$report-definition:' + (id || 'new');
  const source = useExecutionRead<{ definition: SavedDefinition; schedule: ReportSchedule | null }>(
    `/reports/definitions/${encodeURIComponent(id || 'none')}`,
    !!id,
  );
  const people = useExecutionRead<{ recipients: { id: string; name: string }[] }>(
    '/reports/definitions/recipients',
  );
  const [initialized, setInitialized] = useState(!id);
  const [config, setConfig, prefill] = useExecutionInput<SavedConfiguration>(
    form,
    'configuration',
    {
      name: '',
      basis: 'task_history_v1',
      filters: { ownerId: '', departmentId: '', projectId: '' },
      periodRule: 'previous_month',
      from: '',
      to: '',
      timezonePolicy: 'company_at_resolution',
      reportZone: '',
      recipientIds: [data.me.id],
    },
  );
  const [basis, setBasis, prefillBasis] = useExecutionInput(form, 'basis', {
    definitionVersion: 0,
    scheduleVersion: 0,
  });
  const [schedule, setSchedule, schedulePrefill] = useExecutionInput(form, 'schedule', {
    weekdays: [1],
    localMinute: '09:00',
    scheduleZone: data.company.timezone,
  });
  const save = useExecutionMutation(form, id ? [`/reports/definitions/${id}`] : []);
  const scheduling = useExecutionMutation(
    form + ':schedule',
    id ? [`/reports/definitions/${id}`] : [],
  );
  const generate = useExecutionMutation(
    form + ':generate',
    id ? [`/reports/definitions/${id}`] : [],
  );
  const [error, setError] = useState('');
  const [review, setReview] = useState(false);
  useEffect(() => {
    if (!initialized && source.ready && source.data) {
      prefill(source.data.definition.configuration);
      prefillBasis({
        definitionVersion: source.data.definition.version,
        scheduleVersion: source.data.schedule?.id ? source.data.schedule.version : 0,
      });
      if (source.data.schedule?.id)
        schedulePrefill({
          weekdays: source.data.schedule.weekdays,
          localMinute: source.data.schedule.localMinute,
          scheduleZone: source.data.schedule.scheduleZone,
        });
      setInitialized(true);
    }
  }, [initialized, source.ready, source.data]);
  useEffect(() => {
    if (source.denied) {
      clearExecutionForm(data.company.id, data.me.id, form);
      setInitialized(false);
    }
  }, [source.denied, data.company.id, data.me.id, form]);
  const ready = initialized && people.ready && (!id || source.ready);
  const disabled = !ready || save.busy || scheduling.busy || generate.busy;
  const edit = (patch: Partial<SavedConfiguration>) => {
    setBasis(basis);
    setConfig({ ...config, ...patch });
    setReview(false);
  };
  async function submit(state: 'active' | 'paused' | 'deleted' = 'active') {
    setError('');
    try {
      if (
        !save.attempt &&
        state !== 'active' &&
        !window.confirm(
          `${state === 'deleted' ? 'Delete' : 'Pause'} this definition and cancel its queued, running and ready exports and delivery?`,
        )
      )
        return;
      setBasis(basis);
      await save.execute<{ definition: SavedDefinition }>(
        `/reports/definitions${id ? '/' + encodeURIComponent(id) : ''}`,
        save.attempt?.payload ??
          (id
            ? { expectedVersion: basis.definitionVersion, configuration: config, state }
            : { configuration: config }),
        id ? 'PATCH' : 'POST',
        (r) => {
          setBasis({ ...basis, definitionVersion: r.definition.version });
          if (!id) onCreated(r.definition.id);
          else void source.retry();
        },
      );
      setReview(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function scheduleSave(state = 'active') {
    try {
      setBasis(basis);
      await scheduling.execute<{ definition: SavedDefinition; schedule: ReportSchedule }>(
        `/reports/definitions/${encodeURIComponent(id)}/schedule`,
        scheduling.attempt?.payload ?? {
          ...schedule,
          expectedDefinitionVersion: basis.definitionVersion,
          expectedScheduleVersion: basis.scheduleVersion,
          state,
        },
        'PATCH',
        (r) => {
          setBasis({
            definitionVersion: r.definition.version,
            scheduleVersion: r.schedule.version,
          });
          void source.retry();
        },
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function generateNow() {
    try {
      await generate.execute<{ snapshotId: string }>(
        `/reports/definitions/${encodeURIComponent(id)}/generate`,
        generate.attempt?.payload ?? { expectedVersion: basis.definitionVersion },
        'POST',
        (r) => onOpen(r.snapshotId),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  if (source.denied)
    return <p>Definition access changed. Start a new definition with current choices.</p>;
  return (
    <section className="panel">
      <h2>{id ? 'Manage saved report' : 'Create saved report'}</h2>
      {!ready && <p role="status">Checking current definition and eligible people…</p>}
      <fieldset disabled={disabled}>
        <label>
          Report name
          <input value={config.name} onChange={(e) => edit({ name: e.target.value })} />
        </label>
        <label>
          Saved period
          <select
            value={config.periodRule}
            onChange={(e) =>
              edit({
                periodRule: e.target.value as SavedConfiguration['periodRule'],
                from: '',
                to: '',
              })
            }
          >
            <option value="fixed">Fixed dates</option>
            <option value="previous_week">Previous completed week</option>
            <option value="previous_month">Previous completed month</option>
          </select>
        </label>
        {config.periodRule === 'fixed' && (
          <>
            <label>
              Saved start date
              <input
                type="date"
                value={config.from}
                onChange={(e) => edit({ from: e.target.value })}
              />
            </label>
            <label>
              Saved end date
              <input type="date" value={config.to} onChange={(e) => edit({ to: e.target.value })} />
            </label>
          </>
        )}
        <label>
          Saved timezone policy
          <select
            value={config.timezonePolicy}
            onChange={(e) =>
              edit({
                timezonePolicy: e.target.value as SavedConfiguration['timezonePolicy'],
                reportZone: e.target.value === 'explicit' ? data.company.timezone : '',
              })
            }
          >
            <option value="company_at_resolution">Company zone at resolution</option>
            <option value="explicit">Explicit IANA zone</option>
          </select>
        </label>
        {config.timezonePolicy === 'explicit' && (
          <label>
            Saved report timezone
            <input
              value={config.reportZone}
              onChange={(e) => edit({ reportZone: e.target.value })}
            />
          </label>
        )}
        {ready && (
          <>
            {(['ownerId', 'departmentId', 'projectId'] as const).map((field, index) => (
              <label key={field}>
                Saved {['owner', 'department', 'project'][index]} filter
                <select
                  value={config.filters[field]}
                  onChange={(e) =>
                    edit({ filters: { ...config.filters, [field]: e.target.value } })
                  }
                >
                  <option value="">
                    All authorized {['owners', 'departments', 'projects'][index]}
                  </option>
                  {(index === 0
                    ? data.people.filter((p) => p.active)
                    : index === 1
                      ? data.departments
                      : data.projects
                  ).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <div>
              <p>Active recipients (1–100)</p>
              {people.data?.recipients.map((p) => (
                <label key={p.id}>
                  <input
                    type="checkbox"
                    checked={config.recipientIds.includes(p.id)}
                    onChange={(e) =>
                      edit({
                        recipientIds: e.target.checked
                          ? [...config.recipientIds, p.id]
                          : config.recipientIds.filter((x) => x !== p.id),
                      })
                    }
                  />
                  {p.name}
                </label>
              ))}
            </div>
          </>
        )}
        <button
          className="button button-primary"
          disabled={!config.name || !config.recipientIds.length}
          onClick={() => setReview(true)}
        >
          Review definition
        </button>
        {review && (
          <div>
            <p>
              {config.name} · {config.periodRule.replaceAll('_', ' ')} ·{' '}
              {config.timezonePolicy.replaceAll('_', ' ')} · {config.recipientIds.length} recipients
              · expected version {basis.definitionVersion}
            </p>
            <button className="button button-primary" onClick={() => void submit()}>
              Confirm saved report
            </button>
          </div>
        )}
        {save.attempt && (
          <button className="button button-primary" onClick={() => void submit()}>
            Retry same definition save
          </button>
        )}
        {id && (
          <>
            <button className="button button-secondary" onClick={() => void generateNow()}>
              {generate.attempt ? 'Retry same saved generation' : 'Generate saved report now'}
            </button>
            <button
              className="button button-secondary"
              onClick={() =>
                void submit(source.data?.definition.state === 'paused' ? 'active' : 'paused')
              }
            >
              {source.data?.definition.state === 'paused'
                ? 'Resume definition'
                : 'Pause definition'}
            </button>
            <button className="button button-danger" onClick={() => void submit('deleted')}>
              Delete definition
            </button>
            <h3>In-app delivery schedule</h3>
            <p>
              Only the latest missed occurrence is delivered. Schedule changes cancel outputs from
              earlier versions.
            </p>
            {['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(
              (day, index) => (
                <label key={day}>
                  <input
                    type="checkbox"
                    checked={schedule.weekdays.includes(index)}
                    onChange={(e) => {
                      setBasis(basis);
                      setSchedule({
                        ...schedule,
                        weekdays: e.target.checked
                          ? [...schedule.weekdays, index].sort()
                          : schedule.weekdays.filter((x) => x !== index),
                      });
                    }}
                  />
                  {day}
                </label>
              ),
            )}
            <label>
              Schedule local time
              <input
                type="time"
                value={schedule.localMinute}
                onChange={(e) => {
                  setBasis(basis);
                  setSchedule({ ...schedule, localMinute: e.target.value });
                }}
              />
            </label>
            <label>
              Schedule timezone
              <input
                value={schedule.scheduleZone}
                onChange={(e) => {
                  setBasis(basis);
                  setSchedule({ ...schedule, scheduleZone: e.target.value });
                }}
              />
            </label>
            <button className="button button-primary" onClick={() => void scheduleSave()}>
              {scheduling.attempt ? 'Retry same schedule save' : 'Confirm delivery schedule'}
            </button>
            <button className="button button-secondary" onClick={() => void scheduleSave('paused')}>
              Pause schedule
            </button>
            {source.ready && source.data?.schedule?.id && (
              <p>
                Next occurrence {new Date(source.data.schedule.nextOccurrenceUTC).toLocaleString()}
              </p>
            )}
          </>
        )}
      </fieldset>
      {(save.attempt || scheduling.attempt) && (
        <button
          className="button button-secondary"
          onClick={() => {
            if (
              window.confirm(
                'Abandon the unresolved save? It may already have committed. Recheck the definition before a new save.',
              )
            ) {
              save.abandon();
              scheduling.abandon();
              void source.retry();
            }
          }}
        >
          Abandon save retry
        </button>
      )}
      {(error ||
        save.error ||
        scheduling.error ||
        generate.error ||
        source.error ||
        people.error) && (
        <p role="alert">
          {error ||
            save.error ||
            scheduling.error ||
            generate.error ||
            source.error?.message ||
            people.error?.message}
        </p>
      )}
      {id &&
        source.ready &&
        source.data &&
        source.data.definition.version !== basis.definitionVersion && (
          <>
            <p>
              Definition changed. Your authored input remains. Review the current version before
              reconciling.
            </p>
            <button
              className="button button-secondary"
              onClick={() => {
                if (
                  window.confirm(
                    'Replace authored inputs with the current definition and versions?',
                  )
                ) {
                  setConfig(source.data!.definition.configuration);
                  setBasis({
                    definitionVersion: source.data!.definition.version,
                    scheduleVersion: source.data!.schedule?.id ? source.data!.schedule.version : 0,
                  });
                  save.abandon();
                  scheduling.abandon();
                }
              }}
            >
              Reconcile current definition
            </button>
          </>
        )}
    </section>
  );
}
