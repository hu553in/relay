import { useRelayState } from '@/app/use-relay-state';
import { ControlPanel } from '@/control/control-panel';
import { Overlay } from '@/overlay/overlay';

interface AppProps {
  isOverlay: boolean;
}

export function App({ isOverlay }: AppProps) {
  const { captureError, clearCaptureError, setState, state } = useRelayState();

  if (isOverlay) {
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
