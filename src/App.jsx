// src/App.jsx - Argus welcome screen and environment status display

/**
 * Main application component for Argus.
 * Displays the initial welcome screen and environment status.
 */
export default function App() {
  // Check if the secure preload bridge (window.argus) is available.
  // Expected to be false (Running in a browser) until the preload bridge is implemented in commit 2.
  const isElectron = typeof window !== 'undefined' && Boolean(window.argus);

  return (
    <div className="app-container">
      <main className="welcome-card">
        <span className="brand-badge">macOS Exam Client</span>
        <h1 className="app-title">Argus</h1>
        <p className="app-subtitle">Secure exam desktop app</p>
        <div className="status-badge">
          <span className="status-indicator" />
          <span>{isElectron ? 'Running inside Electron' : 'Running in a browser'}</span>
        </div>
      </main>
    </div>
  );
}
