import { useRelayState } from '@/app/use-relay-state';
import { ControlPanel } from '@/control/control-panel';
import { Overlay } from '@/overlay/overlay';

export function App() {
  const params = new URLSearchParams(window.location.search);
  const kind = params.get('window') === 'overlay' ? 'overlay' : 'control';
  const { captureError, clearCaptureError, setState, state } = useRelayState();

  if (kind === 'overlay') {
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
