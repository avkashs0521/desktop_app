// src/main.jsx - React entry point
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/app.css';
import App from './App.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {/* ErrorBoundary wraps the whole tree so renderer JS errors show a recovery UI */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
