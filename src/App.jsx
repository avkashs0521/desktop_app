// src/App.jsx - Argus welcome screen and environment status display
import { useState, useEffect } from 'react';
import TitleBar from './components/TitleBar';
import { api, isElectron } from './api';

/**
 * Main application component for Argus.
 * Renders the custom title bar and welcome card with runtime environment details.
 */
export default function App() {
  const [appInfo, setAppInfo] = useState(null);

  useEffect(() => {
    let mounted = true;

    if (isElectron) {
      api.app
        .getInfo()
        .then((info) => {
          if (mounted && info) {
            setAppInfo(info);
          }
        })
        .catch((err) => {
          console.error('Failed to retrieve app info in App component:', err);
        });
    }

    return () => {
      mounted = false;
    };
  }, []);

  const statusText = isElectron
    ? appInfo
      ? `Running inside Electron ${appInfo.electronVersion || appInfo.version} on ${appInfo.platform}`
      : 'Running inside Electron...'
    : 'Running in a browser';

  return (
    <>
      <TitleBar />
      <div className="app-container">
        <main className="welcome-card">
          <span className="brand-badge">macOS Exam Client</span>
          <h1 className="app-title">Argus</h1>
          <p className="app-subtitle">Secure exam desktop app</p>
          <div className="status-badge">
            <span className="status-indicator" />
            <span>{statusText}</span>
          </div>
        </main>
      </div>
    </>
  );
}
