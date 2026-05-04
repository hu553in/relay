import { getCurrentWindow } from '@tauri-apps/api/window';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { ControlsWindow } from '@/components/ControlsWindow';
import { OverlayWindow } from '@/components/OverlayWindow';
import { SettingsWindow } from '@/components/SettingsWindow';
import { AppConstantsProvider, useAppConstants } from '@/hooks/useAppConstants';
import { useRelaySnapshot } from '@/hooks/useRelaySnapshot';
import i18n from '@/i18n';
import { normalizeUiLanguage } from '@/i18n/languages';
import type { AppConstants, RelaySnapshotState } from '@/lib/types';

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
  const language = normalizeUiLanguage(relay.snapshot?.settings.interface.uiLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    if (i18n.language !== language) {
      void i18n.changeLanguage(language).catch(() => undefined);
    }
  }, [language]);

  return <LocalizedWindowRoute windowLabel={windowLabel} constants={constants} relay={relay} />;
}

function LocalizedWindowRoute({
  windowLabel,
  constants,
  relay,
}: {
  windowLabel: string;
  constants: AppConstants;
  relay: RelaySnapshotState;
}) {
  const { t } = useTranslation('app');
  const windowTitle =
    windowLabel === constants.overlayWindowLabel
      ? t('windowTitleOverlay')
      : windowLabel === constants.settingsWindowLabel
        ? t('windowTitleSettings')
        : t('windowTitleControls');

  useEffect(() => {
    document.title = windowTitle;
    void getCurrentWindow()
      .setTitle(windowTitle)
      .catch(() => undefined);
  }, [windowTitle]);

  if (windowLabel === constants.overlayWindowLabel) {
    return <OverlayWindow relay={relay} />;
  }

  if (windowLabel === constants.settingsWindowLabel) {
    return <SettingsWindow relay={relay} />;
  }

  return <ControlsWindow relay={relay} />;
}

export default App;
