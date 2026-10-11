import { useState } from 'react';
import { Modal } from './UI';
import { useWorkspace } from '../store';
import IntelligencePanel from './IntelligencePanel';
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
        <button className="button" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>
          {label}
        </button>
      )}
      {(controlledOpen ?? open) && (
        <Modal
          open
          layer={110}
          title="Local assistance"
          onClose={() => {
            setOpen(false);
            onClose?.();
          }}
        >
          <IntelligencePanel
            key={w.companyId + ':' + w.session?.user.id + ':' + w.data?.me.memberAccessEpoch}
            choices={choices}
            sourceRead={sourceRead}
            initialOperation={operation}
          />
        </Modal>
      )}
    </>
  );
}
