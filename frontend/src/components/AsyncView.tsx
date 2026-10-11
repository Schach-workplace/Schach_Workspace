import { Component, Suspense, type ReactNode } from 'react';
class LoadRecovery extends Component<{ label: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div role="alert">
        <p>
          {this.props.label} could not be opened. Continue manually, or reload this page to try
          again. Unsaved edits on this page will be lost.
        </p>
        <button className="button" onClick={() => window.location.reload()}>
          Reload this page
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function AsyncView({ label, children }: { label: string; children: ReactNode }) {
  return (
    <LoadRecovery label={label}>
      <Suspense fallback={<p role="status">Opening {label}…</p>}>{children}</Suspense>
    </LoadRecovery>
  );
}
