import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useWorkspace } from '../store';
import { sameBusinessActorBasis, type BusinessActorBasis } from '../data/businessAttempts';
import PeopleOnboarding from './PeopleOnboarding';
import PeoplePresetEditor from './PeoplePresetEditor';
import AccessReview from './AccessReview';
import DepartureHandover from './DepartureHandover';
import '../styles/people.css';
type Tool = 'onboard' | 'presets' | 'reviews' | 'departure';
type Open = (tool: Tool, userId?: string, onProject?: (id: string) => void) => void;
const Context = createContext<Open | undefined>(undefined);
export function usePeopleTools() {
  const open = useContext(Context);
  if (!open) throw Error('People tools require their scoped host.');
  return open;
}
// This host survives the workspace's temporary joined-data loading screen.
// Each tool withholds current-source DTOs itself; no fetched workspace is kept.
export default function PeopleTools({ children }: { children: ReactNode }) {
  const w = useWorkspace();
  const owner = w.companyId + ':' + (w.session?.user.id ?? '');
  const [state, setState] = useState<{
    tool: Tool;
    owner: string;
    actor: BusinessActorBasis | undefined;
    userId?: string;
    onProject?: (id: string) => void;
  }>();
  const current =
    state?.owner === owner && (!w.data || sameBusinessActorBasis(state.actor, w.data.me))
      ? state
      : undefined;
  const close = () => setState(undefined);
  useEffect(() => {
    const denied = (event: Event) => {
      const d = (event as CustomEvent<{ status: number; path: string }>).detail;
      if (
        d.status === 401 ||
        d.path.startsWith('/companies/' + encodeURIComponent(w.companyId) + '/')
      )
        setState(undefined);
    };
    window.addEventListener('schach-api-hard-denial', denied);
    return () => window.removeEventListener('schach-api-hard-denial', denied);
  }, [w.companyId]);
  return (
    <Context.Provider
      value={(tool, userId, onProject) =>
        setState({ tool, userId, onProject, owner, actor: w.data?.me })
      }
    >
      {children}
      {current?.tool === 'onboard' && <PeopleOnboarding onClose={close} />}
      {current?.tool === 'presets' && <PeoplePresetEditor onClose={close} />}
      {current?.tool === 'reviews' && <AccessReview onClose={close} />}
      {current?.tool === 'departure' && current.userId && (
        <DepartureHandover
          userId={current.userId}
          onClose={close}
          onProject={(id) => {
            close();
            current.onProject?.(id);
          }}
        />
      )}
    </Context.Provider>
  );
}
