import { useRelayState } from '@/app/use-relay-state';
import { ControlPanel } from '@/control/control-panel';
import { Overlay } from '@/overlay/overlay';

const windowKind =
  typeof window !== 'undefined' &&
  new URLSearchParams(window.location.search).get('window') === 'overlay'
    ? 'overlay'
    : 'control';

export function App() {
  const { captureError, clearCaptureError, setState, state } = useRelayState();

  if (windowKind === 'overlay') {
    return <Overlay state={state} />;
  }

  return (
    <ControlPanel
      captureError={captureError}
      state={state}
      onClearCaptureError={clearCaptureError}
      onStateChange={setState}
    />
  );
}
