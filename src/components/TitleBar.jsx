// src/components/TitleBar.jsx - Custom frameless title bar with window controls and drag region
import { useState, useEffect } from 'react';
import { api, isElectron } from '../api';

/**
 * Custom application title bar.
 * Provides macOS-friendly draggable area, application title, version tag,
 * and window control buttons (minimize, maximize/restore, close).
 */
export default function TitleBar() {
  const [version, setVersion] = useState('');
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;

    if (isElectron) {
      api.app
        .getInfo()
        .then((info) => {
          if (mounted && info?.version) {
            setVersion(info.version);
          }
        })
        .catch((err) => {
          console.error('Failed to retrieve app info in TitleBar:', err);
        });

      const unsubscribe = api.window.onState((state) => {
        if (mounted && state) {
          setIsMaximized(Boolean(state.isMaximized));
        }
      });

      return () => {
        mounted = false;
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      };
    }
  }, []);

  const handleDoubleClick = (e) => {
    if (e.target.closest('button')) {
      return;
    }
    api.window.toggleMaximize().catch((err) => {
      console.error('Failed to toggle maximize on double-click:', err);
    });
  };

  const handleMinimize = () => {
    api.window.minimize().catch((err) => {
      console.error('Failed to minimize window:', err);
    });
  };

  const handleToggleMaximize = () => {
    api.window.toggleMaximize().catch((err) => {
      console.error('Failed to toggle maximize window:', err);
    });
  };

  const handleClose = () => {
    api.window.close().catch((err) => {
      console.error('Failed to close window:', err);
    });
  };

  return (
    <header className="titlebar" onDoubleClick={handleDoubleClick}>
      <div className="titlebar-info">
        <span className="titlebar-title">Argus</span>
        {version && <span className="titlebar-version">v{version}</span>}
      </div>

      <div className="titlebar-controls">
        <button
          type="button"
          className="titlebar-btn"
          onClick={handleMinimize}
          title="Minimize"
          aria-label="Minimize"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>

        <button
          type="button"
          className="titlebar-btn"
          onClick={handleToggleMaximize}
          title={isMaximized ? 'Restore' : 'Maximize'}
          aria-label={isMaximized ? 'Restore' : 'Maximize'}
        >
          {isMaximized ? (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="3.5" y="1.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 4.5v5a1 1 0 0 0 1 1h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="titlebar-btn titlebar-btn-close"
          onClick={handleClose}
          title="Close"
          aria-label="Close"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}
