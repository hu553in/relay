import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { logError } from './shared/log';

function isOverlayWindow(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'overlay';
}

const root = document.getElementById('root');

if (!root) {
  logError('Root element not found.');
  throw new Error('Root element not found.');
}

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App isOverlay={isOverlayWindow()} />
    </React.StrictMode>
  );
} catch (reason) {
  logError('Failed to render React app.', reason);
  throw reason;
}
