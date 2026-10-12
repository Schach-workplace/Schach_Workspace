import { lazy, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import { Modal } from './UI';
import { useWorkspace } from '../store';
import AsyncView from './AsyncView';
const IntelligencePanel = lazy(() => import('./IntelligencePanel'));
import type { IntelligenceChoice } from './IntelligenceSelection';
import type { IntelligenceOperation } from '../data/intelligence';
export default function IntelligenceLauncher({
  choices = [],
  operation = 'summary',
  label = 'Local assistance',
  controlledOpen,
  onClose,
  sourceRead,
}: {
  controlledOpen?: boolean;
  onClose?: () => void;
  choices?: IntelligenceChoice[];
  operation?: IntelligenceOperation;
  label?: string;
  sourceRead?: { ready: boolean; denied: boolean };
}) {
  const w = useWorkspace();
  const [open, setOpen] = useState(false);
  return (
    <>
      {controlledOpen === undefined && (
        <button
          type="button"
          className="button button-secondary intelligence-launcher"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          <Lightbulb size={14} aria-hidden />
          <span>{label}</span>
        </button>
      )}
      {(controlledOpen ?? open) && (
        <Modal
          open
          layer={110}
          title="Local assistance"
          description="Work only with sources you select, then review the result before acting."
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <AsyncView
            label="Local assistance"
            key={w.companyId + ':' + w.session?.user.id + ':' + w.data?.me.memberAccessEpoch}
          >
            <IntelligencePanel
              key={w.companyId + ':' + w.session?.user.id + ':' + w.data?.me.memberAccessEpoch}
              choices={choices}
              sourceRead={sourceRead}
              initialOperation={operation}
            />
          </AsyncView>
        </Modal>
      )}
    </>
  );
}
