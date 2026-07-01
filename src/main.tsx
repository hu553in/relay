import './index.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { logError } from './shared/log';

const root = document.getElementById('root');

if (!root) {
  logError('Root element not found.');
  throw new Error('Root element not found.');
}

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (reason) {
  logError('Failed to render React app.', reason);
  throw reason;
}
