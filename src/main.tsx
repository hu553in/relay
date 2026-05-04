import '@/styles/index.css';
import '@/i18n';

import React from 'react';
import ReactDOM from 'react-dom/client';

import App from '@/App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element was not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
