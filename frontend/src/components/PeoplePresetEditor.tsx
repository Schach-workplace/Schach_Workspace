import { entityRecoveryError } from '../../../shared/business/recoveryCopy';
import PeopleProjection from './PeopleProjection';
import { useState } from 'react';
import {
  usePeopleRead,
  usePeopleMutation,
  emptyMembership,
  type PeopleContext,
  type PeoplePreset,
} from '../data/people';
import { useExecutionInput } from '../data/executionInput';
import type { TaskTemplateView } from '../../../shared/business/types';
import { Modal, Field, ErrorMessage } from './UI';
import MembershipFields from './PeopleMembershipFields';
export default function PeoplePresetEditor({ onClose }: { onClose: () => void }) {
  const context = usePeopleRead<PeopleContext>('/people/context');
  const list = usePeopleRead<{ items: PeoplePreset[] }>('/people/presets');
  const templates = usePeopleRead<{ templates: TaskTemplateView[] }>('/task-templates');
  const [draft, setDraft, , retire] = useExecutionInput('$people-preset', 'draft', () => ({
    id: '',
    version: 1,
    name: '',
    description: '',
    archived: false,
    membership: emptyMembership(),
    templateIds: [] as string[],
  }));
  const action = usePeopleMutation('$people-preset');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const ready = context.ready && list.ready;
  const load = (p?: PeoplePreset) => {
    action.abandon();
    setDraft(
      p
        ? { ...p }
        : {
            id: '',
            version: 1,
            name: '',
            description: '',
            archived: false,
            membership: emptyMembership(),
            templateIds: [],
          },
    );
    setSaved(false);
  };
  async function save() {
    const path =
      action.attempt?.target?.path ?? '/people/presets' + (draft.id ? '/' + draft.id : '');
    const method = action.attempt?.target?.method ?? (draft.id ? 'PATCH' : 'POST');
    const payload = action.attempt?.payload ?? {
      name: draft.name,
      description: draft.description,
      membership: draft.membership,
      templateIds: draft.templateIds,
      archived: draft.archived,
      ...(draft.id ? { expectedVersion: draft.version } : {}),
    };
    try {
      await action.execute(path, payload, method, () => {
        retire(draft);
        setSaved(true);
      });
      await list.retry();
    } catch (e) {
      setError(entityRecoveryError(e, 'preset'));
    }
  }
  return (
    <Modal
      open
      title="Onboarding presets"
      description="Reusable access defaults and starting task templates for new people."
      onClose={onClose}
    >
      <div className="entity-form people-form">
        <ErrorMessage error={error || action.error} />
        <div
          className="people-checking"
          aria-hidden={ready}
          style={{ visibility: ready ? 'hidden' : 'visible' }}
        >
          <p role="status">Checking current preset access…</p>
        </div>
        {
          <PeopleProjection current={ready}>
            <div className="people-preset-list" role="group" aria-label="Presets">
              <button
                className="button button-secondary button-small"
                aria-pressed={!draft.id}
                disabled={!!action.attempt}
                onClick={() => load()}
              >
                New preset
              </button>
              {list.data?.items.map((p) => (
                <button
                  className="button button-secondary button-small"
                  aria-pressed={draft.id === p.id}
                  disabled={!!action.attempt}
                  key={p.id}
                  onClick={() => load(p)}
                >
                  {p.name}
                  {p.archived ? ' · Archived' : ''}
                </button>
              ))}
            </div>
          </PeopleProjection>
        }
        {saved && ready && (
          <p role="status">Preset saved. Select it to inspect its current version.</p>
        )}
        <fieldset className="plain-fieldset" disabled={!!action.attempt || action.busy}>
          <Field label="Preset name">
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </Field>
          <Field label="Preset description">
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>
          {
            <MembershipFields
              context={context.data}
              disabled={!ready}
              value={draft.membership}
              onChange={(membership) => setDraft({ ...draft, membership })}
            />
          }
          <h3 className="people-section-title">Starting task templates</h3>
          <p className="people-muted">Choose up to 20 optional starting task templates.</p>
          <div className="people-check-list">
            {templates.ready &&
              templates.data?.templates
                .filter((t) => t.kind === 'task' && !t.archived)
                .map((t) => (
                  <label key={t.id} className="check-field people-check">
                    <input
                      type="checkbox"
                      checked={draft.templateIds.includes(t.id)}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          templateIds: e.target.checked
                            ? [...draft.templateIds, t.id]
                            : draft.templateIds.filter((id) => id !== t.id),
                        })
                      }
                    />
                    {t.name}
                  </label>
                ))}
          </div>
          {draft.templateIds.some(
            (id) => !templates.data?.templates.some((t) => t.id === id && !t.archived),
          ) && (
            <p className="people-alert">
              Choose a current replacement for an unavailable template.
            </p>
          )}
          {draft.id && (
            <label className="check-field people-check">
              <input
                type="checkbox"
                checked={draft.archived}
                onChange={(e) => setDraft({ ...draft, archived: e.target.checked })}
              />
              Archive this preset
            </label>
          )}
        </fieldset>
        <div className="people-actions">
          {action.attempt && (
            <button
              className="button button-secondary"
              onClick={() => {
                if (
                  window.confirm('Inspect the current preset before discarding an unknown result.')
                )
                  action.abandon();
              }}
            >
              Discard after inspection
            </button>
          )}
          <button
            className="button button-primary"
            disabled={!ready || action.busy || (!action.attempt && !draft.name.trim())}
            onClick={() => void save()}
          >
            {action.attempt ? 'Retry the same submission' : 'Save reviewed preset'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
