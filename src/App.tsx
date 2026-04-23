import { getCurrentWindow } from '@tauri-apps/api/window';
import { useState } from 'react';

import { ControlsWindow } from '@/components/ControlsWindow';
import { OverlayWindow } from '@/components/OverlayWindow';
import { SettingsWindow } from '@/components/SettingsWindow';
import { useRelaySnapshot } from '@/hooks/useRelaySnapshot';

function App() {
  const [windowLabel] = useState(() => getCurrentWindow().label);
  const relay = useRelaySnapshot();

  if (windowLabel === 'overlay') {
    return <OverlayWindow relay={relay} />;
  }

  if (windowLabel === 'settings') {
    return <SettingsWindow relay={relay} />;
  }

  return <ControlsWindow relay={relay} />;
}

export default App;
