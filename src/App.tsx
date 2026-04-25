import { getCurrentWindow } from '@tauri-apps/api/window';

import { ControlsWindow } from '@/components/ControlsWindow';
import { OverlayWindow } from '@/components/OverlayWindow';
import { SettingsWindow } from '@/components/SettingsWindow';
import { AppConstantsProvider, useAppConstants } from '@/hooks/useAppConstants';
import { useRelaySnapshot } from '@/hooks/useRelaySnapshot';

function App() {
  return (
    <AppConstantsProvider>
      <AppRoutes />
    </AppConstantsProvider>
  );
}

function AppRoutes() {
  const windowLabel = getCurrentWindow().label;
  const constants = useAppConstants();
  const relay = useRelaySnapshot();

  if (windowLabel === constants.overlayWindowLabel) {
    return <OverlayWindow relay={relay} />;
  }

  if (windowLabel === constants.settingsWindowLabel) {
    return <SettingsWindow relay={relay} />;
  }

  return <ControlsWindow relay={relay} />;
}

export default App;
